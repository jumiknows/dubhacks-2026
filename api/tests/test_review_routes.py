"""Review API boundaries: uploaded claims cannot become live evidence or scores."""

from types import SimpleNamespace

import pytest

from api.reviews import routes
from api.reviews.classifier import ClassificationBatch, ReviewClassificationError
from api.reviews.models import ReviewClassification


PRODUCT = {"source": "uploaded", "external_id": "headphones-1"}


def payload(**extra):
    return {"product": PRODUCT, "reviews": [{
        "review_id": "r1", "product": PRODUCT, "text": "Great sound but terrible battery life.",
        "rating": 3, "published_at": "2026-01-02",
    }], **extra}


def test_upload_is_separate_from_live_ranking_and_preserves_unknowns(client):
    body = client.post("/reviews/analyze", json=payload()).json()
    a = body["analysis"]
    assert a["provenance"] == "uploaded" and a["retrieved_at"] is None
    assert a["analyzed_count"] == 1 and a["ratings"]["mean_five"] == 3
    assert a["sentiment"]["counts"]["mixed"] == 1
    assert "trust" not in a and "score" not in a
    assert body["classification"]["status"] == "disabled"


@pytest.mark.parametrize("extra", [{"provenance": "live"}, {"classifications": []}, {"retrieved_at": "2026-01-02T00:00:00Z"}, {"trust": 1}])
def test_client_cannot_promote_evidence_or_supply_model_results(client, extra):
    assert client.post("/reviews/analyze", json=payload(**extra)).status_code == 422


def test_bad_rows_report_issues_without_destroying_valid_rows(client):
    req = payload()
    req["reviews"] += [{"review_id": "wrong", "product": {"source": "uploaded", "external_id": "another"}, "text": "Great"}, {"rating": "secret-invalid-example"}]
    response = client.post("/reviews/analyze", json=req)
    assert response.status_code == 200
    body = response.json()["analysis"]
    assert body["analyzed_count"] == 1 and len(body["issues"]) == 2
    assert "secret-invalid-example" not in response.text


def test_empty_reviews_do_not_get_neutral_or_trust_scores(client):
    body = client.post("/reviews/analyze", json={"product": PRODUCT, "reviews": [], "use_llm": True}).json()
    assert body["analysis"]["ratings"]["mean_five"] is None
    assert body["analysis"]["sentiment"]["balance"] is None
    assert body["classification"]["status"] == "empty"


def test_requested_ai_without_configuration_has_honest_fallback(client):
    body = client.post("/reviews/analyze", json=payload(use_llm=True)).json()
    assert body["classification"]["status"] == "not_configured"
    assert body["analysis"]["classification_method"] == "deterministic"


def test_valid_model_labels_reach_report_with_coverage_metadata(client, monkeypatch):
    monkeypatch.setattr(routes.llm, "client", lambda: object())
    monkeypatch.setattr(routes, "_reserve_model_budget", lambda: True)

    async def classify(records, **kwargs):
        return ClassificationBatch(classifications=[ReviewClassification(
            review_id="r1", sentiment="mixed", evidence_quotes=[records[0].text],
        )], requested_count=1, llm_classified_count=1)

    monkeypatch.setattr(routes, "classify_reviews", classify)
    body = client.post("/reviews/analyze", json=payload(use_llm=True)).json()
    assert body["analysis"]["classification_method"] == "llm"
    assert body["classification"]["llm_classified_count"] == 1
    assert body["classification"]["fallback_count"] == 0


def test_model_errors_never_echo_sensitive_provider_messages(client, monkeypatch):
    monkeypatch.setattr(routes.llm, "client", lambda: object())
    monkeypatch.setattr(routes, "_reserve_model_budget", lambda: True)

    async def failed(*args, **kwargs):
        raise ReviewClassificationError("sensitive-provider-text")

    monkeypatch.setattr(routes, "classify_reviews", failed)
    response = client.post("/reviews/analyze", json=payload(use_llm=True))
    assert response.status_code == 200 and "sensitive-provider-text" not in response.text
    assert response.json()["classification"]["status"] == "fallback"


def test_partial_model_coverage_is_explicit_and_other_reviews_use_fallback(client, monkeypatch):
    monkeypatch.setattr(routes.llm, "client", lambda: object())
    monkeypatch.setattr(routes, "_reserve_model_budget", lambda: True)

    async def classify(records, **kwargs):
        return ClassificationBatch(classifications=[ReviewClassification(
            review_id="r1", sentiment="mixed", evidence_quotes=[records[0].text],
        )], requested_count=2, llm_classified_count=1, skipped_review_ids=["r2"], warnings=["Model deadline reached; remaining reviews use fallback."])

    monkeypatch.setattr(routes, "classify_reviews", classify)
    request = payload(use_llm=True)
    request["reviews"].append({"review_id": "r2", "product": PRODUCT, "text": "Excellent comfort.", "rating": 5})
    body = client.post("/reviews/analyze", json=request).json()
    assert body["classification"]["status"] == "partial"
    assert body["classification"]["fallback_count"] == 1
    assert body["analysis"]["classification_method"] == "hybrid"


def test_ai_budget_prevents_provider_call(client, monkeypatch):
    monkeypatch.setattr(routes.llm, "client", lambda: object())
    monkeypatch.setattr(routes, "_reserve_model_budget", lambda: False)

    async def unexpected(*args, **kwargs):
        raise AssertionError("Budget exhausted; must not call model")

    monkeypatch.setattr(routes, "classify_reviews", unexpected)
    body = client.post("/reviews/analyze", json=payload(use_llm=True)).json()
    assert body["classification"]["status"] == "rate_limited"
    assert body["analysis"]["classification_method"] == "deterministic"


def test_budget_is_rolling_and_bounded(monkeypatch):
    from collections import deque

    monkeypatch.setattr(routes, "_model_attempts", deque())
    clock = [100.0]
    monkeypatch.setattr(routes, "time", SimpleNamespace(monotonic=lambda: clock[0]))
    monkeypatch.setattr(routes, "get_settings", lambda: SimpleNamespace(review_llm_requests_per_minute=1, review_llm_requests_per_day=2))
    assert routes._reserve_model_budget()
    assert not routes._reserve_model_budget()
    clock[0] += 61
    assert routes._reserve_model_budget()
    clock[0] += 61
    assert not routes._reserve_model_budget()
    clock[0] += 86400
    assert routes._reserve_model_budget()


def test_demo_never_claims_real_customer_evidence(client):
    response = client.post("/reviews/demo", json={})
    assert response.status_code == 200
    body = response.json()
    assert body["source"]["is_mock"] and body["analysis"]["provenance"] == "demo"
    assert body["analysis"]["duplicates"] and body["analysis"]["security_flags"]
    assert "synthetic" in " ".join(body["analysis"]["limitations"]).lower()


def test_no_automatic_live_or_fixture_fallback(client, monkeypatch):
    class Source:
        async def fetch_reviews(self, *args, **kwargs):
            return {"status": "unavailable", "warnings": ["Source unavailable."], "analysis_request": None}

    monkeypatch.setattr(routes, "source_service", lambda: Source())
    body = client.post("/reviews/fetch", json={"product": {"source": "woocommerce", "external_id": "33", "merchant": "shop"}}).json()
    assert body["source"]["status"] == "unavailable" and body["analysis"] is None
    assert body["classification"] is None


def test_server_fetched_reviews_have_server_provenance(client, monkeypatch):
    class Source:
        async def fetch_reviews(self, *args, **kwargs):
            return {"status": "ok", "analysis_request": {**payload(), "provenance": "live", "retrieved_at": "2026-01-03T00:00:00Z", "sample_selection": "recent"}}

    monkeypatch.setattr(routes, "source_service", lambda: Source())
    body = client.post("/reviews/fetch", json={"product": PRODUCT}).json()
    assert body["analysis"]["provenance"] == "live"
    assert body["analysis"]["retrieved_at"] == "2026-01-03T00:00:00Z"
    assert "analysis_request" not in body["source"]


def test_live_configuration_is_not_merchant_verification(client, monkeypatch):
    class Source:
        def list_sources(self):
            return [{"source": "woocommerce", "merchant": "shop", "merchant_safety_verified": False}]

    monkeypatch.setattr(routes, "source_service", lambda: Source())
    body = client.get("/reviews/sources").json()
    assert body["configured"] and not body["sources"][0]["merchant_safety_verified"]


def test_workbench_is_served_with_local_only_request_paths(client):
    response = client.get("/reviews/workbench")
    assert response.status_code == 200 and "text/html" in response.headers["content-type"]
    assert "Review evidence" in response.text
    assert "innerHTML" not in response.text
    assert "localStorage" not in response.text


@pytest.mark.parametrize("body", [{"product": PRODUCT, "limit": 101}, {"product": PRODUCT, "limit": 0}, {"product": PRODUCT, "url": "http://127.0.0.1"}])
def test_fetch_request_is_bounded_and_cannot_supply_target_url(client, body):
    assert client.post("/reviews/fetch", json=body).status_code == 422


def test_direct_api_limits_review_body_before_json_validation(client):
    response = client.post("/reviews/analyze", content=b"x" * 1_048_577)
    assert response.status_code == 413


def test_direct_api_limits_streamed_review_body_without_content_length(client):
    response = client.post("/reviews/analyze", content=iter([b"x" * 600_000, b"y" * 600_000]))
    assert response.status_code == 413
