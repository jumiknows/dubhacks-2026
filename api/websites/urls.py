"""Strict parsing before reputation lookup; never visits a submitted address."""

from __future__ import annotations

import hashlib
import ipaddress
import re
from urllib.parse import parse_qsl, urlsplit, urlunsplit

from api.websites.models import CanonicalURL

_HOST = re.compile(r"(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?\Z")
_SENSITIVE = re.compile(r"(?:token|secret|password|passwd|session|auth|signature|credential|api.?key|access.?key|email|user.?name|account|code|jwt)", re.I)


class URLRejected(ValueError):
    def __init__(self, code: str, detail: str):
        super().__init__(detail)
        self.code = code
        self.detail = detail


def fingerprint(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8", errors="replace")).hexdigest()


def canonical_url(value: str) -> CanonicalURL:
    if not isinstance(value, str) or not value or len(value) > 4096:
        raise URLRejected("invalid_url", "Provide a bounded absolute HTTPS URL.")
    if any(ord(c) <= 32 or ord(c) >= 127 for c in value) or "\\" in value:
        raise URLRejected("ambiguous_url", "Whitespace, control characters, backslashes and raw Unicode require manual review; use an explicit encoded URL.")
    try:
        parsed = urlsplit(value)
        host = parsed.hostname
        if parsed.scheme.lower() != "https" or not host:
            raise URLRejected("https_required", "Only HTTPS destinations are supported.")
        if parsed.username is not None or parsed.password is not None or "@" in parsed.netloc:
            raise URLRejected("url_credentials", "URLs containing credentials are not accepted or submitted to reputation services.")
        if parsed.port not in (None, 443):
            raise URLRejected("unsupported_port", "Only the standard HTTPS port is supported.")
        if host.endswith(".") or "%" in parsed.netloc or re.search(r"%(?![0-9A-Fa-f]{2})", value):
            raise URLRejected("ambiguous_url", "Ambiguous hostnames or malformed URL encoding require manual review.")
        host = host.lower()
        try:
            ipaddress.ip_address(host)
        except ValueError:
            pass
        else:
            raise URLRejected("ip_literal", "Merchant destinations must use an explicitly registered DNS hostname, not an IP address.")
        if not _HOST.fullmatch(host) or host.endswith((".localhost", ".local", ".internal", ".test", ".invalid", ".example")):
            raise URLRejected("invalid_hostname", "This hostname is not a supported public merchant address.")
        if all(re.fullmatch(r"(?:0x[0-9a-f]+|[0-9]+)", label) for label in host.split(".")):
            raise URLRejected("ip_literal", "Alternative numeric IP representations are not permitted.")
        if parsed.fragment:
            # Fragments can carry login/checkout tokens and are not sent to HTTP servers.
            raise URLRejected("url_fragment", "Remove the fragment before assessment; fragments may contain private information.")
        if any(_SENSITIVE.search(k) for k, _ in parse_qsl(parsed.query, keep_blank_values=True)) or re.search(r"(?:%40|@)", parsed.query, re.I):
            raise URLRejected("private_url", "Potential private credentials or identifiers were detected; this URL will not be submitted to a third party.")
        if re.search(r"/(?:reset[-_]?password|password[-_]?reset|oauth|authorize|login|signin|sign-in)(?:/|$)", parsed.path, re.I):
            raise URLRejected("private_url", "Login and authorization URLs require a separate private workflow, not public reputation lookup.")
        origin = "https://" + host
        warnings = ["international_hostname"] if any(label.startswith("xn--") for label in host.split(".")) else []
        return CanonicalURL(url=urlunsplit(("https", host, parsed.path or "/", parsed.query, "")), origin=origin, host=host, warning_codes=warnings)
    except (ValueError, UnicodeError) as exc:
        if isinstance(exc, URLRejected):
            raise
        raise URLRejected("invalid_url", "The URL could not be parsed unambiguously.") from None


def configured_origin(value: str) -> str:
    parsed = canonical_url(value)
    parts = urlsplit(parsed.url)
    if parts.path not in ("", "/") or parts.query:
        raise URLRejected("invalid_origin", "Merchant identity entries must be HTTPS origins without paths or queries.")
    return parsed.origin


def lookalike(host: str, approved_hosts: set[str]) -> bool:
    """A bounded warning only; string similarity cannot establish impersonation."""
    candidate = host.removeprefix("www.")
    for approved in list(sorted(approved_hosts))[:100]:
        expected = approved.removeprefix("www.")
        if candidate == expected:
            continue
        visual = str.maketrans({"0": "o", "1": "l", "3": "e", "5": "s"})
        if candidate.translate(visual) == expected.translate(visual):
            return True
        if abs(len(candidate) - len(expected)) > 1:
            continue
        # Edit distance one, including adjacent swaps. No new dependencies or PSL guesses.
        if len(candidate) == len(expected):
            positions = [i for i, (a, b) in enumerate(zip(candidate, expected)) if a != b]
            if len(positions) == 1 or (len(positions) == 2 and positions[1] == positions[0] + 1 and candidate[positions[0]:positions[1]+1] == expected[positions[0]:positions[1]+1][::-1]):
                return True
        else:
            longer, shorter = (candidate, expected) if len(candidate) > len(expected) else (expected, candidate)
            if any(longer[:i] + longer[i+1:] == shorter for i in range(len(longer))):
                return True
    return False
