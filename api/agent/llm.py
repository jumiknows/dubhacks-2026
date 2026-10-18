"""OpenAI-compatible Chat Completions client (OpenAI, Gemini's OpenAI endpoint, Groq, ...).

Configured only by LLM_BASE_URL / LLM_API_KEY / LLM_MODEL, so switching providers needs no code.
Every call has a hard timeout; callers fall back to the deterministic agent on any LLMError.
"""

from __future__ import annotations

import asyncio
import copy
import logging
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import urlsplit

import httpx

from api.config import get_settings

log = logging.getLogger(__name__)


class LLMError(Exception):
    """Any failure talking to the LLM: timeout, HTTP error, malformed response."""


@dataclass
class ToolCall:
    id: str
    name: str
    arguments: str  # raw JSON string, validated by the caller


@dataclass
class Completion:
    content: str
    tool_calls: list[ToolCall] = field(default_factory=list)
    raw_message: dict[str, Any] = field(default_factory=dict)


class LLMClient:
    def __init__(self, transport: httpx.AsyncBaseTransport | None = None) -> None:
        s = get_settings()
        self._model = s.llm_model
        self._reasoning_effort = s.llm_reasoning_effort
        if (not self._reasoning_effort and self._model.startswith("gemini-3")
                and urlsplit(s.llm_base_url).hostname == "generativelanguage.googleapis.com"):
            self._reasoning_effort = "low"
        self._max_tokens = s.llm_max_tokens
        self._http = httpx.AsyncClient(
            base_url=s.llm_base_url.rstrip("/") + "/",
            headers={"Authorization": f"Bearer {s.llm_api_key}"},
            transport=transport,
        )

    async def aclose(self) -> None:
        await self._http.aclose()

    async def complete(
        self, messages: list[dict[str, Any]], tools: list[dict[str, Any]] | None, timeout_s: float
    ) -> Completion:
        if timeout_s <= 0:
            raise LLMError("LLM request budget exhausted")
        body: dict[str, Any] = {
            "model": self._model, "messages": messages, "temperature": 0.2,
            "max_tokens": self._max_tokens,
        }
        if tools:
            body["tools"] = tools
            body["tool_choice"] = "auto"
        if self._reasoning_effort:
            body["reasoning_effort"] = self._reasoning_effort
        try:
            # httpx alone limits individual I/O phases, not total elapsed time.
            async with asyncio.timeout(timeout_s):
                resp = await self._http.post("chat/completions", json=body, timeout=timeout_s)
        except (httpx.TimeoutException, TimeoutError) as exc:
            raise LLMError(f"LLM timed out after {timeout_s:.1f}s") from exc
        except httpx.HTTPError as exc:
            raise LLMError(f"LLM request failed: {type(exc).__name__}") from exc
        if resp.status_code != 200:
            # Provider error bodies can echo credentials or prompts. Keep them out of logs.
            raise LLMError(f"LLM returned HTTP {resp.status_code}")
        try:
            payload = resp.json()
            if not isinstance(payload, dict) or not isinstance(payload.get("choices"), list):
                raise ValueError
            choice = payload["choices"][0]
            if not isinstance(choice, dict):
                raise ValueError
            if choice.get("finish_reason") in {"length", "max_tokens", "MAX_TOKENS", "content_filter"}:
                raise LLMError("LLM response was truncated or blocked")
            msg = choice["message"]
            if not isinstance(msg, dict):
                raise ValueError
            content = msg.get("content")
            if content is not None and not isinstance(content, str):
                raise ValueError
            raw_calls = msg.get("tool_calls") or []
            if not isinstance(raw_calls, list) or len(raw_calls) > 32:
                raise ValueError
            calls: list[ToolCall] = []
            replay_calls: list[dict[str, Any]] = []
            for i, call in enumerate(raw_calls):
                if not isinstance(call, dict) or not isinstance(call.get("function"), dict):
                    raise ValueError
                name = call["function"].get("name")
                arguments = call["function"].get("arguments", "{}")
                call_id = call.get("id") or f"call_{i}"
                if not isinstance(name, str) or not name or not isinstance(arguments, str):
                    raise ValueError
                if not isinstance(call_id, str) or not call_id:
                    raise ValueError
                if "extra_content" in call and not isinstance(call["extra_content"], dict):
                    raise ValueError
                calls.append(ToolCall(id=call_id, name=name, arguments=arguments))
                replay = copy.deepcopy(call)
                replay.update(id=call_id, type="function")
                replay_calls.append(replay)
            if not calls and not (content or "").strip():
                raise LLMError("LLM returned no usable content")
        except (KeyError, IndexError, TypeError, ValueError) as exc:
            raise LLMError("LLM response was malformed") from exc
        raw = {"role": "assistant", "content": content or ""}
        if calls:
            # Gemini requires opaque thought signatures on subsequent tool rounds.
            # Preserve each provider call, including extra_content, exactly as received.
            raw["tool_calls"] = replay_calls
        if isinstance(msg.get("extra_content"), dict):
            raw["extra_content"] = copy.deepcopy(msg["extra_content"])
        return Completion(content=(content or "").strip(), tool_calls=calls, raw_message=raw)


_client: LLMClient | None = None


def init(transport: httpx.AsyncBaseTransport | None = None) -> LLMClient | None:
    """Create the shared client at startup (None when no API key is set)."""
    global _client
    _client = LLMClient(transport) if get_settings().llm_enabled else None
    return _client


def client() -> LLMClient | None:
    return _client


async def close() -> None:
    global _client
    if _client is not None:
        await _client.aclose()
        _client = None
