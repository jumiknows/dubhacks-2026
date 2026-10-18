"""Regressions for honest unknowns, traces, privacy wipe and frontend API contracts."""

from datetime import datetime, timezone

import pytest

from api.agent import tools
from api.schemas import IntentMandate, PreferenceProfile
from api.sessions import sessions
from api.store import store


def test_compare_missing_evidence_is_unknown(client, monkeypatch):
    a = store.products["p01"].model_copy(deep=True)
    b = store.products["p02"].model_copy(deep=True)
    a.attributes.pop("fragrance_free", None)
    monkeypatch.setattr(store, "trust", {})
    rows = {row.dimension: row for row in tools.tradeoffs(a, b)}
    assert rows["Adjusted rating"].a == rows["Adjusted rating"].b == "Unknown"
    assert rows["Adjusted rating"].better is None
    assert rows["Fragrance"].a == "Unknown"
    assert rows["Fragrance"].b == "Fragrance-free"
    assert rows["Fragrance"].better is None


@pytest.mark.parametrize("a_value,b_value,expected", [(True, False, "a"), (False, True, "b"), (False, False, None)])
def test_compare_known_fragrance_is_preserved(client, a_value, b_value, expected):
    a = store.products["p01"].model_copy(deep=True)
    b = store.products["p02"].model_copy(deep=True)
    a.attributes["fragrance_free"] = a_value
    b.attributes["fragrance_free"] = b_value
    row = next(t for t in tools.tradeoffs(a, b) if t.dimension == "Fragrance")
    assert row.better == expected


def test_budget_trace_uses_strictest_signed_limit():
    mandate = IntentMandate(session_id="local-test", budget_max=10, categories=["cleanser"],
                            issued_at=datetime.now(timezone.utc).isoformat())
    traces = tools._filter_traces({"budget": 2, "subcategory": 1}, PreferenceProfile(budget_max=40), 30, mandate)
    assert traces[0].removed == 2 and "$10" in traces[0].why and "$40" not in traces[0].why
    assert "categories" in traces[1].why


def test_profile_wipe_clears_conversation_context(client, session_id):
    session = sessions.get(session_id)
    session.chat_history = [{"role": "user", "content": "my private preference"}]
    session.last_subcategory = "moisturizer"
    session.last_query = "old preferences"
    session.last_results = ["p01"]
    session.focused_id = "p01"
    session.greeted = True
    assert client.delete(f"/profile/{session_id}").status_code == 200
    assert session.chat_history == [] and session.last_subcategory is None
    assert session.last_results == [] and session.last_query == "" and session.focused_id is None
    assert not session.greeted


@pytest.mark.parametrize("budget", [-1, 10001])
def test_profile_rejects_invalid_budget(client, session_id, budget):
    response = client.put(f"/profile/{session_id}", json={"budget_max": budget})
    assert response.status_code == 422
    assert client.get(f"/profile/{session_id}").json()["budget_max"] is None


def test_health_describes_mock_data_without_credentials(client):
    response = client.get("/health")
    body = response.json()
    assert body["ok"] and body["agent_source"] == "fallback"
    assert "fictional" in body["data_sources"]["catalog"]
    assert "synthetic" in body["data_sources"]["reviews"]
    assert "mocked" in body["integrations"]["stripe"]
    assert "api_key" not in response.text.lower() and "client_secret" not in response.text.lower()


def test_legacy_trust_explanation_does_not_claim_review_statistics_were_ignored(client):
    body = client.get("/trust/p12").json()
    assert body["security_flags"]
    assert any("still contributes to review statistics" in reason for reason in body["top_reasons"])
    assert not any("it was ignored" in reason for reason in body["top_reasons"])
