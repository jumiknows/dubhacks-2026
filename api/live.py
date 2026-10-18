"""Gemini Multimodal Live relay: browser <-> FastAPI <-> Gemini, tools hit Planboard."""

from __future__ import annotations

import asyncio
import base64
import json
import logging
from typing import Any

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
    "You are Planboard's voice shopping partner. Talk like a helpful friend helping someone get ready: "
    "camping, a wedding, groceries, electronics, or whatever they describe. "
    "When they say what they need, call create_plan. When they ask what is on the list or the total, call get_plan. "
    "When they already bought something, call mark_purchased. When they want to choose between two offers, "
    "call list_shortlist then compare_listings. When they talk about trusting reviews more or less, call set_trust_floor. "
    "Keep spoken replies short. Never invent prices or product names; only speak what tools return. "
    "Do not process payments."
)


def _gemini_url(api_key: str) -> str:
    return (
        "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta."
        f"GenerativeService.BidiGenerateContent?key={api_key}"
    )


def _setup_message(model: str) -> dict[str, Any]:
    return {
        "setup": {
            "model": f"models/{model}",
            "generationConfig": {"responseModalities": ["AUDIO"]},
            "systemInstruction": {"parts": [{"text": SYSTEM_INSTRUCTION}]},
            "tools": [{"functionDeclarations": FUNCTION_DECLARATIONS}],
        }
    }


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

    context = LiveContext()
    log.info("Client connected to Gemini Live relay.")

    try:
        async with websockets.connect(
            _gemini_url(api_key),
            additional_headers={"x-goog-api-key": api_key},
            max_size=8 * 1024 * 1024,
        ) as gemini_ws:
            await gemini_ws.send(json.dumps(_setup_message(settings.gemini_live_model)))

            async def client_to_gemini() -> None:
                try:
                    while True:
                        message = await client_websocket.receive()
                        if message.get("type") == "websocket.disconnect":
                            break
                        text = message.get("text")
                        blob = message.get("bytes")
                        if blob:
                            await gemini_ws.send(json.dumps({
                                "realtimeInput": {
                                    "mediaChunks": [{
                                        "mimeType": "audio/pcm;rate=16000",
                                        "data": base64.b64encode(blob).decode("ascii"),
                                    }]
                                }
                            }))
                            continue
                        if not text:
                            continue
                        data = json.loads(text)
                        if data.get("type") == "session":
                            if data.get("plan_id"):
                                context.plan_id = str(data["plan_id"])
                            if isinstance(data.get("trust_floor"), (int, float)):
                                context.trust_floor = float(data["trust_floor"])
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

            await asyncio.gather(client_to_gemini(), gemini_to_client())
    except WebSocketDisconnect:
        log.info("Client disconnected from Gemini Live relay.")
    except Exception as exc:
        log.exception("Live relay error: %s", exc)
        try:
            await client_websocket.send_text(json.dumps({"type": "error", "error": "Live session ended"}))
        except Exception:
            pass
