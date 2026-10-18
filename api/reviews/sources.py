"""Bounded, read-only retrieval from explicitly configured WooCommerce stores.

The public Store API supplies written reviews, unlike aggregate product ratings.
Official contracts: https://developer.woocommerce.com/docs/apis/store-api/ and
https://developer.woocommerce.com/docs/apis/store-api/resources-endpoints/product-reviews

No arbitrary client URLs, scraping, credentials, or synthetic fallback are used.
Store configuration is an availability allowlist, never merchant verification.
"""

from __future__ import annotations

import asyncio
import copy
import ipaddress
import json
import re
import socket
import time
from collections import OrderedDict, deque
from collections.abc import Awaitable, Callable
from datetime import date, datetime, timezone
from decimal import Decimal, InvalidOperation
from html.parser import HTMLParser
from urllib.parse import urlencode, urlsplit, urlunsplit

import httpx

_SOURCE = "woocommerce"
_ID = re.compile(r"[1-9][0-9]{0,18}\Z")
_SLUG = re.compile(r"[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}\Z")
_MAX_RESPONSE_BYTES = 1_000_000
_PAGE_SIZE = 50
_MAX_PAGES = 2
_MAX_TEXT = 4000
_MAX_CACHE_ENTRIES = 128
_MAX_OPERATIONS_PER_MINUTE = 10


class _SourceError(Exception):
    """Only fixed, credential-free messages may cross the adapter boundary."""

    def __init__(self, message: str, *, rate_limited: bool = False, website_safety: dict | None = None):
        super().__init__(message)
        self.rate_limited = rate_limited
        self.website_safety = website_safety


class _PlainText(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self.hidden = 0

    def handle_starttag(self, tag, attrs):
        if tag in {"script", "style", "noscript", "template"}:
            self.hidden += 1
        elif tag in {"p", "br", "div", "li"} and not self.hidden:
            self.parts.append(" ")

    def handle_endtag(self, tag):
        if tag in {"script", "style", "noscript", "template"}:
            self.hidden = max(0, self.hidden - 1)
        elif tag in {"p", "div", "li"} and not self.hidden:
            self.parts.append(" ")

    def handle_data(self, data):
        if not self.hidden:
            self.parts.append(data)


def _plain(value: object, limit: int = _MAX_TEXT) -> str:
    if not isinstance(value, str):
        return ""
    parser = _PlainText()
    parser.feed(value)
    return " ".join("".join(parser.parts).split())[:limit]


def _timestamp() -> str:
    return datetime.now(timezone.utc).isoformat()


def _public_ip(value: str) -> bool:
    try:
        ip = ipaddress.ip_address(value)
        return ip.is_global and not (ip.is_multicast or ip.is_reserved or ip.is_unspecified)
    except ValueError:
        return False


async def _resolve_public(host: str) -> list[str]:
    # Run blocking system DNS outside the event loop. Every returned address must
    # be public; callers connect to the chosen numeric address, not a second lookup.
    result = await asyncio.get_running_loop().getaddrinfo(
        host, 443, type=socket.SOCK_STREAM,
    )
    return list(dict.fromkeys(item[4][0] for item in result))


def _base_url(value: object) -> str | None:
    if not isinstance(value, str) or len(value) > 500 or value != value.strip():
        return None
    try:
        parsed = urlsplit(value)
        host = parsed.hostname
        if (
            parsed.scheme != "https" or not host or parsed.port not in (None, 443)
            or parsed.username is not None or parsed.password is not None
            or parsed.query or parsed.fragment or any(ord(c) < 33 for c in value)
            or not re.fullmatch(r"[A-Za-z0-9/_-]*", parsed.path)
            or any(part == ".." for part in parsed.path.split("/"))
        ):
            return None
        host = host.encode("idna").decode("ascii").lower()
        if host == "localhost" or host.endswith((".localhost", ".local", ".internal", ".test")):
            return None
        try:
            if not _public_ip(str(ipaddress.ip_address(host))):
                return None
        except ValueError:
            if "." not in host or not re.fullmatch(r"[a-z0-9.-]+", host):
                return None
        netloc = f"[{host}]" if ":" in host else host
        return urlunsplit(("https", netloc, parsed.path.rstrip("/"), "", ""))
    except (ValueError, UnicodeError):
        return None


def _public_link(value: object, base: str) -> str | None:
    if not isinstance(value, str) or len(value) > 2000 or any(ord(c) < 32 for c in value):
        return None
    try:
        parsed, origin = urlsplit(value), urlsplit(base)
        if (
            parsed.scheme != "https" or parsed.hostname != origin.hostname
            or parsed.port not in (None, 443) or parsed.username is not None
            or parsed.password is not None
        ):
            return None
        return urlunsplit((parsed.scheme, parsed.netloc, parsed.path, parsed.query, ""))
    except ValueError:
        return None


def _nonnegative_int(value: object) -> int | None:
    if isinstance(value, bool) or not re.fullmatch(r"[0-9]{1,9}", str(value)):
        return None
    return int(value)


def _rating(value: object) -> str | None:
    if value is None or isinstance(value, bool):
        return None
    try:
        amount = Decimal(str(value))
        return str(amount) if amount.is_finite() and 1 <= amount <= 5 else None
    except (InvalidOperation, ValueError):
        return None


def _gmt_date(value: object) -> str | None:
    # date_created is store-local without a timezone. Never label it UTC.
    if not isinstance(value, str) or not value or value.startswith("0000-"):
        return None
    try:
        if re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
            return date.fromisoformat(value).isoformat()
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)  # GMT field is explicitly UTC.
        return parsed.astimezone(timezone.utc).isoformat()
    except (ValueError, OverflowError):
        return None


class ReviewSourceService:
    """One process-local, bounded cache and request budget for configured stores.

    Keep one service instance for cache/rate limits. Methods create and close their
    own HTTP clients; no shutdown hook is necessary. ``transport`` and ``resolver``
    are injection points for offline tests, never HTTP-request parameters.
    """

    def __init__(
        self, merchants: dict[str, str] | None = None, *, timeout_s: float = 10,
        cache_ttl_s: float = 300, max_reviews: int = 100,
        transport: httpx.AsyncBaseTransport | None = None,
        resolver: Callable[[str], Awaitable[list[str]]] | None = None,
        clock: Callable[[], float] = time.monotonic,
        url_gate: Callable | None = None,
    ):
        self._stores = {}
        for merchant, value in (merchants or {}).items():
            if isinstance(merchant, str) and _SLUG.fullmatch(merchant) and (base := _base_url(value)):
                self._stores[merchant] = base
        self._timeout = min(30.0, max(1.0, float(timeout_s)))
        self._ttl = min(3600.0, max(0.0, float(cache_ttl_s)))
        self._max_reviews = min(100, max(1, int(max_reviews)))
        self._transport = transport
        self._resolver = resolver or _resolve_public
        self._clock = clock
        self._url_gate = url_gate
        self._cache: OrderedDict[tuple, tuple[float, dict]] = OrderedDict()
        self._requests: dict[str, deque] = {}
        self._cooldown: dict[str, float] = {}
        self._locks: dict[str, asyncio.Lock] = {}

    def list_sources(self) -> list[dict]:
        return [
            {"source": _SOURCE, "merchant": merchant, "base_url": base,
             "configured": True, "capabilities": ["product_search", "product_reviews"],
             "requires_api_key": False, "merchant_safety_verified": False}
            for merchant, base in sorted(self._stores.items())
        ]

    def _cached(self, key: tuple) -> dict | None:
        entry = self._cache.get(key)
        if entry is None:
            return None
        if self._clock() - entry[0] >= self._ttl:
            del self._cache[key]
            return None
        self._cache.move_to_end(key)
        value = copy.deepcopy(entry[1])
        value["cache_hit"] = True
        return value

    def _remember(self, key: tuple, result: dict) -> dict:
        if self._ttl and result["status"] in {"ok", "empty"}:
            self._cache[key] = (self._clock(), copy.deepcopy(result))
            self._cache.move_to_end(key)
            while len(self._cache) > _MAX_CACHE_ENTRIES:
                self._cache.popitem(last=False)
        return result

    def _budget(self, merchant: str) -> bool:
        now = self._clock()
        attempts = self._requests.setdefault(merchant, deque())
        while attempts and now - attempts[0] >= 60:
            attempts.popleft()
        if self._cooldown.get(merchant, 0) > now or len(attempts) >= _MAX_OPERATIONS_PER_MINUTE:
            return False
        attempts.append(now)
        return True

    async def _address(self, base: str) -> str:
        host = urlsplit(base).hostname
        try:
            addresses = await asyncio.wait_for(self._resolver(host), timeout=self._timeout)
        except (OSError, asyncio.TimeoutError):
            raise _SourceError("Merchant hostname could not be safely resolved.") from None
        if not addresses or any(not _public_ip(address) for address in addresses):
            raise _SourceError("Merchant hostname must resolve only to public network addresses.")
        return addresses[0]

    async def _json(self, client, base, address, path, params, merchant):
        origin = urlsplit(base)
        logical = f"{base}/wp-json/wc/store/v1/{path}"
        if params:
            logical += "?" + urlencode(params)
        await self._authorize_url(logical, merchant, "fetch")
        # Numeric connection target prevents DNS rebinding after address checks.
        # Host and TLS SNI retain the configured hostname, including certificate checks.
        target_host = f"[{address}]" if ":" in address else address
        target = f"https://{target_host}{origin.path}/wp-json/wc/store/v1/{path}"
        try:
            async with asyncio.timeout(self._timeout), client.stream(
                "GET", target, params=params,
                headers={"Host": origin.hostname, "Accept": "application/json",
                         "User-Agent": "Conjure-Review-Insights/1.0", "Accept-Encoding": "identity"},
                extensions={"sni_hostname": origin.hostname},
            ) as response:
                if response.status_code == 429:
                    retry = _nonnegative_int(response.headers.get("retry-after"))
                    self._cooldown[merchant] = self._clock() + min(300, max(1, retry or 60))
                    raise _SourceError("Merchant temporarily rate-limited review requests.", rate_limited=True)
                if response.status_code != 200:
                    raise _SourceError("Merchant endpoint is unavailable or refused the request.")
                if "json" not in response.headers.get("content-type", "").lower():
                    raise _SourceError("Merchant endpoint did not return JSON data.")
                if response.headers.get("content-encoding", "identity").lower() != "identity":
                    # We requested an uncompressed representation. Do not let an
                    # untrusted compressed chunk expand before our byte counter.
                    raise _SourceError("Merchant did not honor the uncompressed response requirement.")
                length = _nonnegative_int(response.headers.get("content-length"))
                if length is not None and length > _MAX_RESPONSE_BYTES:
                    raise _SourceError("Merchant response exceeded the permitted size.")
                content = bytearray()
                async for chunk in response.aiter_bytes():
                    content.extend(chunk)
                    if len(content) > _MAX_RESPONSE_BYTES:
                        raise _SourceError("Merchant response exceeded the permitted size.")
                try:
                    return json.loads(content), dict(response.headers)
                except (ValueError, UnicodeError, RecursionError):
                    raise _SourceError("Merchant endpoint returned invalid JSON.") from None
        except (httpx.HTTPError, asyncio.TimeoutError):
            raise _SourceError("Merchant request failed or timed out.") from None

    def _client(self):
        return httpx.AsyncClient(
            transport=self._transport, timeout=httpx.Timeout(self._timeout),
            follow_redirects=False, trust_env=False,
            limits=httpx.Limits(max_connections=2, max_keepalive_connections=0),
        )

    async def _authorize_url(self, url: str, merchant: str, purpose: str):
        if self._url_gate is None:
            # Low-level transport tests can inject their own policy. Public API
            # construction always supplies the website gate.
            return
        result = await self._url_gate(url, merchant, purpose)
        if not result.allowed:
            raise _SourceError("Website identity/reputation policy did not allow this action.",
                website_safety=result.model_dump(mode="json"))
        return result.model_dump(mode="json")

    async def _cached_gate(self, result: dict, merchant: str) -> dict:
        """Recheck links even when the product/review cache is still fresh."""
        try:
            for row in result.get("products", []):
                if row.get("url") and (assessment := await self._authorize_url(row["url"], merchant, "link")):
                    row["website_safety"] = assessment
            if result.get("product_url") and (assessment := await self._authorize_url(result["product_url"], merchant, "link")):
                result["website_safety"] = assessment
        except _SourceError as exc:
            result.update(status="blocked" if exc.website_safety and exc.website_safety["decision"] == "blocked" else "safety_hold",
                products=[], analysis_request=None, warnings=[str(exc)], website_safety=exc.website_safety)
            if "product_url" in result:
                result.update(product_url=None, returned_count=0)
                result["product"].pop("url", None)
        return result

    async def search_products(self, merchant: str, query: str, limit: int = 5) -> dict:
        result = {"status": "not_configured", "source": _SOURCE, "merchant": merchant,
                  "products": [], "retrieved_at": None, "cache_hit": False, "warnings": []}
        if merchant not in self._stores:
            result["warnings"] = ["Select a server-configured WooCommerce merchant."]
            return result
        if not isinstance(query, str) or not 2 <= len(query.strip()) <= 150 or not isinstance(limit, int) or isinstance(limit, bool) or not 1 <= limit <= 5:
            result.update(status="invalid_request", warnings=["Search needs 2–150 characters and a limit from 1 to 5."])
            return result
        query = query.strip()
        key = ("search", merchant, query.casefold(), limit)
        if cached := self._cached(key):
            return await self._cached_gate(cached, merchant)
        lock = self._locks.setdefault(merchant, asyncio.Lock())
        if lock.locked() or not self._budget(merchant):
            result.update(status="rate_limited", warnings=["Merchant request budget is temporarily exhausted."])
            return result
        async with lock:
            base = self._stores[merchant]
            try:
                address = await self._address(base)
                async with self._client() as client:
                    payload, _ = await self._json(client, base, address, "products", {"search": query, "per_page": limit}, merchant)
                if not isinstance(payload, list):
                    raise _SourceError("Merchant product response has an unexpected shape.")
                for item in payload[:limit]:
                    if not isinstance(item, dict) or not _ID.fullmatch(str(item.get("id", ""))):
                        continue
                    name, url = _plain(item.get("name"), 300), _public_link(item.get("permalink"), base)
                    if not name or not url:
                        continue
                    assessment = await self._authorize_url(url, merchant, "link")
                    product = {"source": _SOURCE, "external_id": str(item["id"]), "merchant": merchant, "url": url}
                    result["products"].append({"product": product, "name": name, "url": url,
                        "review_count": _nonnegative_int(item.get("review_count")),
                        "average_rating": _rating(item.get("average_rating"))})
                    if assessment:
                        result["products"][-1]["website_safety"] = assessment
                result.update(status="ok" if result["products"] else "empty", retrieved_at=_timestamp())
            except _SourceError as exc:
                result.update(status="rate_limited" if exc.rate_limited else "unavailable", warnings=[str(exc)])
                if exc.website_safety is not None:
                    result.update(status="blocked" if exc.website_safety["decision"] == "blocked" else "safety_hold", products=[], website_safety=exc.website_safety)
        return self._remember(key, result)

    async def fetch_reviews(self, source: str, external_id: str, merchant: str | None = None, limit: int = 50) -> dict:
        product = {"source": source, "external_id": external_id, "merchant": merchant}
        result = {"status": "not_configured", "source": source, "merchant": merchant,
                  "product": product, "product_name": None, "product_url": None,
                  "retrieved_at": None, "cache_hit": False, "reported_total": None,
                  "returned_count": 0, "sample_selection": "recent", "truncated": False,
                  "warnings": [], "analysis_request": None}
        if source != _SOURCE:
            result.update(status="unsupported_source", warnings=["Written-review retrieval currently supports configured WooCommerce stores only."])
            return result
        if merchant not in self._stores:
            result["warnings"] = ["Select a server-configured WooCommerce merchant; no demo data was substituted."]
            return result
        if not isinstance(external_id, str) or not _ID.fullmatch(external_id) or not isinstance(limit, int) or isinstance(limit, bool) or not 1 <= limit <= self._max_reviews:
            result.update(status="invalid_request", warnings=["Provide an exact numeric product ID and an allowed review limit."])
            return result
        key = ("reviews", merchant, external_id, limit)
        if cached := self._cached(key):
            return await self._cached_gate(cached, merchant)
        lock = self._locks.setdefault(merchant, asyncio.Lock())
        if lock.locked() or not self._budget(merchant):
            result.update(status="rate_limited", warnings=["Merchant request budget is temporarily exhausted."])
            return result
        async with lock:
            base = self._stores[merchant]
            reviews, seen = [], set()
            skipped = truncated_text = 0
            trimmed_for_limit = False
            complete = False
            try:
                address = await self._address(base)
                async with self._client() as client:
                    item, _ = await self._json(client, base, address, f"products/{external_id}", {}, merchant)
                    if not isinstance(item, dict) or str(item.get("id")) != external_id:
                        raise _SourceError("Merchant returned a different product identity.")
                    product_url = _public_link(item.get("permalink"), base)
                    if not product_url:
                        raise _SourceError("Merchant returned no valid same-store product link.")
                    assessment = await self._authorize_url(product_url, merchant, "link")
                    product["url"] = product_url
                    result.update(product_name=_plain(item.get("name"), 300) or None, product_url=product_url)
                    if assessment:
                        result["website_safety"] = assessment
                    page_size = min(_PAGE_SIZE, limit)
                    for page in range(1, _MAX_PAGES + 1):
                        rows, headers = await self._json(client, base, address, "products/reviews", {
                            "product_id": external_id, "per_page": page_size,
                            "page": page, "orderby": "date_gmt", "order": "desc",
                        }, merchant)
                        if not isinstance(rows, list) or len(rows) > page_size:
                            raise _SourceError("Merchant review response has an unexpected shape.")
                        total = _nonnegative_int(headers.get("x-wp-total"))
                        if total is not None:
                            result["reported_total"] = total
                        for row in rows:
                            if len(reviews) >= limit:
                                trimmed_for_limit = True
                                break
                            if not isinstance(row, dict) or str(row.get("product_id")) != external_id:
                                skipped += 1
                                continue
                            review_id = str(row.get("id", ""))
                            if not _ID.fullmatch(review_id) or review_id in seen:
                                skipped += 1
                                continue
                            if _public_link(row.get("product_permalink"), base) != product_url:
                                skipped += 1
                                continue
                            text = _plain(row.get("review"), _MAX_TEXT + 1)
                            if not text:
                                skipped += 1
                                continue
                            if len(text) > _MAX_TEXT:
                                truncated_text += 1
                            seen.add(review_id)
                            reviews.append({
                                "review_id": review_id, "product": dict(product), "text": text[:_MAX_TEXT], "title": "",
                                "rating": _rating(row.get("rating")), "rating_scale": 5,
                                "published_at": _gmt_date(row.get("date_created_gmt")),
                                "source_url": product_url + "#comment-" + review_id,
                                "verified_purchase": row.get("verified") if isinstance(row.get("verified"), bool) else None,
                            })
                        total_pages = _nonnegative_int(headers.get("x-wp-totalpages"))
                        if len(rows) < page_size or (total_pages is not None and page >= total_pages):
                            complete = True
                            break
                        if len(reviews) >= limit:
                            # A full last page alone is insufficient to establish completeness.
                            complete = result["reported_total"] is not None and result["reported_total"] <= page * page_size
                            break
                result.update(status="ok" if reviews else "empty", retrieved_at=_timestamp())
            except _SourceError as exc:
                result.update(status="partial" if reviews else ("rate_limited" if exc.rate_limited else "unavailable"),
                              retrieved_at=_timestamp() if reviews else None)
                result["warnings"].append(str(exc))
                if exc.website_safety is not None:
                    result.update(status="blocked" if exc.website_safety["decision"] == "blocked" else "safety_hold",
                        website_safety=exc.website_safety, product_url=None)
                    product.pop("url", None)
                    reviews = []
            if skipped:
                result["warnings"].append(f"Excluded {skipped} duplicate, mismatched, or unusable review records.")
            if truncated_text:
                result["warnings"].append(f"Truncated {truncated_text} review texts to {_MAX_TEXT} characters; analysis covers retained text only.")
            if result["status"] in {"ok", "partial", "empty"}:
                # Reaching the last upstream page is insufficient when we retain
                # only part of that page. Completeness describes returned usable
                # reviews, not how many pages the HTTP client reached.
                if trimmed_for_limit or (
                    result["reported_total"] is not None
                    and len(reviews) < result["reported_total"]
                ):
                    complete = False
                if result["reported_total"] is not None and result["reported_total"] < len(reviews):
                    result["reported_total"] = None
                    complete = False
                    result["warnings"].append("Merchant pagination total conflicts with retrieved reviews; total remains unknown.")
                result.update(returned_count=len(reviews), truncated=not complete or bool(skipped or truncated_text))
                result["warnings"].append("This is the newest available retrieved sample, not necessarily all customer reviews or a representative sample.")
                if not reviews:
                    result["warnings"].append("No public written reviews were returned; this does not prove that no reviews exist.")
                result["analysis_request"] = {
                    "product": dict(product), "reviews": reviews, "provenance": "live",
                    "retrieved_at": result["retrieved_at"], "reported_total": result["reported_total"],
                    "sample_selection": "recent",
                }
        return self._remember(key, result)
