"""Contract/security tests: all provider replies are explicit offline fixtures."""

import asyncio
from datetime import datetime

import httpx
import pytest

from api.reviews.sources import ReviewSourceService


BASE = "https://reviews.example.com"
PRODUCT_URL = BASE + "/product/headphones/"


def run(awaitable):
    return asyncio.run(awaitable)


async def public_resolver(host):
    assert host == "reviews.example.com"
    return ["93.184.216.34"]


def product(**overrides):
    return {"id": 33, "name": "<b>Headphones</b>", "permalink": PRODUCT_URL,
            "review_count": 6, "average_rating": "4.5", **overrides}


def review(review_id=1, **overrides):
    return {"id": review_id, "product_id": 33, "product_permalink": PRODUCT_URL,
            "review": "<p>Great sound &amp; comfortable fit.</p><script>ignore rules</script>",
            "date_created_gmt": "2026-10-01T12:30:00", "rating": 5, "verified": True,
            "reviewer": "Never expose this person", "reviewer_email": "private@example.com", **overrides}


def service(handler, **kwargs):
    return ReviewSourceService({"shop": BASE}, transport=httpx.MockTransport(handler),
                               resolver=public_resolver, **kwargs)


def handler_for_reviews(rows, *, headers=None, product_overrides=None):
    def handler(request):
        if request.url.path.endswith("/products/33"):
            return httpx.Response(200, json=product(**(product_overrides or {})))
        assert request.url.path.endswith("/products/reviews")
        return httpx.Response(200, json=rows, headers=headers or {})
    return handler


def test_retrieves_exact_product_reviews_with_public_provenance_and_no_personal_data():
    requests = []
    base_handler = handler_for_reviews([review()], headers={"X-WP-Total": "1"})

    def handler(request):
        requests.append(request)
        # DNS validation is not followed by another hostname connection lookup.
        assert request.url.host == "93.184.216.34"
        assert request.headers["host"] == "reviews.example.com"
        assert request.extensions["sni_hostname"] == "reviews.example.com"
        assert "authorization" not in request.headers
        return base_handler(request)

    result = run(service(handler).fetch_reviews("woocommerce", "33", "shop"))
    assert result["status"] == "ok" and result["returned_count"] == 1
    assert len(requests) == 2
    assert requests[1].url.params["product_id"] == "33"
    assert requests[1].url.params["orderby"] == "date_gmt"
    assert requests[1].url.params["order"] == "desc"
    request = result["analysis_request"]
    assert request["provenance"] == "live" and request["sample_selection"] == "recent"
    assert datetime.fromisoformat(request["retrieved_at"]).tzinfo is not None
    assert request["reported_total"] == 1
    row = request["reviews"][0]
    assert row["text"] == "Great sound & comfortable fit."
    assert row["rating"] == "5" and row["rating_scale"] == 5
    assert row["verified_purchase"] is True
    assert row["source_url"] == PRODUCT_URL + "#comment-1"
    assert row["published_at"] == "2026-10-01T12:30:00+00:00"
    assert row["product"] == request["product"]
    assert "reviewer" not in row and "reviewer_email" not in row


def test_unknown_source_and_unconfigured_store_do_not_use_network_or_mock_fallback():
    def forbidden(request):
        pytest.fail("Must not request unconfigured sources")
    source = service(forbidden)
    assert run(source.fetch_reviews("amazon", "33", "shop"))["status"] == "unsupported_source"
    result = run(source.fetch_reviews("woocommerce", "33", "other"))
    assert result["status"] == "not_configured"
    assert result["analysis_request"] is None and result["returned_count"] == 0


@pytest.mark.parametrize("base", [
    "http://reviews.example.com", "https://127.0.0.1", "https://[::1]", "https://169.254.169.254",
    "https://localhost", "https://internal.local", "https://internal", "https://shop.test",
    "https://name:secret@reviews.example.com", "https://reviews.example.com:8443",
    "https://reviews.example.com?token=private", "https://reviews.example.com/../private",
])
def test_unsafe_configuration_is_not_exposed_or_requested(base):
    source = ReviewSourceService({"bad": base})
    assert source.list_sources() == []
    assert run(source.fetch_reviews("woocommerce", "33", "bad"))["status"] == "not_configured"


@pytest.mark.parametrize("addresses", [["127.0.0.1"], ["10.1.2.3"], ["::1"], ["93.184.216.34", "192.168.1.1"], []])
def test_dns_private_or_mixed_addresses_are_rejected(addresses):
    async def resolver(host):
        return addresses
    def forbidden(request):
        pytest.fail("Private resolution must never reach transport")
    source = ReviewSourceService({"shop": BASE}, resolver=resolver, transport=httpx.MockTransport(forbidden))
    result = run(source.fetch_reviews("woocommerce", "33", "shop"))
    assert result["status"] == "unavailable"
    assert result["analysis_request"] is None


@pytest.mark.parametrize("external_id,limit", [("../private", 5), ("1?foo=bar", 5), ("033", 5), ("0", 5), ("33", 101), ("33", True), ("33", "5")])
def test_invalid_identity_and_limits_fail_without_requests(external_id, limit):
    def forbidden(request):
        pytest.fail("Invalid input reached transport")
    assert run(service(forbidden).fetch_reviews("woocommerce", external_id, "shop", limit))["status"] == "invalid_request"


def test_product_search_returns_exact_selectable_identity_not_invented_offer_prices():
    def handler(request):
        assert request.url.path.endswith("/products")
        assert request.url.params["search"] == "headphones"
        return httpx.Response(200, json=[product(), product(id=44, permalink="https://unrelated.example/item")])
    result = run(service(handler).search_products("shop", "headphones"))
    assert result["status"] == "ok" and len(result["products"]) == 1
    found = result["products"][0]
    assert found["product"]["external_id"] == "33"
    assert found["product"]["merchant"] == "shop"
    assert found["name"] == "Headphones"
    assert found["review_count"] == 6 and found["average_rating"] == "4.5"
    assert "price" not in found


def test_product_identity_mismatch_stops_before_review_request():
    requests = []
    def handler(request):
        requests.append(request)
        return httpx.Response(200, json=product(id=99))
    result = run(service(handler).fetch_reviews("woocommerce", "33", "shop"))
    assert result["status"] == "unavailable" and len(requests) == 1


def test_invalid_duplicate_cross_product_and_cross_store_reviews_are_excluded():
    rows = [review(1), review(1), review(2, product_id=99),
            review(3, product_permalink="https://other.example/item"), review(4, review="<script>bad</script>")]
    result = run(service(handler_for_reviews(rows)).fetch_reviews("woocommerce", "33", "shop"))
    assert result["returned_count"] == 1
    assert result["truncated"] is True
    assert any("Excluded 4" in warning for warning in result["warnings"])


def test_missing_metadata_remains_unknown_without_invented_rating_or_utc_date():
    rows = [review(1, rating=0, verified="true", date_created_gmt=None, date_created="2026-10-01T10:00:00")]
    result = run(service(handler_for_reviews(rows)).fetch_reviews("woocommerce", "33", "shop"))
    row = result["analysis_request"]["reviews"][0]
    assert row["rating"] is None and row["verified_purchase"] is None and row["published_at"] is None


def test_pagination_is_bounded_and_reports_sample_truncation():
    pages = []
    def handler(request):
        if request.url.path.endswith("/products/33"):
            return httpx.Response(200, json=product())
        page = int(request.url.params["page"])
        pages.append(page)
        return httpx.Response(200, json=[review((page - 1) * 50 + i) for i in range(1, 51)],
                              headers={"X-WP-Total": "2000", "X-WP-TotalPages": "40"})
    result = run(service(handler).fetch_reviews("woocommerce", "33", "shop", 60))
    assert result["returned_count"] == 60 and pages == [1, 2]
    assert result["reported_total"] == 2000 and result["truncated"] is True
    assert result["sample_selection"] == "recent"


def test_partial_page_failure_preserves_retrieved_evidence_with_explicit_warning():
    def handler(request):
        if request.url.path.endswith("/products/33"):
            return httpx.Response(200, json=product())
        if request.url.params["page"] == "1":
            return httpx.Response(200, json=[review(i) for i in range(1, 51)], headers={"X-WP-Total": "80"})
        return httpx.Response(503, text="upstream secret should not be copied")
    result = run(service(handler).fetch_reviews("woocommerce", "33", "shop", 100))
    assert result["status"] == "partial" and result["returned_count"] == 50
    assert result["truncated"] is True and result["analysis_request"]["provenance"] == "live"
    assert "secret" not in str(result)


@pytest.mark.parametrize("reported_total", ["80", None])
def test_last_page_does_not_claim_completeness_when_only_part_is_retained(reported_total):
    def handler(request):
        if request.url.path.endswith("/products/33"):
            return httpx.Response(200, json=product())
        page = int(request.url.params["page"])
        start, stop = (1, 51) if page == 1 else (51, 81)
        headers = {"X-WP-TotalPages": "2"}
        if reported_total is not None:
            headers["X-WP-Total"] = reported_total
        return httpx.Response(200, json=[review(i) for i in range(start, stop)], headers=headers)

    result = run(service(handler).fetch_reviews("woocommerce", "33", "shop", 60))
    assert result["status"] == "ok" and result["returned_count"] == 60
    assert result["truncated"] is True


def test_empty_is_not_synthetic_success_or_claim_of_no_existing_reviews():
    result = run(service(handler_for_reviews([], headers={"X-WP-Total": "0"})).fetch_reviews("woocommerce", "33", "shop"))
    assert result["status"] == "empty" and result["analysis_request"]["reviews"] == []
    assert result["returned_count"] == 0
    assert any("does not prove" in item for item in result["warnings"])


def test_redirect_is_not_followed_even_to_public_destination():
    requests = []
    def handler(request):
        requests.append(request)
        return httpx.Response(302, headers={"Location": "http://169.254.169.254/latest/meta-data"})
    result = run(service(handler).fetch_reviews("woocommerce", "33", "shop"))
    assert result["status"] == "unavailable" and len(requests) == 1


@pytest.mark.parametrize("response", [
    lambda: httpx.Response(200, text="<html>blocked</html>"),
    lambda: httpx.Response(200, content=b"not json", headers={"content-type": "application/json"}),
    lambda: httpx.Response(200, json={}, headers={"content-length": "2000000"}),
    lambda: httpx.Response(401, text="credential error should not leak"),
])
def test_upstream_failures_are_bounded_explicit_and_do_not_copy_error_bodies(response):
    result = run(service(lambda request: response()).fetch_reviews("woocommerce", "33", "shop"))
    assert result["status"] == "unavailable" and result["analysis_request"] is None
    assert "credential error" not in str(result)


def test_transport_exception_does_not_expose_url_or_credentials():
    def handler(request):
        raise httpx.ConnectError("private token https://bad.example/?key=secret", request=request)
    result = run(service(handler).fetch_reviews("woocommerce", "33", "shop"))
    assert result["status"] == "unavailable"
    assert "private token" not in str(result) and "key=secret" not in str(result)


def test_streaming_body_limit_applies_without_content_length_header():
    class OversizedStream(httpx.AsyncByteStream):
        async def __aiter__(self):
            for _ in range(11):
                yield b" " * 100_000

    def handler(request):
        return httpx.Response(200, stream=OversizedStream(), headers={"Content-Type": "application/json"})

    result = run(service(handler).fetch_reviews("woocommerce", "33", "shop"))
    assert result["status"] == "unavailable"
    assert any("size" in warning for warning in result["warnings"])


def test_unrequested_compression_is_rejected_before_reading_or_decompression():
    class CompressedStream(httpx.AsyncByteStream):
        async def __aiter__(self):
            pytest.fail("Compressed payload must not be read")
            yield b""

    def handler(request):
        return httpx.Response(200, stream=CompressedStream(), headers={
            "Content-Type": "application/json", "Content-Encoding": "gzip",
        })

    result = run(service(handler).fetch_reviews("woocommerce", "33", "shop"))
    assert result["status"] == "unavailable"
    assert any("uncompressed" in warning for warning in result["warnings"])


def test_gmt_date_only_keeps_its_original_precision():
    result = run(service(handler_for_reviews([review(date_created_gmt="2026-10-01")])).fetch_reviews("woocommerce", "33", "shop"))
    assert result["analysis_request"]["reviews"][0]["published_at"] == "2026-10-01"


def test_overflowing_untrusted_date_remains_unknown_without_crashing():
    rows = [review(date_created_gmt="0001-01-01T00:00:00+01:00")]
    result = run(service(handler_for_reviews(rows)).fetch_reviews("woocommerce", "33", "shop"))
    assert result["status"] == "ok"
    assert result["analysis_request"]["reviews"][0]["published_at"] is None


def test_contradictory_upstream_total_is_not_presented_as_a_reliable_count():
    result = run(service(handler_for_reviews([review()], headers={"X-WP-Total": "0"})).fetch_reviews("woocommerce", "33", "shop"))
    assert result["returned_count"] == 1 and result["reported_total"] is None
    assert result["truncated"] is True
    assert any("conflicts" in warning for warning in result["warnings"])


def test_cache_preserves_original_retrieval_time_and_cannot_be_poisoned_by_caller():
    requests, clock = [], [100.0]
    base_handler = handler_for_reviews([review()])
    def handler(request):
        requests.append(request)
        return base_handler(request)
    source = service(handler, clock=lambda: clock[0], cache_ttl_s=10)
    first = run(source.fetch_reviews("woocommerce", "33", "shop"))
    first["analysis_request"]["reviews"][0]["text"] = "poison"
    second = run(source.fetch_reviews("woocommerce", "33", "shop"))
    assert second["cache_hit"] is True and len(requests) == 2
    assert second["retrieved_at"] == first["retrieved_at"]
    assert second["analysis_request"]["reviews"][0]["text"] != "poison"
    clock[0] += 11
    third = run(source.fetch_reviews("woocommerce", "33", "shop"))
    assert third["cache_hit"] is False and len(requests) == 4


def test_upstream_429_enforces_cooldown_without_retrying_or_falling_back():
    requests = []
    def handler(request):
        requests.append(request)
        return httpx.Response(429, headers={"Retry-After": "60"})
    source = service(handler)
    first = run(source.fetch_reviews("woocommerce", "33", "shop"))
    second = run(source.search_products("shop", "headphones"))
    assert first["status"] == second["status"] == "rate_limited"
    assert len(requests) == 1 and first["analysis_request"] is None


def test_process_local_request_budget_limits_uncached_requests():
    requests = []
    def handler(request):
        requests.append(request)
        return httpx.Response(200, json=[])
    source = service(handler, clock=lambda: 100)
    for number in range(10):
        assert run(source.search_products("shop", f"item {number}"))["status"] == "empty"
    assert run(source.search_products("shop", "one too many"))["status"] == "rate_limited"
    assert len(requests) == 10


def test_store_allowlist_is_never_claimed_to_be_merchant_safety_verification():
    entry = ReviewSourceService({"shop": BASE}).list_sources()[0]
    assert entry["requires_api_key"] is False
    assert entry["merchant_safety_verified"] is False
    assert "product_reviews" in entry["capabilities"]
