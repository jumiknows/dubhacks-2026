import asyncio
from datetime import datetime, timedelta, timezone

import httpx
import pytest

from api.websites.reputation import ReputationClient

URL = "https://merchant.example.com/product"


def run(body, *, provider="web_risk", status=200, headers=None):
    calls = []
    def handler(request):
        calls.append(request)
        assert request.url.scheme == "https"
        assert "PRIVATE_KEY" not in str(request.url)
        return httpx.Response(status, json=body, headers=headers)
    client = ReputationClient(webrisk_key="PRIVATE_KEY" if provider == "web_risk" else "",
        phishtank_enabled=provider == "phishtank", phishtank_key="PRIVATE_KEY",
        transport=httpx.MockTransport(handler))
    result = asyncio.run(client.check(URL))
    return result[0], calls


def test_webrisk_negative_means_not_listed_not_verified_safe():
    result, calls = run({})
    assert result.status == "no_known_threat" and result.expires_at
    assert calls[0].headers["x-goog-api-key"] == "PRIVATE_KEY"
    assert calls[0].url.params["uri"] == URL
    assert "verification" in result.detail


def test_webrisk_active_threat_with_expiry():
    expiry = (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat()
    result, _ = run({"threat": {"threatTypes": ["SOCIAL_ENGINEERING"], "expireTime": expiry}})
    assert result.status == "known_malicious" and result.threat_types == ["SOCIAL_ENGINEERING"]


@pytest.mark.parametrize("body", [{"threat": {}}, {"threat": {"threatTypes": []}}, {"threat": {"threatTypes": [{}]}}, {"unexpected": True}, {"threat": {"threatTypes": ["MALWARE"], "expireTime": "2000-01-01T00:00:00Z"}}])
def test_webrisk_incomplete_or_expired_results_are_unknown(body):
    assert run(body)[0].status == "unknown"


@pytest.mark.parametrize("verified,valid", [(True, True), ("y", "y"), ("yes", "true")])
def test_phishtank_verified_valid_report_is_a_blocking_signal(verified, valid):
    result, calls = run({"results": {"url": URL, "in_database": True, "verified": verified, "valid": valid}}, provider="phishtank")
    assert result.status == "known_malicious"
    assert calls[0].method == "POST" and calls[0].url.host == "checkurl.phishtank.com"
    assert b"app_key=PRIVATE_KEY" in calls[0].content


def test_phishtank_not_found_still_is_not_safety_proof():
    result, _ = run({"results": {"url": URL, "in_database": False}}, provider="phishtank")
    assert result.status == "no_known_threat" and "unreported" in result.detail


@pytest.mark.parametrize("body", [
    {"results": {"in_database": True, "verified": False, "valid": True}},
    {"results": {"in_database": True, "verified": True, "valid": False}},
    {"results": {"in_database": True}},
])
def test_unverified_or_historical_reports_require_review(body):
    assert run(body, provider="phishtank")[0].status == "reported"


@pytest.mark.parametrize("body", [{}, {"results": {"in_database": 0}}, {"results": {"in_database": False}}, {"results": {"url": URL, "in_database": False, "valid": True}}, {"results": {"url": "https://other.example.com", "in_database": False}}, {"meta": {"status": "error"}, "results": {"in_database": False}}])
def test_malformed_or_wrong_url_phishtank_never_clears(body):
    assert run(body, provider="phishtank")[0].status == "unknown"


@pytest.mark.parametrize("status", [301, 302, 401, 403, 429, 500, 509])
def test_provider_error_status_and_redirect_are_unknown(status):
    result, calls = run({"secret": "SHOULD_NOT_LEAK"}, status=status, headers={"Location": "https://evil.example.com"})
    assert result.status == "unknown" and "SHOULD_NOT_LEAK" not in result.model_dump_json()
    assert len(calls) == 1


@pytest.mark.parametrize("content", [b'{"a":1,"a":2}', b'{"threat":NaN}', b"[]", b"x" * 65537], ids=["duplicate_keys", "nonfinite", "wrong_shape", "oversized"])
def test_bounded_strict_json(content):
    client = ReputationClient(webrisk_key="fixture", transport=httpx.MockTransport(
        lambda _: httpx.Response(200, content=content, headers={"Content-Type": "application/json"})))
    assert asyncio.run(client.check(URL))[0].status == "unknown"


def test_no_keys_means_no_lookup_instead_of_invented_clear_result():
    client = ReputationClient(transport=httpx.MockTransport(lambda _: (_ for _ in ()).throw(AssertionError())))
    assert asyncio.run(client.check(URL)) == []
    assert not any(row["configured"] for row in client.configuration())


def test_network_exception_is_sanitized():
    def handler(request):
        raise httpx.ConnectError("PRIVATE_KEY", request=request)
    client = ReputationClient(webrisk_key="fixture", transport=httpx.MockTransport(handler))
    result = asyncio.run(client.check(URL))[0]
    assert result.status == "unknown" and "PRIVATE_KEY" not in result.model_dump_json()
