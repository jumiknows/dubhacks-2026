"""ElevenLabs proxies, so the API key never reaches the browser.

- GET /stt/token: mints a single-use realtime Scribe token (expires after 15 minutes, consumed on use).
  Docs: POST https://api.elevenlabs.io/v1/single-use-token/realtime_scribe -> {"token": "..."}
- POST /tts: streams speech for one sentence as audio/mpeg.
  Docs: POST https://api.elevenlabs.io/v1/text-to-speech/{voice_id}/stream

Without a key, or on any upstream failure, both return 503 with the browser fallback to use.
Speech text is never logged.
"""

from __future__ import annotations

import logging
from typing import AsyncIterator

import httpx
from fastapi import APIRouter
from fastapi.responses import JSONResponse, StreamingResponse

from api.config import get_settings
from api.schemas import TTSRequest

log = logging.getLogger(__name__)
router = APIRouter(tags=["Voice"])

ELEVENLABS_API = "https://api.elevenlabs.io/v1"
STT_TOKEN_TTL_S = 15 * 60
transport: httpx.AsyncBaseTransport | None = None  # test hook


def _unavailable(error: str, fallback: str) -> JSONResponse:
    return JSONResponse({"error": error, "fallback": fallback}, status_code=503)


def _client(timeout_s: float) -> httpx.AsyncClient:
    return httpx.AsyncClient(base_url=ELEVENLABS_API, timeout=httpx.Timeout(timeout_s, connect=3.0), transport=transport)


@router.get("/stt/token")
async def stt_token() -> JSONResponse:
    s = get_settings()
    if not s.voice_enabled:
        return _unavailable("ElevenLabs not configured", "web_speech")
    try:
        async with _client(s.elevenlabs_timeout_s) as c:
            r = await c.post("/single-use-token/realtime_scribe", headers={"xi-api-key": s.elevenlabs_api_key})
    except httpx.HTTPError as exc:
        log.warning("ElevenLabs token request failed: %s", type(exc).__name__)
        return _unavailable("Speech service unreachable", "web_speech")
    if r.status_code != 200 or "token" not in r.json():
        log.warning("ElevenLabs token request returned HTTP %s", r.status_code)
        return _unavailable("Speech service error", "web_speech")
    # TODO(verify): the realtime STT WebSocket URL and model id the browser should connect with,
    # in the ElevenLabs "Speech to Text / Realtime" docs. The frontend passes this token there.
    return JSONResponse({"token": r.json()["token"], "expires_in_s": STT_TOKEN_TTL_S})


@router.post("/tts", response_model=None)
async def tts(req: TTSRequest) -> StreamingResponse | JSONResponse:
    s = get_settings()
    if not s.voice_enabled:
        return _unavailable("ElevenLabs not configured", "speech_synthesis")
    client = _client(s.elevenlabs_timeout_s)
    request = client.build_request(
        "POST",
        f"/text-to-speech/{s.elevenlabs_voice_id}/stream",
        params={"output_format": "mp3_44100_128"},
        headers={"xi-api-key": s.elevenlabs_api_key},
        json={"text": req.text, "model_id": s.elevenlabs_model_id},
    )
    try:
        upstream = await client.send(request, stream=True)
    except httpx.HTTPError as exc:
        await client.aclose()
        log.warning("ElevenLabs TTS request failed: %s", type(exc).__name__)
        return _unavailable("Speech service unreachable", "speech_synthesis")
    if upstream.status_code != 200:
        await upstream.aread()
        await upstream.aclose()
        await client.aclose()
        log.warning("ElevenLabs TTS returned HTTP %s", upstream.status_code)
        return _unavailable("Speech service error", "speech_synthesis")

    async def audio() -> AsyncIterator[bytes]:
        try:
            async for chunk in upstream.aiter_bytes():
                yield chunk
        finally:
            await upstream.aclose()
            await client.aclose()

    return StreamingResponse(audio(), media_type="audio/mpeg", headers={"Cache-Control": "no-store"})
