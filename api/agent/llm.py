"""OpenAI-compatible Chat Completions client (OpenAI, Gemini's OpenAI endpoint, Groq, ...).

Configured only by LLM_BASE_URL / LLM_API_KEY / LLM_MODEL, so switching providers needs no code.
Every call has a hard timeout; callers fall back to the deterministic agent on any LLMError.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any

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
        body: dict[str, Any] = {"model": self._model, "messages": messages, "temperature": 0.2, "max_tokens": 400}
        if tools:
            body["tools"] = tools
            body["tool_choice"] = "auto"
        if self._reasoning_effort:
            body["reasoning_effort"] = self._reasoning_effort
        try:
            resp = await self._http.post("chat/completions", json=body, timeout=max(0.5, timeout_s))
        except httpx.TimeoutException as exc:
            raise LLMError(f"LLM timed out after {timeout_s:.1f}s") from exc
        except httpx.HTTPError as exc:
            raise LLMError(f"LLM request failed: {type(exc).__name__}") from exc
        if resp.status_code != 200:
            raise LLMError(f"LLM returned HTTP {resp.status_code}: {resp.text[:200]}")
        try:
            msg = resp.json()["choices"][0]["message"]
            calls = [
                ToolCall(id=c.get("id") or f"call_{i}", name=c["function"]["name"], arguments=c["function"].get("arguments") or "{}")
                for i, c in enumerate(msg.get("tool_calls") or [])
            ]
        except (KeyError, IndexError, TypeError, ValueError) as exc:
            raise LLMError("LLM response was malformed") from exc
        raw = {"role": "assistant", "content": msg.get("content") or ""}
        if calls:
            raw["tool_calls"] = [
                {"id": c.id, "type": "function", "function": {"name": c.name, "arguments": c.arguments}} for c in calls
            ]
        return Completion(content=(msg.get("content") or "").strip(), tool_calls=calls, raw_message=raw)


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
