"""LLM agent path, tested against a scripted fake LLM (no network)."""

from __future__ import annotations

import json
from collections.abc import Iterator
from typing import Any

import httpx
import pytest

from api import voice
from api.agent import llm, tools
from api.config import get_settings
from api.sessions import breaker, sessions, tts_cache
from api.tests.conftest import read_sse

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
    llm._client = llm.LLMClient(httpx.MockTransport(fake.handler))
    breaker.failures, breaker.open_until = 0, 0.0
    yield fake
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


def test_ungrounded_speech_is_regenerated(client, session_id, fake_llm) -> None:
    fake_llm.script = [tool_msg(SEARCH), text_msg("Top pick is $25 today."),
                       text_msg("The top match is Lumenroot Ceramide Barrier Cream at $28.")]
    events = chat(client, session_id, HERO)
    assert of(events, "done")[-1]["grounded"] is True
    assert "$28" in speech(events) and "$25" not in speech(events)
    assert "not in this turn's tool results" in fake_llm.requests[-1]["messages"][-1]["content"]


def test_twice_ungrounded_uses_template(client, session_id, fake_llm) -> None:
    fake_llm.script = [tool_msg(SEARCH), text_msg("Only $25 each."), text_msg("Still just $19.")]
    events = chat(client, session_id, HERO)
    assert of(events, "done")[-1] == {"grounded": False, "source": "llm"}
    assert "$25" not in speech(events) and "$19" not in speech(events)
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
    assert of(events, "done")[-1] == {"grounded": False, "source": "llm"}


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
        return httpx.Response(200, content=b"ID3fakeaudio")

    voice.transport = httpx.MockTransport(handler)
    assert client.get("/stt/token").json()["token"] == "sutkn_abc"
    r = client.post("/tts", json={"text": "hello"})
    assert r.status_code == 200 and r.headers["content-type"] == "audio/mpeg" and r.content == b"ID3fakeaudio"


def test_tts_repeats_come_from_cache(client, voice_key) -> None:
    calls: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(json.loads(request.content)["text"])
        return httpx.Response(200, content=b"ID3clip-" + calls[-1].encode())

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
