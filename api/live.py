"""Gemini Multimodal Live relay: browser <-> FastAPI <-> Gemini, tools hit Planboard."""

from __future__ import annotations

import asyncio
import base64
import json
import logging
import math
import time
from typing import Any

import httpx

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

try:
    import websockets
except ImportError:  # pragma: no cover
    websockets = None  # type: ignore[assignment]

from api.config import get_settings
from api.live_tools import FUNCTION_DECLARATIONS, LiveContext

log = logging.getLogger(__name__)
router = APIRouter()

SYSTEM_INSTRUCTION = (
    "You are ESPER's voice shopping partner. Talk like a helpful friend helping someone get ready: "
    "camping, a wedding, groceries, electronics, or whatever they describe. "
    "When they say what they need, call create_plan. It returns the checklist right away while store prices "
    "keep loading on screen: name two or three items, say prices are coming in, and stop. "
    "When they ask about prices, totals or what is on the list, call get_plan. "
    "When they already bought something, call mark_purchased. When they want to choose between two offers, "
    "call list_shortlist then compare_listings. When they talk about trusting reviews more or less, call set_trust_floor. "
    "Speak one or two short sentences per turn: the screen shows the details, so never read lists or prices "
    "unless asked. Reply in English unless the user speaks another language. "
    "Never invent prices or product names; only speak what tools return. "
    "Do not process payments."
)


def _gemini_url(api_key: str) -> str:
    return (
        "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta."
        f"GenerativeService.BidiGenerateContent?key={api_key}"
    )


# Live models in order of preference when the configured one is not offered to this key.
_MODEL_PREFERENCE = ("flash-live", "native-audio", "live")
# Live-capable but not conversational, or slower than a shopping chat needs.
_MODEL_SKIP = ("transcribe", "translate", "robotics", "thinking")
_resolved_model: str | None = None

# The browser may only send audio and conversation turns. Setup, tool
# responses and anything else stay under the relay's control.
_CLIENT_KEYS = {"realtimeInput", "clientContent"}


async def resolve_model(api_key: str, configured: str) -> str:
    """The configured model if this key can open a Live session with it, else the best one that can.

    Live model ids change often; listing them once per process keeps the demo
    working when a preview id is retired.
    """
    global _resolved_model
    if _resolved_model:
        return _resolved_model
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            response = await client.get(
                "https://generativelanguage.googleapis.com/v1beta/models",
                params={"pageSize": 1000},
                headers={"x-goog-api-key": api_key},
            )
        names = [
            m["name"].removeprefix("models/")
            for m in response.json().get("models", [])
            if "bidiGenerateContent" in m.get("supportedGenerationMethods", [])
            and not any(skip in m["name"] for skip in _MODEL_SKIP)
        ]
    except Exception:  # network, auth or shape problems: try the configured id
        log.warning("Could not list Gemini Live models; using the configured model")
        return configured
    if configured in names or not names:
        _resolved_model = configured
    else:
        ranked = sorted(names, key=lambda name: next(
            (i for i, hint in enumerate(_MODEL_PREFERENCE) if hint in name), len(_MODEL_PREFERENCE),
        ))
        _resolved_model = ranked[0]
        log.info("Gemini Live model %s is not available; using %s", configured, _resolved_model)
    return _resolved_model


def _setup_message(model: str, captions: bool = True) -> dict[str, Any]:
    setup: dict[str, Any] = {
        "model": f"models/{model}",
        "generationConfig": {"responseModalities": ["AUDIO"]},
        "systemInstruction": {"parts": [{"text": SYSTEM_INSTRUCTION}]},
        "tools": [{"functionDeclarations": FUNCTION_DECLARATIONS}],
        # The browser marks speech start and end (activityStart / activityEnd) and
        # sends audio only while someone is talking: no silence is billed, and the
        # turn ends the moment the user stops instead of after a server timeout.
        "realtimeInputConfig": {"automaticActivityDetection": {"disabled": True}},
        # Long sessions keep a sliding window instead of an ever-growing context.
        "contextWindowCompression": {"slidingWindow": {}},
    }
    if captions:
        setup["outputAudioTranscription"] = {}
    return {"setup": setup}


def _ui_event(tool_result: dict[str, Any]) -> dict[str, Any] | None:
    kind = tool_result.get("ui")
    if kind == "PLAN" and tool_result.get("plan"):
        return {"type": "UI_UPDATE", "action": "PLAN", "payload": tool_result["plan"]}
    if kind == "COMPARE" and tool_result.get("compare"):
        return {
            "type": "UI_UPDATE",
            "action": "COMPARE",
            "payload": tool_result["compare"],
            "item_id": tool_result.get("item_id"),
        }
    if kind == "TRUST_FLOOR":
        return {"type": "UI_UPDATE", "action": "TRUST_FLOOR", "payload": {"trust_floor": tool_result.get("trust_floor")}}
    if kind == "SHORTLIST":
        return {
            "type": "UI_UPDATE",
            "action": "SHORTLIST",
            "payload": tool_result.get("listings") or [],
            "item_id": tool_result.get("item_id"),
        }
    return None


@router.websocket("/ws-live")
async def live_relay_endpoint(client_websocket: WebSocket) -> None:
    await client_websocket.accept()
    settings = get_settings()
    api_key = settings.gemini_live_key
    if not api_key or websockets is None:
        reason = (
            "websockets package is not installed"
            if websockets is None
            else "Gemini Live is not configured. Set GEMINI_API_KEY in api/.env."
        )
        await client_websocket.send_text(json.dumps({"type": "error", "error": reason}))
        await client_websocket.close()
        return

    context = LiveContext(session_cookie=client_websocket.cookies.get("pb_sid"))
    log.info("Client connected to Gemini Live relay.")

    try:
        model = await resolve_model(api_key, settings.gemini_live_model)
        async with websockets.connect(
            _gemini_url(api_key),
            additional_headers={"x-goog-api-key": api_key},
            max_size=8 * 1024 * 1024,
        ) as gemini_ws:
            await gemini_ws.send(json.dumps(_setup_message(model, settings.gemini_live_captions)))
            deadline = time.monotonic() + settings.gemini_live_max_session_s

            async def client_to_gemini() -> None:
                try:
                    while True:
                        remaining = deadline - time.monotonic()
                        if remaining <= 0:
                            await client_websocket.send_text(json.dumps({"type": "error", "error": "session_limit"}))
                            break
                        try:
                            message = await asyncio.wait_for(client_websocket.receive(), timeout=remaining)
                        except asyncio.TimeoutError:
                            continue
                        if message.get("type") == "websocket.disconnect":
                            break
                        text = message.get("text")
                        blob = message.get("bytes")
                        if blob:
                            await gemini_ws.send(json.dumps({
                                "realtimeInput": {
                                    "audio": {
                                        "mimeType": "audio/pcm;rate=16000",
                                        "data": base64.b64encode(blob).decode("ascii"),
                                    }
                                }
                            }))
                            continue
                        if not text:
                            continue
                        try:
                            data = json.loads(text)
                        except (ValueError, TypeError):
                            continue
                        if not isinstance(data, dict):
                            continue
                        if data.get("type") == "session":
                            if data.get("plan_id"):
                                context.plan_id = str(data["plan_id"])
                            trust_floor = data.get("trust_floor")
                            if type(trust_floor) in (int, float) and math.isfinite(trust_floor):
                                context.trust_floor = min(1.0, max(0.0, trust_floor))
                            continue
                        if not data or set(data) - _CLIENT_KEYS:
                            continue
                        await gemini_ws.send(json.dumps(data))
                except asyncio.CancelledError:
                    pass
                except WebSocketDisconnect:
                    pass

            async def gemini_to_client() -> None:
                try:
                    async for raw_response in gemini_ws:
                        response = json.loads(raw_response)
                        tool_call = response.get("toolCall") or response.get("tool_call")
                        if tool_call:
                            replies = []
                            for fc in tool_call.get("functionCalls") or tool_call.get("function_calls") or []:
                                fn_name = fc.get("name") or ""
                                fn_args = fc.get("args") or {}
                                call_id = fc.get("id") or ""
                                tool_result = await context.execute(fn_name, fn_args)
                                replies.append({
                                    "response": {"output": tool_result},
                                    "id": call_id,
                                    "name": fn_name,
                                })
                                event = _ui_event(tool_result)
                                if event:
                                    await client_websocket.send_text(json.dumps(event))
                            await gemini_ws.send(json.dumps({"toolResponse": {"functionResponses": replies}}))
                            continue
                        await client_websocket.send_text(raw_response if isinstance(raw_response, str) else json.dumps(response))
                except asyncio.CancelledError:
                    pass

            # Whichever side finishes first (browser left, session limit, Gemini closed) ends both.
            tasks = [asyncio.create_task(client_to_gemini()), asyncio.create_task(gemini_to_client())]
            try:
                await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
            finally:
                for task in tasks:
                    if not task.done():
                        task.cancel()
                results = await asyncio.gather(*tasks, return_exceptions=True)
                for result in results:
                    if isinstance(result, Exception):
                        raise result
    except WebSocketDisconnect:
        log.info("Client disconnected from Gemini Live relay.")
    except Exception as exc:
        # Provider exceptions can contain the authenticated WebSocket URL.
        log.warning("Live relay failed (%s)", type(exc).__name__)
        try:
            await client_websocket.send_text(json.dumps({"type": "error", "error": "Live session ended"}))
        except Exception:
            pass
