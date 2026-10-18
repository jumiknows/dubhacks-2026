"""Website policy adversarial cases. No external requests or real credentials."""

import asyncio
from datetime import datetime, timedelta, timezone

import pytest

from api.websites.models import ReputationResult
from api.websites.service import WebsiteSafetyService
from api.websites.urls import URLRejected, canonical_url, configured_origin, lookalike


@pytest.mark.parametrize("url", [
    "http://merchant.example.com", "javascript:alert(1)", "file:///etc/passwd",
    "https://merchant.example.com@evil.example.org", "https://user:secret@merchant.example.com",
    "https://merchant.example.com\\@evil.example.org", " https://merchant.example.com",
    "https://merchant.example.com\n", "https://merchant.example.com:8443", "https://merchant.example.com.",
    "https://merchant%2eexample.com", "https://merchant.example.com/%zz", "https://localhost/",
    "https://127.0.0.1/", "https://[::1]/", "https://169.254.169.254/latest/meta-data/",
    "https://2130706433/", "https://127.1/", "https://0x7f000001/", "https://x.internal/",
    "https://x.local/", "https://x.invalid/", "https://x.test/", "https://x.example/",
    "https://аmazon.com/", "https://merchant.example.com/?access_token=private",
    "https://merchant.example.com/?session_id=private", "https://merchant.example.com/?email=a%40b.com",
    "https://merchant.example.com/reset-password/private", "https://merchant.example.com/#private-token",
])
def test_ambiguous_private_or_unsupported_urls_rejected(url):
    with pytest.raises(URLRejected):
        canonical_url(url)


def test_normalization_preserves_path_and_public_query_without_decoding_host_tricks():
    url = canonical_url("https://MERCHANT.example.com:443/products/%2F?product_id=33&page=2")
    assert url.origin == "https://merchant.example.com"
    assert url.url == "https://merchant.example.com/products/%2F?product_id=33&page=2"


def test_origins_must_not_contain_paths_or_queries():
    assert configured_origin("https://merchant.example.com/") == "https://merchant.example.com"
    with pytest.raises(URLRejected):
        configured_origin("https://merchant.example.com/path")


def test_idn_is_visible_and_similarity_is_only_a_warning():
    assert canonical_url("https://xn--bcher-kva.example.com/").warning_codes
    assert lookalike("amaz0n.com", {"amazon.com"})
    assert lookalike("amzaon.com", {"amazon.com"})
    assert not lookalike("unrelated.example.com", {"amazon.com"})


class Provider:
    def __init__(self, statuses=("no_known_threat",)):
        self.statuses, self.calls = statuses, []

    def configuration(self):
        return [{"provider": "fixture", "configured": True}]

    async def check(self, url):
        self.calls.append(url)
        now = datetime.now(timezone.utc)
        return [ReputationResult(provider=f"fixture-{i}", status=status, checked_at=now,
            expires_at=now + timedelta(minutes=5), detail="Synthetic test verdict.") for i, status in enumerate(self.statuses)]


async def public(_):
    return ["93.184.216.34"]


def service(provider=None, **kwargs):
    return WebsiteSafetyService({"shop": {
        "origins": ["https://merchant.example.com"],
        "checkout_url": "https://merchant.example.com/checkout",
        "payment_origins": ["https://payments.example.com"],
    }}, reputation=provider or Provider(), resolver=kwargs.pop("resolver", public), **kwargs)


def assess(svc, url="https://merchant.example.com/product", merchant="shop", purpose="fetch"):
    return asyncio.run(svc.assess(url, merchant, purpose))


def test_allowed_is_action_specific_and_not_a_safety_guarantee():
    result = assess(service())
    assert result.allowed and result.decision == "allowed"
    assert result.identity == "approved_destination" and result.reputation == "no_known_threat"
    assert result.expires_at and not result.safety_guaranteed
    assert any(e.code == "public_network" and e.status == "pass" for e in result.evidence)


@pytest.mark.parametrize("url", ["https://merchant.example.com.attacker.example.org/product", "https://evil.example.org/", "https://payments.example.com/"])
def test_exact_origin_matching_not_brand_substring_or_payment_origin_for_fetch(url):
    result = assess(service(), url)
    assert result.decision == "blocked" and result.identity == "mismatch"


def test_approved_payment_origin_only_allows_checkout_purpose():
    assert assess(service(), "https://payments.example.com/", purpose="checkout").allowed


def test_unknown_identity_is_held_even_with_negative_lookup():
    result = assess(service(), "https://another.example.org/", merchant=None)
    assert result.decision == "hold" and result.reputation == "no_known_threat"


def test_any_known_threat_wins_over_other_clean_results():
    result = assess(service(Provider(("no_known_threat", "known_malicious"))))
    assert result.decision == "blocked" and not result.allowed


@pytest.mark.parametrize("statuses", [(), ("unknown",), ("reported",), ("no_known_threat", "unknown")])
def test_missing_conflicting_or_unverified_evidence_holds(statuses):
    result = assess(service(Provider(statuses)))
    assert result.decision == "hold" and not result.allowed


def test_default_unconfigured_service_never_issues_clearance():
    result = assess(WebsiteSafetyService(), merchant=None)
    assert not result.allowed and result.reputation == "unknown"


@pytest.mark.parametrize("addresses", [["127.0.0.1"], ["93.184.216.34", "10.0.0.1"], ["169.254.169.254"], ["::1"], ["224.0.0.1"]])
def test_nonpublic_or_mixed_dns_blocks(addresses):
    async def resolver(_):
        return addresses
    result = assess(service(resolver=resolver))
    assert result.decision == "blocked"


def test_failed_dns_is_unknown_not_clear():
    async def resolver(_):
        raise OSError("private resolver message")
    result = assess(service(resolver=resolver))
    assert result.decision == "hold" and "private resolver message" not in result.model_dump_json()


def test_private_credentials_never_reach_provider_or_response():
    provider = Provider()
    result = assess(service(provider), "https://merchant.example.com/?api_key=VERY_PRIVATE_VALUE")
    assert not provider.calls and "VERY_PRIVATE_VALUE" not in result.model_dump_json()
    assert result.origin is None


def test_local_blocklist_includes_subdomains_without_outbound_call():
    provider = Provider()
    result = assess(service(provider, blocked_hosts=["example.com"]))
    assert result.decision == "blocked" and not provider.calls


def test_invalid_registry_fails_closed():
    svc = WebsiteSafetyService({"shop": {"origins": ["https://merchant.example.com/path"]}}, reputation=Provider(), resolver=public)
    assert not assess(svc).allowed and not svc.configuration()["configuration_valid"]


def test_cache_expires_and_does_not_expose_mutable_checkout_results():
    clock = [0.0]
    provider = Provider()
    svc = service(provider, clock=lambda: clock[0], cache_ttl_s=10)
    first = assess(svc, "https://merchant.example.com/checkout", purpose="checkout")
    second = assess(svc, "https://merchant.example.com/checkout", purpose="checkout")
    assert len(provider.calls) == 1 and second.providers[0].cache_hit
    first.allowed = False
    assert svc.checkout_snapshot("shop")[1].allowed
    clock[0] = 11
    assess(svc, "https://merchant.example.com/checkout", purpose="checkout")
    assert len(provider.calls) == 2


def test_provider_budget_holds_new_urls_instead_of_failing_open():
    provider = Provider()
    svc = service(provider, requests_per_minute=1)
    assert assess(svc).allowed
    assert assess(svc, "https://merchant.example.com/another").decision == "hold"
    assert len(provider.calls) == 1


def test_provider_internal_failure_does_not_bypass_policy():
    class Broken(Provider):
        async def check(self, url):
            raise RuntimeError("sensitive internal error")
    result = assess(service(Broken()))
    assert result.decision == "hold" and "sensitive internal error" not in result.model_dump_json()


def test_missing_and_expired_checkout_evidence_remains_unusable():
    svc = service()
    assert svc.checkout_snapshot("shop")[1] is None
    result = asyncio.run(svc.assess_checkout("shop"))
    assert result.allowed
    key = ("shop", "checkout", result.url_sha256)
    svc._assessments[key].expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)
    assert not svc.checkout_snapshot("shop")[1].allowed
    assert asyncio.run(svc.assess_checkout("unknown")).decision == "hold"
