"""LLM agent path, tested against a scripted fake LLM (no network)."""

from __future__ import annotations

import asyncio
import json
import time
from collections.abc import Iterator
from typing import Any

import httpx
import pytest

from api import voice
from api.agent import fallback, llm, orchestrator, tools
from api.config import get_settings
from api.sessions import breaker, sessions, tts_cache
from api.tests.conftest import read_sse
from api.store import store

HERO = "fragrance-free moisturizer for dry, sensitive skin, under $40"


def tool_msg(*calls: tuple[str, dict]) -> dict:
    return {"role": "assistant", "content": None, "tool_calls": [
        {"id": f"c{i}", "type": "function", "function": {"name": n, "arguments": json.dumps(a)}}
        for i, (n, a) in enumerate(calls)
    ]}


def text_msg(text: str) -> dict:
    return {"role": "assistant", "content": text}


class FakeLLM:
    """Replays scripted responses; an Exception entry is raised instead (e.g. a timeout)."""

    def __init__(self) -> None:
        self.script: list[Any] = []
        self.requests: list[dict] = []

    def handler(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(json.loads(request.content))
        item = self.script.pop(0)
        if isinstance(item, Exception):
            raise item
        return httpx.Response(200, json={"choices": [{"message": item}]})


@pytest.fixture
def fake_llm(client) -> Iterator[FakeLLM]:
    fake = FakeLLM()
    previous = llm._client
    test_client = llm.LLMClient(httpx.MockTransport(fake.handler))
    llm._client = test_client
    breaker.failures, breaker.open_until = 0, 0.0
    yield fake
    asyncio.run(test_client.aclose())
    llm._client = previous
    breaker.failures, breaker.open_until = 0, 0.0


def chat(client, sid: str, text: str, **ctx: Any) -> list[tuple[str, dict]]:
    return read_sse(client.post("/chat", json={"session_id": sid, "text": text, "ui_context": ctx}))


def of(events: list[tuple[str, dict]], name: str) -> list[dict]:
    return [d for e, d in events if e == name]


def speech(events: list[tuple[str, dict]]) -> str:
    return " ".join(d["text"] for d in of(events, "say"))


SEARCH = ("search_products", {"query": HERO, "subcategory": "moisturizer"})


def test_llm_turn_streams_trace_actions_then_speech(client, session_id, fake_llm) -> None:
    fake_llm.script = [tool_msg(SEARCH), text_msg("I found 6 options; the top match is Lumenroot Ceramide Barrier Cream at $28.")]
    events = chat(client, session_id, HERO)
    names = [e for e, _ in events]
    assert names.index("trace") < names.index("action") < names.index("say") < names.index("done")
    assert of(events, "done")[-1] == {"grounded": True, "source": "llm"}
    assert len(of(events, "action")[0]["product_ids"]) == 6
    traces = of(events, "trace")
    assert traces[0]["kind"] == "tool" and traces[0]["name"] == "search_products"
    assert any(t["kind"] == "filter" and "budget" in t["why"] for t in traces)
    assert speech(events).startswith("Hi, I'm Conjure, an AI")
    # The LLM got tools and the screen context
    assert {t["function"]["name"] for t in fake_llm.requests[0]["tools"]} == set(tools.REGISTRY)


def test_generated_product_prices_are_replaced_by_structured_facts(client, session_id, fake_llm) -> None:
    fake_llm.script = [tool_msg(SEARCH), text_msg("Top pick is $25 today.")]
    events = chat(client, session_id, HERO)
    assert of(events, "done")[-1]["grounded"] is True
    assert "$28" in speech(events) and "$25" not in speech(events)
    assert len(fake_llm.requests) == 2  # No extra model request is spent rewriting speech.


def test_nonnumeric_shipping_and_attribute_inventions_are_not_spoken(client, session_id, fake_llm) -> None:
    fake_llm.script = [tool_msg(SEARCH), text_msg("It contains retinol and arrives tomorrow with free shipping.")]
    events = chat(client, session_id, HERO)
    assert of(events, "done")[-1] == {"grounded": True, "source": "llm"}
    assert "retinol" not in speech(events) and "tomorrow" not in speech(events) and "free shipping" not in speech(events)
    assert "top match is" in speech(events)


def test_timeout_falls_back_to_rules(client, session_id, fake_llm) -> None:
    fake_llm.script = [httpx.ReadTimeout("slow")]
    events = chat(client, session_id, HERO)
    assert of(events, "done")[-1]["source"] == "fallback"
    assert len(of(events, "action")[-1]["product_ids"]) == 6


def test_failure_after_actions_does_not_duplicate_results(client, session_id, fake_llm) -> None:
    fake_llm.script = [tool_msg(SEARCH), httpx.ReadTimeout("slow")]
    events = chat(client, session_id, HERO)
    assert [a["action"] for a in of(events, "action")] == ["show_results"]
    assert of(events, "done")[-1] == {"grounded": True, "source": "llm"}


def test_breaker_opens_after_three_failures(client, fake_llm) -> None:
    fake_llm.script = [httpx.ReadTimeout("slow")] * 3
    for _ in range(3):
        sid = client.post("/session").json()["session_id"]
        chat(client, sid, HERO)
    assert client.get("/health").json()["llm_breaker"]["state"] == "open"
    sid = client.post("/session").json()["session_id"]
    events = chat(client, sid, HERO)
    assert of(events, "done")[-1]["source"] == "fallback"
    assert len(fake_llm.requests) == 3  # the fourth turn never called the LLM


def test_fifth_tool_call_is_blocked(client, session_id, fake_llm) -> None:
    calls = [("get_trust", {"product_id": f"p0{i}"}) for i in range(1, 6)]
    fake_llm.script = [tool_msg(*calls), text_msg("Here are the trust reports.")]
    events = chat(client, session_id, "trust?")
    tool_traces = [t for t in of(events, "trace") if t["kind"] == "tool"]
    assert len(tool_traces) == 4
    assert any(t["kind"] == "policy" and t["rule"] == "tool_limit" and not t["passed"] for t in of(events, "trace"))
    kinds = [e["kind"] for e in client.get(f"/audit/{session_id}").json()["entries"]]
    assert "anomalous_turn" in kinds


def test_stage_checkout_needs_explicit_yes(client, session_id, fake_llm) -> None:
    fake_llm.script = [tool_msg(("stage_checkout", {"product_id": "p01", "quantity": 1})), text_msg("Okay.")]
    events = chat(client, session_id, "tell me about the first one", focused_id="p01")
    assert not [a for a in of(events, "action") if a["action"] == "stage_checkout"]
    assert any(t.get("rule") == "explicit_consent" for t in of(events, "trace"))


def test_stage_checkout_with_yes_streams_policy_checks(client, session_id, fake_llm) -> None:
    fake_llm.script = [tool_msg(("stage_checkout", {"product_id": "p01", "quantity": 1})),
                       text_msg("It's staged for $28; review and sign it to pay.")]
    events = chat(client, session_id, "yes, buy it", focused_id="p01")
    assert [a["action"] for a in of(events, "action")] == ["stage_checkout"]
    policy = [t for t in of(events, "trace") if t["kind"] == "policy"]
    assert policy and all(t["passed"] for t in policy)


def test_kill_switch_after_two_anomalous_turns(client, session_id, fake_llm) -> None:
    bad = tool_msg(("stage_checkout", {"product_id": "p01", "quantity": 1}))
    fake_llm.script = [bad, text_msg("Okay."), bad, text_msg("Okay.")]
    chat(client, session_id, "hmm")
    chat(client, session_id, "hmm")
    assert sessions.get(session_id).llm_killed
    events = chat(client, session_id, HERO)
    assert of(events, "done")[-1]["source"] == "fallback"
    kinds = [e["kind"] for e in client.get(f"/audit/{session_id}").json()["entries"]]
    assert "kill_switch" in kinds


def test_injected_review_text_never_reaches_llm(client, session_id, fake_llm) -> None:
    fake_llm.script = [tool_msg(("get_trust", {"product_id": "p12"})), text_msg("It's capped at caution.")]
    chat(client, session_id, "is this one trustworthy?", focused_id="p12")
    sent = json.dumps(fake_llm.requests[-1]["messages"]).lower()
    assert "ignore previous instructions" not in sent
    assert "has_security_flags" in sent


def test_profile_writes_only_from_users_words(client, session_id, fake_llm) -> None:
    fake_llm.script = [tool_msg(("update_profile", {"avoid": ["fragrance", "alcohol"], "skin_type": "oily"})),
                       text_msg("Noted.")]
    chat(client, session_id, "I need fragrance-free stuff")
    profile = client.get(f"/profile/{session_id}").json()
    assert profile["avoid"] == ["fragrance"] and profile["skin_type"] is None


def test_tool_registry_is_exactly_five() -> None:
    assert set(tools.REGISTRY) == {"search_products", "get_trust", "compare", "update_profile", "stage_checkout"}


@pytest.mark.parametrize("text", [
    "I don't want to buy it", "Do not buy it", "Should I buy it?", "Can I buy it?",
    "Maybe buy it", "If I buy it", "yes I have dry skin", "never purchase it",
])
def test_negation_questions_and_unrelated_yes_cannot_stage(client, session_id, fake_llm, text) -> None:
    fake_llm.script = [tool_msg(("stage_checkout", {"product_id": "p01", "quantity": 1})), text_msg("Okay.")]
    events = chat(client, session_id, text, focused_id="p01")
    assert not [action for action in of(events, "action") if action["action"] == "stage_checkout"]
    assert sessions.get(session_id).staged == {}


def test_bare_yes_without_purchase_proposal_is_not_consent(client, session_id, fake_llm) -> None:
    fake_llm.script = [tool_msg(("stage_checkout", {"product_id": "p01", "quantity": 1})), text_msg("Okay.")]
    events = chat(client, session_id, "yes", focused_id="p01")
    assert sessions.get(session_id).staged == {}
    assert any(trace.get("rule") == "purchase_selection" for trace in of(events, "trace"))


@pytest.mark.parametrize("args,text,rule", [
    ({"product_id": "p02", "quantity": 1}, "buy it", "purchase_selection"),
    ({"product_id": "p01", "quantity": 2}, "buy it", "purchase_quantity"),
    ({"product_id": "p01", "quantity": 1}, "buy two of these", "purchase_quantity"),
    ({"product_id": "p01", "quantity": 1, "unit_price": 1.0}, "buy it", "catalog_price"),
    ({"product_id": "p01", "quantity": 1}, "buy a sunscreen", "purchase_selection"),
    ({"product_id": "p01", "quantity": 1}, "buy p99", "purchase_selection"),
])
def test_model_cannot_choose_different_target_quantity_or_price(client, session_id, fake_llm, args, text, rule) -> None:
    fake_llm.script = [tool_msg(("stage_checkout", args)), text_msg("Okay.")]
    events = chat(client, session_id, text, focused_id="p01")
    assert sessions.get(session_id).staged == {}
    assert any(trace.get("rule") == rule for trace in of(events, "trace"))


def test_spf_number_cannot_authorize_model_generated_budget(client, session_id, fake_llm) -> None:
    fake_llm.script = [tool_msg(("update_profile", {"budget_max": 5000})), text_msg("Noted.")]
    chat(client, session_id, "I need SPF 50")
    assert sessions.get(session_id).profile.budget_max is None


def test_model_budget_is_replaced_by_user_budget(client, session_id, fake_llm) -> None:
    fake_llm.script = [tool_msg(("update_profile", {"budget_max": 1000})), text_msg("Noted.")]
    chat(client, session_id, "under $20 please")
    assert sessions.get(session_id).profile.budget_max == 20


def test_original_query_constraints_survive_model_rewriting(client, session_id, fake_llm) -> None:
    fake_llm.script = [tool_msg(("search_products", {"query": "cream", "max_price": 1000})),
                       text_msg("The results are on screen.")]
    events = chat(client, session_id, "fragrance-free moisturizer under $25")
    ids = next(action["product_ids"] for action in of(events, "action") if action["action"] == "show_results")
    assert ids
    assert all(store.products[pid].price <= 25 for pid in ids)
    assert all(store.products[pid].attributes["fragrance_free"] is True for pid in ids)


def test_model_cannot_loosen_starting_profile_budget(client, session_id, fake_llm) -> None:
    sessions.get(session_id).profile.budget_max = 10
    fake_llm.script = [tool_msg(("update_profile", {"budget_max": 90}),
                               ("search_products", {"query": "cream", "max_price": 1000})),
                       text_msg("The results are on screen.")]
    events = chat(client, session_id, "moisturizer under $90")
    ids = next(action["product_ids"] for action in of(events, "action") if action["action"] == "show_results")
    assert all(store.products[pid].price <= 10 for pid in ids)
    assert sessions.get(session_id).profile.budget_max == 10


@pytest.mark.parametrize("claim", ["Your purchase is complete.", "I've purchased it.", "Your item has been purchased."])
def test_no_numeric_purchase_completion_claims_are_replaced(client, session_id, fake_llm, claim) -> None:
    fake_llm.script = [tool_msg(SEARCH), text_msg(claim)]
    events = chat(client, session_id, HERO)
    assert claim not in speech(events)
    assert "top match" in speech(events)
    assert sessions.get(session_id).staged == {}


def test_user_budget_number_does_not_become_a_product_price(client, session_id, fake_llm) -> None:
    fake_llm.script = [tool_msg(SEARCH), text_msg("The top match costs $40.")]
    events = chat(client, session_id, HERO)
    assert "$40" not in speech(events)
    assert "$28" in speech(events)


@pytest.mark.parametrize("generated", [
    "The product is fragrance-free and arrives tomorrow.",
    "Your purchase is complete.", "It costs $40 and has perfect reviews.",
])
def test_model_prose_without_tools_cannot_assert_product_facts(client, session_id, fake_llm, generated) -> None:
    fake_llm.script = [text_msg(generated)]
    events = chat(client, session_id, "hello")
    assert generated not in speech(events)
    assert "tomorrow" not in speech(events) and "$40" not in speech(events)
    assert of(events, "done")[-1] == {"grounded": True, "source": "fallback"}


def test_no_tool_delivery_answer_preserves_unknown_dates(client, session_id, fake_llm) -> None:
    fake_llm.script = [text_msg("It arrives tomorrow.")]
    events = chat(client, session_id, "when does this arrive?", focused_id="p01")
    assert "tomorrow" not in speech(events)
    assert "arrival dates are unknown" in speech(events)


@pytest.mark.parametrize("text,quantity", [
    ("buy this under $10", 1), ("buy two of these under $50", 2),
    ("buy this sunscreen", 1),
])
def test_current_user_purchase_constraints_block_staging(client, session_id, fake_llm, text, quantity) -> None:
    fake_llm.script = [tool_msg(("stage_checkout", {"product_id": "p01", "quantity": quantity})), text_msg("Okay.")]
    events = chat(client, session_id, text, focused_id="p01")
    assert sessions.get(session_id).staged == {}
    assert any(trace.get("rule") == "purchase_constraints" for trace in of(events, "trace"))
    assert not any(action["action"] == "stage_checkout" for action in of(events, "action"))


@pytest.mark.parametrize("constraint", ["profile_budget", "profile_avoid", "user_avoid", "signed_category"])
def test_profile_and_signed_purchase_constraints_are_independent_of_model(client, session_id, fake_llm, key, constraint) -> None:
    session = sessions.get(session_id)
    product_id, text = "p01", "buy this"
    if constraint == "profile_budget":
        session.profile.budget_max = 10
    elif constraint in {"profile_avoid", "user_avoid"}:
        product_id = next(p.id for p in store.products.values() if p.attributes.get("fragrance_free") is False)
        if constraint == "profile_avoid":
            session.profile.avoid = ["fragrance"]
        else:
            text = "buy this fragrance-free"
    else:
        from api.tests.conftest import register_mandate
        assert register_mandate(client, session_id, key, categories=["serum"]).status_code == 200
    fake_llm.script = [tool_msg(("stage_checkout", {"product_id": product_id, "quantity": 1})), text_msg("Okay.")]
    events = chat(client, session_id, text, focused_id=product_id)
    assert session.staged == {}
    assert any(trace.get("rule") == "purchase_constraints" for trace in of(events, "trace"))


def test_purchase_budget_exact_boundary_is_allowed(client, session_id, fake_llm) -> None:
    fake_llm.script = [tool_msg(("stage_checkout", {"product_id": "p01", "quantity": 1})), text_msg("Okay.")]
    events = chat(client, session_id, "buy this under $28", focused_id="p01")
    assert any(action["action"] == "stage_checkout" for action in of(events, "action"))


def test_new_visible_cards_cannot_reuse_stale_purchase_focus(client, session_id, fake_llm) -> None:
    fake_llm.script = [tool_msg(("get_trust", {"product_id": "p01"})), text_msg("See the trust panel.")]
    chat(client, session_id, "reviews please", focused_id="p01")
    assert sessions.get(session_id).focused_id == "p01"
    fake_llm.script = [tool_msg(("stage_checkout", {"product_id": "p01", "quantity": 1})), text_msg("Okay.")]
    events = chat(client, session_id, "buy this", visible_ids=["p02", "p03"])
    assert sessions.get(session_id).staged == {}
    assert sessions.get(session_id).focused_id is None
    assert not any(action["action"] == "stage_checkout" for action in of(events, "action"))


def test_voice_feedback_uses_existing_deterministic_tool(client, session_id, fake_llm) -> None:
    fake_llm.script = [tool_msg(SEARCH), text_msg("The results are on screen.")]
    chat(client, session_id, HERO)
    calls_before = len(fake_llm.requests)
    events = chat(client, session_id, "I don't like this", focused_id="p01")
    assert len(fake_llm.requests) == calls_before
    assert any(action["action"] == "rerank" for action in of(events, "action"))
    assert sessions.get(session_id).profile.dismissed[0].id == "p01"
    assert of(events, "done")[-1]["source"] == "fallback"


def test_whole_turn_deadline_cancels_model_and_falls_back(client, session_id, fake_llm, monkeypatch) -> None:
    cancelled = []

    class SlowClient:
        async def complete(self, *args):
            try:
                await asyncio.sleep(10)
            except asyncio.CancelledError:
                cancelled.append(True)
                raise

    monkeypatch.setattr(llm, "_client", SlowClient())
    # Give the HTTP/test thread ample time to enter the mocked model call.
    # The whole-turn limit must then cancel its ten-second wait, independently
    # of the much longer configured per-call timeout.
    monkeypatch.setattr(get_settings(), "llm_turn_budget_s", 1.0)
    started_at = time.monotonic()
    events = chat(client, session_id, HERO)
    elapsed = time.monotonic() - started_at
    assert cancelled == [True]
    assert elapsed < 5, "The whole-turn deadline must not wait for the ten-second model response"
    assert of(events, "done")[-1]["source"] == "fallback"
    assert any(action["action"] == "show_results" for action in of(events, "action"))


def test_llm_stream_emits_sse_comment_while_waiting(client, session_id, fake_llm) -> None:
    fake_llm.script = [text_msg("Hello.")]
    response = client.post("/chat", json={"session_id": session_id, "text": "hello"})
    assert response.text.startswith(": thinking\n\n")
    assert read_sse(response)[-1][0] == "done"


@pytest.mark.parametrize("text,expected", [
    ("buy two of these", 2), ("get me two of these", 2),
    ("buy this SPF 2 cream", 1), ("buy it for $2", 1), ("buy 20 bottles", 20),
])
def test_quantity_parser_uses_purchase_context(text, expected) -> None:
    assert fallback._quantity(text) == expected


# --- voice -------------------------------------------------------------------


@pytest.fixture
def voice_key() -> Iterator[None]:
    s = get_settings()
    s.elevenlabs_api_key = "test-key"
    tts_cache.clear()
    yield
    s.elevenlabs_api_key = ""
    voice.transport = None
    tts_cache.clear()


def test_voice_without_key_points_to_browser_fallbacks(client) -> None:
    r = client.get("/stt/token")
    assert r.status_code == 503 and r.json()["fallback"] == "web_speech"
    r = client.post("/tts", json={"text": "hello"})
    assert r.status_code == 503 and r.json()["fallback"] == "speech_synthesis"


def test_stt_token_and_tts_proxy(client, voice_key) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.headers["xi-api-key"] == "test-key"
        if request.url.path.endswith("/single-use-token/realtime_scribe"):
            return httpx.Response(200, json={"token": "sutkn_abc"})
        assert request.url.path.endswith("/stream") and json.loads(request.content)["text"] == "hello"
        return httpx.Response(200, content=b"ID3fakeaudio", headers={"content-type": "audio/mpeg"})

    voice.transport = httpx.MockTransport(handler)
    assert client.get("/stt/token").json()["token"] == "sutkn_abc"
    r = client.post("/tts", json={"text": "hello"})
    assert r.status_code == 200 and r.headers["content-type"] == "audio/mpeg" and r.content == b"ID3fakeaudio"


def test_tts_repeats_come_from_cache(client, voice_key) -> None:
    calls: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(json.loads(request.content)["text"])
        return httpx.Response(200, content=b"ID3clip-" + calls[-1].encode(), headers={"content-type": "audio/mpeg"})

    voice.transport = httpx.MockTransport(handler)
    text = "Nothing was charged, cache test."
    first = client.post("/tts", json={"text": text})
    second = client.post("/tts", json={"text": text})
    assert first.headers["x-tts-cache"] == "miss" and second.headers["x-tts-cache"] == "hit"
    assert first.content == second.content and calls == [text]
    assert client.post("/tts", json={"text": "A different sentence, cache test."}).headers["x-tts-cache"] == "miss"
    assert len(calls) == 2


def test_voice_upstream_error_falls_back(client, voice_key) -> None:
    voice.transport = httpx.MockTransport(lambda r: httpx.Response(401, json={"detail": "bad key"}))
    assert client.post("/tts", json={"text": "hello"}).json()["fallback"] == "speech_synthesis"
