"""ElevenLabs proxies, so the API key never reaches the browser.

- GET /stt/token: mints a single-use realtime Scribe token (expires after 15 minutes, consumed on use).
  Docs: POST https://api.elevenlabs.io/v1/single-use-token/realtime_scribe -> {"token": "..."}
- POST /tts: streams speech for one sentence as audio/mpeg.
  Docs: POST https://api.elevenlabs.io/v1/text-to-speech/{voice_id}/stream

Missing configuration and rejected/unavailable provider responses return 503 with the browser fallback.
An interrupted audio stream closes without caching its partial contents.
Repeated sentences are served from an in-memory cache (no credits used). Speech text is never logged.
"""

from __future__ import annotations

import asyncio
import hashlib
import logging
from typing import AsyncIterator

import httpx
from fastapi import APIRouter
from fastapi.responses import JSONResponse, Response, StreamingResponse

from api.config import get_settings
from api.schemas import TTSRequest
from api.sessions import tts_cache

log = logging.getLogger(__name__)
router = APIRouter(tags=["Voice"])

ELEVENLABS_API = "https://api.elevenlabs.io/v1"
STT_TOKEN_TTL_S = 15 * 60
MAX_CACHED_CLIP_BYTES = 1024 * 1024
_AUDIO_HEADERS = {"Cache-Control": "no-store"}
transport: httpx.AsyncBaseTransport | None = None  # test hook


def _unavailable(error: str, fallback: str) -> JSONResponse:
    return JSONResponse({"error": error, "fallback": fallback}, status_code=503, headers=_AUDIO_HEADERS)


def _client(timeout_s: float) -> httpx.AsyncClient:
    return httpx.AsyncClient(base_url=ELEVENLABS_API, timeout=httpx.Timeout(timeout_s, connect=3.0), transport=transport)


async def _close_audio(upstream: httpx.Response, client: httpx.AsyncClient) -> None:
    try:
        await upstream.aclose()
    finally:
        await client.aclose()


@router.get("/stt/token")
async def stt_token() -> JSONResponse:
    s = get_settings()
    if not s.voice_enabled:
        return _unavailable("ElevenLabs not configured", "web_speech")
    try:
        async with asyncio.timeout(s.elevenlabs_timeout_s):
            async with _client(s.elevenlabs_timeout_s) as c:
                r = await c.post("/single-use-token/realtime_scribe", headers={"xi-api-key": s.elevenlabs_api_key})
    except (httpx.HTTPError, TimeoutError) as exc:
        log.warning("ElevenLabs token request failed: %s", type(exc).__name__)
        return _unavailable("Speech service unreachable", "web_speech")
    try:
        payload = r.json() if r.status_code == 200 else None
    except ValueError:
        payload = None
    token = payload.get("token") if isinstance(payload, dict) else None
    if not isinstance(token, str) or not token.strip() or len(token) > 4096:
        log.warning("ElevenLabs token request returned HTTP %s", r.status_code)
        return _unavailable("Speech service error", "web_speech")
    # TODO(verify): the realtime STT WebSocket URL and model id the browser should connect with,
    # in the ElevenLabs "Speech to Text / Realtime" docs. The frontend passes this token there.
    return JSONResponse({"token": token, "expires_in_s": STT_TOKEN_TTL_S}, headers=_AUDIO_HEADERS)


def _cache_key(voice_id: str, model_id: str, text: str) -> str:
    return hashlib.sha256(f"{voice_id}|{model_id}|{text.strip()}".encode()).hexdigest()


@router.post("/tts", response_model=None)
async def tts(req: TTSRequest) -> Response:
    s = get_settings()
    if not s.voice_enabled:
        return _unavailable("ElevenLabs not configured", "speech_synthesis")
    key = _cache_key(s.elevenlabs_voice_id, s.elevenlabs_model_id, req.text)
    cached = tts_cache.get(key)
    if cached is not None:
        return Response(cached, media_type="audio/mpeg", headers={**_AUDIO_HEADERS, "X-TTS-Cache": "hit"})

    # One deadline covers both receiving headers and streaming audio.
    deadline = asyncio.get_running_loop().time() + s.elevenlabs_timeout_s
    client = _client(s.elevenlabs_timeout_s)
    request = client.build_request(
        "POST",
        f"/text-to-speech/{s.elevenlabs_voice_id}/stream",
        params={"output_format": "mp3_44100_128"},
        headers={"xi-api-key": s.elevenlabs_api_key},
        json={"text": req.text, "model_id": s.elevenlabs_model_id},
    )
    try:
        async with asyncio.timeout_at(deadline):
            upstream = await client.send(request, stream=True)
    except (httpx.HTTPError, TimeoutError) as exc:
        await client.aclose()
        log.warning("ElevenLabs TTS request failed: %s", type(exc).__name__)
        return _unavailable("Speech service unreachable", "speech_synthesis")
    except BaseException:
        # Cancellation must propagate after releasing the connection/client.
        await client.aclose()
        raise
    media_type = upstream.headers.get("content-type", "").split(";", 1)[0].strip().lower()
    if upstream.status_code != 200 or media_type not in ("audio/mpeg", "audio/mp3", "application/octet-stream"):
        await _close_audio(upstream, client)
        log.warning("ElevenLabs TTS returned HTTP %s", upstream.status_code)
        return _unavailable("Speech service error", "speech_synthesis")

    async def audio() -> AsyncIterator[bytes]:
        # Stream to the browser as chunks arrive; keep a copy to cache once the clip completes.
        clip = bytearray()
        complete = False
        cacheable = True
        try:
            async with asyncio.timeout_at(deadline):
                async for chunk in upstream.aiter_bytes():
                    if cacheable and len(clip) + len(chunk) <= MAX_CACHED_CLIP_BYTES:
                        clip.extend(chunk)
                    else:
                        cacheable = False
                        clip.clear()
                    yield chunk
                complete = True
        except (httpx.HTTPError, TimeoutError) as exc:
            log.warning("ElevenLabs audio stream interrupted: %s", type(exc).__name__)
        finally:
            await _close_audio(upstream, client)
            if complete and cacheable and clip:
                tts_cache.put(key, bytes(clip))

    return StreamingResponse(audio(), media_type="audio/mpeg", headers={**_AUDIO_HEADERS, "X-TTS-Cache": "miss"})
