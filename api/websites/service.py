"""Action-specific website gate. A negative threat lookup never verifies a merchant."""

from __future__ import annotations

import asyncio
import copy
import ipaddress
import socket
import time
from collections import OrderedDict, deque
from collections.abc import Awaitable, Callable
from datetime import datetime, timedelta, timezone
from functools import lru_cache
from urllib.parse import urlsplit

from pydantic import ValidationError

from api.websites.models import Evidence, MerchantRegistration, Purpose, WebsiteAssessment
from api.websites.reputation import ReputationClient
from api.websites.urls import URLRejected, canonical_url, configured_origin, fingerprint, lookalike


async def public_addresses(host: str) -> list[str]:
    rows = await asyncio.get_running_loop().getaddrinfo(host, 443, type=socket.SOCK_STREAM)
    return list(dict.fromkeys(row[4][0] for row in rows))


class WebsiteSafetyService:
    def __init__(self, registrations: dict | None = None, *, blocked_hosts: list[str] | None = None,
                 reputation: ReputationClient | None = None, timeout_s: float = 5,
                 cache_ttl_s: int = 300, requests_per_minute: int = 30,
                 resolver: Callable[[str], Awaitable[list[str]]] = public_addresses,
                 clock: Callable[[], float] = time.monotonic):
        self.registrations: dict[str, MerchantRegistration] = {}
        self._origins: dict[str, set[str]] = {}
        self._checkout_origins: dict[str, set[str]] = {}
        self._configuration_valid = True
        for merchant_id, raw in (registrations or {}).items():
            try:
                config = MerchantRegistration.model_validate(raw)
                origins = {configured_origin(url) for url in config.origins}
                payments = {configured_origin(url) for url in config.payment_origins}
                if config.checkout_url:
                    checkout = canonical_url(config.checkout_url)
                    if checkout.origin not in origins | payments:
                        raise ValueError("Checkout origin must be explicitly registered")
                    config.checkout_url = checkout.url
                self.registrations[merchant_id] = config
                self._origins[merchant_id] = origins
                self._checkout_origins[merchant_id] = origins | payments
            except (ValidationError, ValueError, TypeError):
                self._configuration_valid = False
        self._blocked = set()
        for host in blocked_hosts or []:
            try:
                self._blocked.add(urlsplit(configured_origin("https://" + host)).hostname)
            except (ValueError, TypeError):
                self._configuration_valid = False
        self._reputation = reputation or ReputationClient()
        self._resolver, self._clock = resolver, clock
        self._timeout = min(10.0, max(.1, timeout_s))
        self._ttl = min(300, max(0, cache_ttl_s))
        self._rpm = min(100, max(1, requests_per_minute))
        self._attempts: deque[float] = deque()
        self._rep_cache = OrderedDict()
        self._assessments = OrderedDict()
        self._slots = asyncio.Semaphore(4)

    def configuration(self) -> dict:
        return {"merchants": [{"merchant_id": key, "origins": sorted(self._origins[key]),
                    "checkout_configured": bool(config.checkout_url)} for key, config in self.registrations.items()],
                "reputation_providers": self._reputation.configuration(),
                "configuration_valid": self._configuration_valid,
                "unknown_policy": "hold", "safety_guaranteed": False}

    def _budget(self) -> bool:
        clock = self._clock()
        while self._attempts and clock - self._attempts[0] >= 60:
            self._attempts.popleft()
        if len(self._attempts) >= self._rpm:
            return False
        self._attempts.append(clock)
        return True

    async def _lookup(self, url: str):
        key = fingerprint(url)
        now = datetime.now(timezone.utc)
        entry = self._rep_cache.get(key)
        if entry and self._clock() < entry[0] and all(r.expires_at is None or r.expires_at > now for r in entry[1]):
            self._rep_cache.move_to_end(key)
            return [r.model_copy(update={"cache_hit": True}) for r in entry[1]]
        if not self._budget():
            return []
        acquired = False
        try:
            await asyncio.wait_for(self._slots.acquire(), timeout=.05)
            acquired = True
            async with asyncio.timeout(self._timeout + .2):
                rows = await self._reputation.check(url)
        except Exception:
            # A provider implementation/schema failure must fail closed too.
            # Cancellation is a BaseException and still propagates normally.
            return []
        finally:
            if acquired:
                self._slots.release()
        if rows and self._ttl:
            ttl = min(self._ttl, 15 if any(r.status == "unknown" for r in rows) else self._ttl)
            for row in rows:
                if row.expires_at:
                    ttl = min(ttl, max(0, (row.expires_at - now).total_seconds()))
            self._rep_cache[key] = (self._clock() + ttl, copy.deepcopy(rows))
            self._rep_cache.move_to_end(key)
            while len(self._rep_cache) > 128:
                self._rep_cache.popitem(last=False)
        return rows

    def _remember(self, result: WebsiteAssessment) -> WebsiteAssessment:
        key = (result.merchant_id, result.purpose, result.url_sha256)
        self._assessments[key] = result.model_copy(deep=True)
        self._assessments.move_to_end(key)
        while len(self._assessments) > 256:
            self._assessments.popitem(last=False)
        return result

    async def assess(self, url: str, merchant_id: str | None = None, purpose: Purpose = "link") -> WebsiteAssessment:
        now = datetime.now(timezone.utc)
        evidence = []
        base = dict(purpose=purpose, merchant_id=merchant_id, origin=None, url_sha256=fingerprint(url),
                    checked_at=now, identity="invalid", reputation="unknown", evidence=evidence, providers=[],
                    limitations=["No website assessment guarantees merchant honesty, product quality, fulfillment, or payment safety.",
                        "Threat lists can miss new attacks and cover only their configured categories. PhishTank covers reported phishing, not malware scanning. Operator mappings are not independent business verification.",
                        "The target page was not visited. TLS certificates must still validate when the actual client connects; redirects require a separate destination check."])
        try:
            parsed = canonical_url(url)
        except URLRejected as exc:
            evidence.append(Evidence(code=exc.code, status="fail", detail=exc.detail))
            return self._remember(WebsiteAssessment(**base, decision="blocked", allowed=False, summary=exc.detail))
        base.update(origin=parsed.origin, url_sha256=fingerprint(parsed.url))
        evidence.append(Evidence(code="url_format", status="pass", detail="An unambiguous HTTPS URL without embedded credentials was parsed."))
        if any(parsed.host == host or parsed.host.endswith("." + host) for host in self._blocked):
            evidence.append(Evidence(code="local_blocklist", status="fail", detail="Destination matches an operator-blocked hostname."))
            return self._remember(WebsiteAssessment(**base, decision="blocked", allowed=False, summary="Destination is blocked by local policy."))
        if merchant_id is None and purpose != "checkout":
            matches = [mid for mid, origins in self._origins.items() if parsed.origin in origins]
            if len(matches) == 1:
                merchant_id = matches[0]
                base["merchant_id"] = merchant_id
        approved = self._checkout_origins.get(merchant_id, set()) if purpose == "checkout" else self._origins.get(merchant_id, set())
        identity = "approved_destination" if parsed.origin in approved else "mismatch" if merchant_id in self.registrations else "unrecognized"
        base["identity"] = identity
        evidence.append(Evidence(code="merchant_identity", status="pass" if identity == "approved_destination" else "unknown",
            detail="Exact origin matches the operator's registration for this merchant/action." if identity == "approved_destination" else "Destination is not registered for the requested merchant/action; no approval was inferred."))
        hosts = {urlsplit(origin).hostname for origins in self._origins.values() for origin in origins}
        if lookalike(parsed.host, hosts):
            evidence.append(Evidence(code="possible_lookalike", status="warning", detail="Hostname resembles a registered destination. Similarity alone does not establish impersonation."))
        if parsed.warning_codes:
            evidence.append(Evidence(code="international_hostname", status="warning", detail="An encoded international hostname needs deliberate operator registration; its spelling does not prove fraud."))
        rows = await self._lookup(parsed.url)
        base["providers"] = rows
        reputation = "known_malicious" if any(r.status == "known_malicious" for r in rows) else "reported" if any(r.status == "reported" for r in rows) else "no_known_threat" if rows and all(r.status == "no_known_threat" for r in rows) else "unknown"
        base["reputation"] = reputation
        evidence.append(Evidence(code="url_reputation", status="fail" if reputation == "known_malicious" else "pass" if reputation == "no_known_threat" else "unknown",
            detail="A configured provider returned an active threat match." if reputation == "known_malicious" else "Configured lookups found no known threat; this does not certify the merchant." if reputation == "no_known_threat" else "Required reputation evidence is unavailable, incomplete, or unresolved; the action is held."))
        if reputation == "known_malicious":
            return self._remember(WebsiteAssessment(**base, decision="blocked", allowed=False, summary="Known threat detected. Do not fetch, recommend this link, or proceed to checkout."))
        if not self._configuration_valid:
            evidence.append(Evidence(code="configuration", status="unknown", detail="Website identity configuration contains invalid entries; correct it before allowing actions."))
        allowed = identity == "approved_destination" and reputation == "no_known_threat" and self._configuration_valid
        if identity == "mismatch":
            return self._remember(WebsiteAssessment(**base, decision="blocked", allowed=False, summary="Destination does not match the merchant/action registration."))
        if allowed:
            try:
                addresses = await asyncio.wait_for(self._resolver(parsed.host), self._timeout)
                public = bool(addresses) and all(ipaddress.ip_address(a).is_global and not (
                    ipaddress.ip_address(a).is_multicast or ipaddress.ip_address(a).is_reserved
                    or ipaddress.ip_address(a).is_unspecified) for a in addresses)
            except (OSError, ValueError, TimeoutError):
                addresses, public = [], False
            evidence.append(Evidence(code="public_network", status="pass" if public else "fail" if addresses else "unknown",
                detail="Hostname resolved only to public addresses; the fetching client must pin and revalidate its connection." if public else "A public-only network destination could not be established."))
            allowed = public
            if addresses and not public:
                return self._remember(WebsiteAssessment(**base, decision="blocked", allowed=False, summary="Non-public destination blocked."))
        expiry = min([now + timedelta(seconds=self._ttl)] + [r.expires_at for r in rows if r.expires_at]) if allowed else None
        return self._remember(WebsiteAssessment(**base, decision="allowed" if allowed else "hold", allowed=allowed,
            expires_at=expiry, summary=f"Policy checks allow this {purpose} attempt; this is not a guarantee of safety." if allowed else "Evidence is insufficient to allow this action. Review the identity and reputation checks."))

    async def assess_checkout(self, merchant_id: str) -> WebsiteAssessment:
        config = self.registrations.get(merchant_id)
        if config and config.checkout_url:
            return await self.assess(config.checkout_url, merchant_id, "checkout")
        now = datetime.now(timezone.utc)
        return WebsiteAssessment(decision="hold", allowed=False, purpose="checkout", merchant_id=merchant_id,
            origin=None, url_sha256=fingerprint(""), checked_at=now, identity="unrecognized", reputation="unknown",
            evidence=[Evidence(code="checkout_destination_missing", status="unknown", detail="No server-registered checkout destination exists for this merchant.")], providers=[],
            summary="Checkout destination is unknown; no external payment is authorized.", limitations=["A catalog approval flag is not external website verification."])

    def checkout_snapshot(self, merchant_id: str) -> tuple[str | None, WebsiteAssessment | None]:
        config = self.registrations.get(merchant_id)
        url = config.checkout_url if config else None
        result = self._assessments.get((merchant_id, "checkout", fingerprint(url))) if url else None
        if result is not None:
            result = result.model_copy(deep=True)
            if result.expires_at is None or result.expires_at <= datetime.now(timezone.utc):
                result.allowed = False
                if result.decision == "allowed":
                    result.decision = "hold"
                    result.summary = "Checkout evidence expired; recheck the destination."
        return url, result


@lru_cache(maxsize=1)
def safety_service() -> WebsiteSafetyService:
    from api.config import get_settings
    settings = get_settings()
    return WebsiteSafetyService(settings.website_merchants, blocked_hosts=settings.website_blocked_hosts,
        reputation=ReputationClient(webrisk_key=settings.website_webrisk_api_key,
            phishtank_enabled=settings.website_phishtank_enabled, phishtank_key=settings.website_phishtank_api_key,
            timeout_s=settings.website_lookup_timeout_s), timeout_s=settings.website_lookup_timeout_s,
        cache_ttl_s=settings.website_cache_ttl_s, requests_per_minute=settings.website_lookup_requests_per_minute)
