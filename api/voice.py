"""ElevenLabs proxies, so the API key never reaches the browser.

Phase 1: no live calls yet; both endpoints tell the frontend which browser fallback to use.
"""

from __future__ import annotations

from fastapi import APIRouter
from fastapi.responses import JSONResponse

from api.config import get_settings
from api.schemas import TTSRequest

router = APIRouter()


@router.get("/stt/token")
async def stt_token() -> JSONResponse:
    if not get_settings().elevenlabs_api_key:
        return JSONResponse({"error": "ElevenLabs not configured", "fallback": "web_speech"}, status_code=503)
    return JSONResponse({"error": "Not implemented yet", "fallback": "web_speech"}, status_code=503)


@router.post("/tts")
async def tts(req: TTSRequest) -> JSONResponse:
    if not get_settings().elevenlabs_api_key:
        return JSONResponse({"error": "ElevenLabs not configured", "fallback": "speech_synthesis"}, status_code=503)
    return JSONResponse({"error": "Not implemented yet", "fallback": "speech_synthesis"}, status_code=503)
