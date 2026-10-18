"""Voice proxies use private fixtures and explicit MockTransport; no paid requests."""

from __future__ import annotations

import asyncio
import json
from types import SimpleNamespace

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api import voice
from api.schemas import TTSRequest
from api.sessions import BytesLRU


class TrackedTransport(httpx.MockTransport):
    def __init__(self, handler):
        super().__init__(handler)
        self.closed = 0

    async def aclose(self):
        self.closed += 1
        await super().aclose()


class TrackedStream(httpx.AsyncByteStream):
    def __init__(self, chunks, *, error=None, delay=0):
        self.chunks = chunks
        self.error = error
        self.delay = delay
        self.closed = False
        self.started = False

    async def __aiter__(self):
        self.started = True
        for chunk in self.chunks:
            if self.delay:
                await asyncio.sleep(self.delay)
            yield chunk
        if self.error is not None:
            raise self.error

    async def aclose(self):
        self.closed = True


@pytest.fixture
def context(monkeypatch):
    settings = SimpleNamespace(
        voice_enabled=True, elevenlabs_api_key="voice-fixture-key", elevenlabs_voice_id="fixture-voice",
        elevenlabs_model_id="fixture-model", elevenlabs_timeout_s=1.0,
    )
    cache = BytesLRU()
    monkeypatch.setattr(voice, "get_settings", lambda: settings)
    monkeypatch.setattr(voice, "tts_cache", cache)
    app = FastAPI()
    app.include_router(voice.router)
    with TestClient(app) as client:
        yield SimpleNamespace(client=client, settings=settings, cache=cache, patch=monkeypatch)


def _set_transport(context, handler):
    transport = TrackedTransport(handler)
    context.patch.setattr(voice, "transport", transport)
    return transport


def test_no_key_returns_browser_fallbacks_without_constructing_upstream_client(context):
    context.settings.voice_enabled = False
    context.settings.elevenlabs_api_key = ""

    def unexpected_client(*args):
        raise AssertionError("No-key requests must not create an upstream client")

    context.patch.setattr(voice, "_client", unexpected_client)
    stt = context.client.get("/stt/token")
    tts = context.client.post("/tts", json={"text": "Private fixture speech"})

    assert stt.status_code == tts.status_code == 503
    assert stt.json()["fallback"] == "web_speech"
    assert tts.json()["fallback"] == "speech_synthesis"
    assert stt.headers["cache-control"] == tts.headers["cache-control"] == "no-store"


def test_valid_stt_token_is_not_cached_or_logged(context, caplog):
    token = "fixture-single-use-token"

    def handler(request):
        assert request.url.path == "/v1/single-use-token/realtime_scribe"
        assert request.headers["xi-api-key"] == context.settings.elevenlabs_api_key
        return httpx.Response(200, json={"token": token})

    transport = _set_transport(context, handler)
    response = context.client.get("/stt/token")

    assert response.status_code == 200
    assert response.json() == {"token": token, "expires_in_s": voice.STT_TOKEN_TTL_S}
    assert response.headers["cache-control"] == "no-store"
    assert transport.closed == 1
    assert token not in caplog.text and context.settings.elevenlabs_api_key not in caplog.text


@pytest.mark.parametrize("body", [
    b"not-json", b"null", b"[]", b"{}", b'{"token": false}', b'{"token": "   "}',
    json.dumps({"token": "x" * 4097}).encode(),
])
def test_malformed_stt_success_uses_browser_fallback_and_closes_client(context, body):
    transport = _set_transport(context, lambda request: httpx.Response(200, content=body))

    response = context.client.get("/stt/token")

    assert response.status_code == 503
    assert response.json()["fallback"] == "web_speech"
    assert "token" not in response.json()
    assert transport.closed == 1


@pytest.mark.parametrize("path", ["/stt/token", "/tts"])
@pytest.mark.parametrize("status", [401, 429, 503])
def test_upstream_errors_return_fallback_without_upstream_details(context, path, status, caplog):
    detail = "private-fixture-provider-detail"
    transport = _set_transport(context, lambda request: httpx.Response(status, json={"detail": detail}))

    response = (context.client.get(path) if path == "/stt/token"
                else context.client.post(path, json={"text": "Private fixture speech"}))

    assert response.status_code == 503
    assert response.json()["fallback"] == ("web_speech" if path == "/stt/token" else "speech_synthesis")
    assert detail not in response.text and detail not in caplog.text
    assert transport.closed == 1


@pytest.mark.parametrize("path", ["/stt/token", "/tts"])
def test_network_timeout_is_mocked_and_does_not_log_key_or_speech(context, path, caplog):
    speech = "Private fixture speech, never log this"
    key = context.settings.elevenlabs_api_key

    def handler(request):
        raise httpx.ReadTimeout(key + speech, request=request)

    transport = _set_transport(context, handler)
    response = (context.client.get(path) if path == "/stt/token"
                else context.client.post(path, json={"text": speech}))

    assert response.status_code == 503
    assert key not in response.text + caplog.text
    assert speech not in response.text + caplog.text
    assert transport.closed == 1


def test_complete_audio_is_cached_and_closes_response_and_client(context, caplog):
    calls = []
    streams = []
    speech = "Private fixture speech for caching"

    def handler(request):
        calls.append(request)
        assert request.headers["xi-api-key"] == context.settings.elevenlabs_api_key
        assert json.loads(request.content)["text"] == speech
        stream = TrackedStream([b"ID3", b"fixture-audio"])
        streams.append(stream)
        return httpx.Response(200, headers={"content-type": "audio/mpeg"}, stream=stream)

    transport = _set_transport(context, handler)
    first = context.client.post("/tts", json={"text": speech})
    second = context.client.post("/tts", json={"text": speech})

    assert first.content == second.content == b"ID3fixture-audio"
    assert first.headers["x-tts-cache"] == "miss" and second.headers["x-tts-cache"] == "hit"
    assert first.headers["cache-control"] == second.headers["cache-control"] == "no-store"
    assert first.headers["content-type"] == "audio/mpeg"
    assert len(calls) == 1 and transport.closed == 1
    assert streams[0].closed and context.cache.stats()["items"] == 1
    assert speech not in caplog.text and context.settings.elevenlabs_api_key not in caplog.text


@pytest.mark.parametrize("content_type", ["application/json", "text/html", ""])
def test_non_audio_success_is_rejected_without_consuming_body(context, content_type):
    stream = TrackedStream([b"not-audio"])
    transport = _set_transport(context, lambda request: httpx.Response(
        200, headers={"content-type": content_type}, stream=stream,
    ))

    response = context.client.post("/tts", json={"text": "Fixture speech"})

    assert response.status_code == 503 and response.json()["fallback"] == "speech_synthesis"
    assert stream.closed and not stream.started and transport.closed == 1
    assert context.cache.stats()["items"] == 0


def test_oversized_complete_audio_stream_is_delivered_but_never_retained(context):
    context.patch.setattr(voice, "MAX_CACHED_CLIP_BYTES", 4)
    streams = []

    def handler(request):
        stream = TrackedStream([b"ID3", b"large", b"clip"])
        streams.append(stream)
        return httpx.Response(200, headers={"content-type": "audio/mpeg"}, stream=stream)

    transport = _set_transport(context, handler)
    first = context.client.post("/tts", json={"text": "Fixture speech"})
    second = context.client.post("/tts", json={"text": "Fixture speech"})

    assert first.content == second.content == b"ID3largeclip"
    assert first.headers["x-tts-cache"] == second.headers["x-tts-cache"] == "miss"
    assert len(streams) == 2 and all(stream.closed for stream in streams)
    assert transport.closed == 2
    assert context.cache.stats()["items"] == context.cache.stats()["bytes"] == 0


def test_interrupted_audio_is_closed_and_not_cached(context, caplog):
    stream = TrackedStream([b"ID3partial"], error=httpx.ReadError("private-fixture-error-detail"))
    transport = _set_transport(context, lambda request: httpx.Response(
        200, headers={"content-type": "audio/mpeg"}, stream=stream,
    ))

    response = context.client.post("/tts", json={"text": "Fixture speech"})

    # Audio headers have already been sent; the partial stream must not enter the cache.
    assert response.status_code == 200 and response.content == b"ID3partial"
    assert stream.closed and transport.closed == 1
    assert context.cache.stats()["items"] == 0
    assert "private-fixture-error-detail" not in caplog.text


def test_header_and_stream_delays_share_one_total_timeout(context):
    context.settings.elevenlabs_timeout_s = 0.06
    stream = TrackedStream([b"ID3complete"], delay=0.04)

    async def handler(request):
        await asyncio.sleep(0.04)
        return httpx.Response(200, headers={"content-type": "audio/mpeg"}, stream=stream)

    transport = _set_transport(context, handler)
    response = context.client.post("/tts", json={"text": "Fixture speech"})

    # A separate full timeout per phase would accept/cache this complete clip.
    assert response.status_code in (200, 503)
    assert response.content != b"ID3complete"
    assert transport.closed == 1 and context.cache.stats()["items"] == 0
    if stream.started:
        assert stream.closed


def test_cancellation_while_opening_audio_closes_client_and_propagates(context):
    async def handler(request):
        raise asyncio.CancelledError

    transport = _set_transport(context, handler)

    with pytest.raises(asyncio.CancelledError):
        asyncio.run(voice.tts(TTSRequest(text="Fixture speech")))

    assert transport.closed == 1
    assert context.cache.stats()["items"] == 0
