"""Chat Completions transport contracts; all HTTP calls use MockTransport."""

from __future__ import annotations

import asyncio
import json

import httpx
import pytest

from api.agent import llm
from api.config import Settings


@pytest.fixture
def llm_settings(monkeypatch):
    settings = Settings(
        _env_file=None, llm_base_url="https://generativelanguage.googleapis.com/v1beta/openai/",
        llm_model="gemini-3.8-flash", llm_api_key="local-test-only", llm_max_tokens=2048,
        llm_reasoning_effort="",
    )
    monkeypatch.setattr(llm, "get_settings", lambda: settings)
    return settings


def complete_with(handler, timeout: float = 1):
    async def run():
        client = llm.LLMClient(httpx.MockTransport(handler))
        try:
            return await client.complete([{"role": "user", "content": "Hello"}], None, timeout)
        finally:
            await client.aclose()

    return asyncio.run(run())


def test_google_base_path_reasoning_and_configurable_token_ceiling(llm_settings) -> None:
    def handler(request):
        assert str(request.url) == "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions"
        body = json.loads(request.content)
        assert body["model"] == "gemini-3.8-flash"
        assert body["reasoning_effort"] == "low" and body["max_tokens"] == 2048
        return httpx.Response(200, json={"choices": [{"message": {"content": "Hello."}, "finish_reason": "stop"}]})

    assert complete_with(handler).content == "Hello."


def test_google_default_does_not_override_explicit_effort(llm_settings) -> None:
    llm_settings.llm_reasoning_effort = "medium"

    def handler(request):
        assert json.loads(request.content)["reasoning_effort"] == "medium"
        return httpx.Response(200, json={"choices": [{"message": {"content": "Hello."}}]})

    complete_with(handler)


def test_provider_metadata_survives_tool_round_trip(llm_settings) -> None:
    signature = {"google": {"thought_signature": "opaque-local-fixture"}}
    requests = []

    def handler(request):
        body = json.loads(request.content)
        requests.append(body)
        if len(requests) == 1:
            return httpx.Response(200, json={"choices": [{"message": {
                "role": "assistant", "content": None, "tool_calls": [{
                    "id": "fixture-call", "type": "function", "extra_content": signature,
                    "function": {"name": "search_products", "arguments": '{"query":"cream"}'},
                }],
            }, "finish_reason": "tool_calls"}]})
        replay = body["messages"][1]["tool_calls"][0]
        assert replay["extra_content"] == signature
        assert replay["id"] == "fixture-call"
        return httpx.Response(200, json={"choices": [{"message": {"content": "Results are on screen."}}]})

    async def run():
        client = llm.LLMClient(httpx.MockTransport(handler))
        try:
            messages = [{"role": "user", "content": "Find cream"}]
            first = await client.complete(messages, [{"type": "function"}], 1)
            assert first.tool_calls[0].name == "search_products"
            messages += [first.raw_message, {"role": "tool", "tool_call_id": "fixture-call", "content": "{}"}]
            assert (await client.complete(messages, None, 1)).content == "Results are on screen."
        finally:
            await client.aclose()

    asyncio.run(run())


@pytest.mark.parametrize("payload", [
    [], {}, {"choices": []}, {"choices": [None]}, {"choices": [{"message": "bad"}]},
    {"choices": [{"message": {"content": ["unsupported content"]}}]},
    {"choices": [{"message": {"content": "Hi", "tool_calls": [None]}}]},
    {"choices": [{"message": {"tool_calls": [{"function": {"name": "search", "arguments": {}}}]}}]},
])
def test_malformed_provider_payloads_raise_llmerror(llm_settings, payload) -> None:
    with pytest.raises(llm.LLMError, match="malformed"):
        complete_with(lambda request: httpx.Response(200, json=payload))


@pytest.mark.parametrize("message,finish_reason", [
    ({"content": None}, "stop"), ({"content": "   "}, "stop"),
    ({"content": "Truncated"}, "length"), ({"content": "Blocked"}, "content_filter"),
])
def test_empty_or_truncated_responses_cannot_be_used(llm_settings, message, finish_reason) -> None:
    with pytest.raises(llm.LLMError):
        complete_with(lambda request: httpx.Response(200, json={"choices": [{
            "message": message, "finish_reason": finish_reason,
        }]}))


def test_invalid_json_and_upstream_bodies_are_sanitized(llm_settings) -> None:
    with pytest.raises(llm.LLMError, match="malformed"):
        complete_with(lambda request: httpx.Response(200, content=b"not JSON"))
    with pytest.raises(llm.LLMError) as error:
        complete_with(lambda request: httpx.Response(401, text="credential-sentinel private prompt"))
    assert str(error.value) == "LLM returned HTTP 401"
    assert "credential-sentinel" not in str(error.value)


def test_wall_clock_timeout_cancels_slow_transport(llm_settings) -> None:
    cancelled = []

    async def handler(request):
        try:
            await asyncio.sleep(10)
        except asyncio.CancelledError:
            cancelled.append(True)
            raise
        return httpx.Response(200, json={"choices": [{"message": {"content": "Late"}}]})

    with pytest.raises(llm.LLMError, match="timed out"):
        complete_with(handler, timeout=0.01)
    assert cancelled == [True]


def test_exhausted_budget_does_not_send_request(llm_settings) -> None:
    def handler(request):
        raise AssertionError("No request may start after its budget expires")

    with pytest.raises(llm.LLMError, match="budget exhausted"):
        complete_with(handler, timeout=0)
