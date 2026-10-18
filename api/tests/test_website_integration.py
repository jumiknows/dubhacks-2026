import asyncio
import json
from datetime import datetime, timedelta, timezone

import httpx
import pytest

from api import checkout
from api.guard import mandates
from api.reviews.sources import ReviewSourceService
from api.tests.test_checkout_prices import context
from api.tests.test_website_safety import Provider, public
from api.websites import checkout as website_checkout
from api.websites import routes
from api.websites.service import WebsiteSafetyService


def fixture_service(provider=None):
    return WebsiteSafetyService({"approved": {"origins": ["https://merchant.example.com"],
        "checkout_url": "https://merchant.example.com/checkout"}}, reputation=provider or Provider(), resolver=public)


def install(monkeypatch, svc):
    monkeypatch.setattr(website_checkout, "safety_service", lambda: svc)


def test_unregistered_mock_checkout_stays_explicitly_mock(context):
    action = checkout.stage(context.session, "p", 1)
    check = next(c for c in action.policy.checks if c.rule == "external_destination")
    assert check.passed and "Mock-only" in check.reason and "certified" in check.reason
    signature = mandates.sign_raw(context.key, action.cart_payload)
    assert checkout.authorize(context.session, action.cart.cart_hash, signature).mock


def test_registered_external_checkout_holds_until_fresh_assessment(context, monkeypatch):
    svc = fixture_service()
    install(monkeypatch, svc)
    refusal = checkout.stage(context.session, "p", 1)
    assert refusal.action == "policy_refusal" and not context.session.staged
    assert any(c.rule == "external_destination" and not c.passed for c in refusal.policy.checks)
    assert asyncio.run(svc.assess_checkout("approved")).allowed
    action = checkout.stage(context.session, "p", 1)
    assert action.action == "stage_checkout"
    assert json.loads(action.cart_payload)["merchant_destinations"] == {"approved": "https://merchant.example.com/checkout"}
    assert checkout.authorize(context.session, action.cart.cart_hash, mandates.sign_raw(context.key, action.cart_payload)).mock


def test_assessing_other_path_cannot_authorize_registered_checkout(context, monkeypatch):
    svc = fixture_service()
    install(monkeypatch, svc)
    assert asyncio.run(svc.assess("https://merchant.example.com/product", "approved", "checkout")).allowed
    assert checkout.stage(context.session, "p", 1).action == "policy_refusal"


@pytest.mark.parametrize("status,expected_action", [("no_known_threat", "stage_checkout"), ("unknown", "policy_refusal")])
def test_http_stage_preflights_registered_destination(context, monkeypatch, client, status, expected_action):
    from api import main
    provider = Provider((status,))
    svc = fixture_service(provider)
    install(monkeypatch, svc)
    monkeypatch.setattr(main, "safety_service", lambda: svc)
    monkeypatch.setattr(main, "store", context.store)
    monkeypatch.setattr(main.tools, "require_product", lambda pid: context.store.product(pid))
    monkeypatch.setattr(main.sessions, "get", lambda sid: context.session)
    response = client.post("/checkout/stage", json={"session_id": context.session.id, "product_id": "p", "quantity": 1})
    assert response.status_code == 200 and response.json()["action"] == expected_action
    assert provider.calls == ["https://merchant.example.com/checkout"]
    assert any(row["kind"] == "website_checkout_check" for row in context.session.audit)


@pytest.mark.parametrize("change", ["changed_url", "removed_registration", "expired", "new_threat"])
def test_checkout_rechecks_destination_and_evidence_before_mock_payment(context, monkeypatch, change):
    provider = Provider()
    svc = fixture_service(provider)
    install(monkeypatch, svc)
    assessment = asyncio.run(svc.assess_checkout("approved"))
    action = checkout.stage(context.session, "p", 1)
    if change == "changed_url":
        svc.registrations["approved"].checkout_url = "https://merchant.example.com/other-checkout"
    elif change == "removed_registration":
        del svc.registrations["approved"]
    elif change == "expired":
        svc._assessments[("approved", "checkout", assessment.url_sha256)].expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)
    else:
        svc._rep_cache.clear()
        provider.statuses = ("known_malicious",)
        assert asyncio.run(svc.assess_checkout("approved")).decision == "blocked"
    def forbid(*args):
        raise AssertionError("Rejected destination reached payment creation")
    monkeypatch.setattr(checkout, "create_payment_intent", forbid)
    with pytest.raises(checkout.CheckoutError) as error:
        checkout.authorize(context.session, action.cart.cart_hash, mandates.sign_raw(context.key, action.cart_payload))
    assert error.value.status in (403, 409)
    assert not context.session.staged[action.cart.cart_hash].paid and context.session.spent == 0


def test_review_fetch_gate_prevents_actual_merchant_http_request():
    svc = WebsiteSafetyService()
    def forbidden(_):
        raise AssertionError("A held destination must never receive HTTP traffic")
    reviews = ReviewSourceService({"shop": "https://merchant.example.com"}, resolver=public,
        transport=httpx.MockTransport(forbidden), url_gate=svc.assess)
    result = asyncio.run(reviews.fetch_reviews("woocommerce", "33", "shop"))
    assert result["status"] == "safety_hold" and result["analysis_request"] is None
    assert result["website_safety"]["decision"] == "hold"


def test_cached_reviews_recheck_website_safety_before_returning_links():
    provider = Provider()
    svc = WebsiteSafetyService({"shop": {"origins": ["https://merchant.example.com"]}}, reputation=provider, resolver=public)
    calls = []
    product_url = "https://merchant.example.com/product/headphones"
    def handler(request):
        calls.append(request)
        assert request.headers["host"] == "merchant.example.com"
        if request.url.path.endswith("/products/33"):
            return httpx.Response(200, json={"id": 33, "name": "Headphones", "permalink": product_url})
        return httpx.Response(200, json=[{"id": 1, "product_id": 33, "product_permalink": product_url,
            "review": "Great sound.", "rating": 5, "date_created_gmt": "2026-01-02T00:00:00"}], headers={"x-wp-total": "1"})
    reviews = ReviewSourceService({"shop": "https://merchant.example.com"}, resolver=public,
        transport=httpx.MockTransport(handler), url_gate=svc.assess)
    first = asyncio.run(reviews.fetch_reviews("woocommerce", "33", "shop"))
    assert first["status"] == "ok" and len(calls) == 2
    assert first["website_safety"]["allowed"] and first["website_safety"]["purpose"] == "link"
    assert first["website_safety"]["safety_guaranteed"] is False
    cached = asyncio.run(reviews.fetch_reviews("woocommerce", "33", "shop"))
    assert cached["cache_hit"] and cached["website_safety"]["allowed"] and len(calls) == 2
    svc._rep_cache.clear()
    provider.statuses = ("known_malicious",)
    second = asyncio.run(reviews.fetch_reviews("woocommerce", "33", "shop"))
    assert second["status"] == "blocked" and second["analysis_request"] is None
    assert second["product_url"] is None and "url" not in second["product"] and second["returned_count"] == 0
    assert len(calls) == 2


def test_api_no_configuration_means_hold_not_verified_safe(client):
    response = client.post("/websites/assess", json={"url": "https://merchant.example.com/product"})
    assert response.status_code == 200
    body = response.json()
    assert body["decision"] == "hold" and not body["allowed"] and not body["safety_guaranteed"]


def test_api_does_not_echo_private_url_inputs_or_client_verdicts(client):
    url = "https://merchant.example.com/?session=PRIVATE_VALUE"
    response = client.post("/websites/assess", json={"url": url})
    assert response.json()["decision"] == "blocked" and "PRIVATE_VALUE" not in response.text
    response = client.post("/websites/assess", json={"url": url, "allowed": True})
    assert response.status_code == 422 and "PRIVATE_VALUE" not in response.text
    response = client.post("/websites/assess", json={"url": "https://merchant.example.com/" + "x" * 5000})
    assert response.status_code == 422 and "xxx" not in response.text


def test_checkout_endpoint_uses_only_server_destination(client):
    response = client.post("/websites/checkout-check", json={"merchant_id": "unregistered"})
    assert response.json()["decision"] == "hold"
    assert client.post("/websites/checkout-check", json={"merchant_id": "shop", "url": "https://attacker.example.com"}).status_code == 422


def test_demo_uses_isolated_synthetic_service_and_cannot_approve_global_checkout(client):
    body = client.post("/websites/demo", json={}).json()
    assert body["is_mock"] and body["provenance"] == "synthetic_demo"
    assert {row["assessment"]["decision"] for row in body["cases"]} == {"allowed", "hold", "blocked"}
    assert not routes.safety_service().registrations


def test_configuration_and_workbench_expose_no_secret_values(client):
    response = client.get("/websites/config")
    assert response.status_code == 200
    assert "api_key" not in response.text.lower()
    assert not any(row["configured"] for row in response.json()["reputation_providers"])
    page = client.get("/websites/workbench")
    assert page.status_code == 200 and "text/html" in page.headers["content-type"]
    assert "innerHTML" not in page.text and "localStorage" not in page.text
    reviews = client.get("/reviews/workbench")
    assert "Assess source destination" in reviews.text and "a.href=" not in reviews.text


def test_site_assessment_upload_limit_applies_without_content_length(client):
    response = client.post("/websites/assess", content=iter([b"x" * 600000, b"x" * 600000]))
    assert response.status_code == 413
