from __future__ import annotations

import json
from collections.abc import Iterator
from datetime import datetime, timezone

import pytest
import httpx
from cryptography.hazmat.primitives.asymmetric import ec
from fastapi.testclient import TestClient

from api.guard.mandates import jwk_from_public_key, sign_raw
from api.main import app


@pytest.fixture(scope="session", autouse=True)
def offline_integrations():
    """Tests never use real API keys, spend API credits, or download embedding models.

    MockTransport and TestClient still work; the default network transports fail closed.
    Environment overrides keep api/.env credentials out of test settings.
    """
    from api import search
    from api.config import get_settings
    from api.textvec import hashed_matrix

    def no_network(*args, **kwargs):
        raise AssertionError("Tests must use an explicit mock transport")

    async def no_async_network(*args, **kwargs):
        raise AssertionError("Tests must use an explicit mock transport")

    with pytest.MonkeyPatch.context() as patch:
        for name in ("LLM_API_KEY", "ELEVENLABS_API_KEY", "STRIPE_SECRET_KEY", "WEBSITE_WEBRISK_API_KEY", "WEBSITE_PHISHTANK_API_KEY"):
            patch.setenv(name, "")
        patch.setenv("DEMO_SERVER_SIGNING", "false")
        patch.setenv("WEBSITE_PHISHTANK_ENABLED", "false")
        patch.setenv("WEBSITE_MERCHANTS", "{}")
        patch.setenv("WEBSITE_BLOCKED_HOSTS", "[]")
        get_settings.cache_clear()
        patch.setattr(search, "_make_embedder", lambda: ("hashed-ngrams", hashed_matrix))
        patch.setattr(httpx.HTTPTransport, "handle_request", no_network)
        patch.setattr(httpx.AsyncHTTPTransport, "handle_async_request", no_async_network)
        try:
            yield
        finally:
            get_settings.cache_clear()


@pytest.fixture(scope="session")
def client() -> Iterator[TestClient]:
    with TestClient(app) as c:
        yield c


@pytest.fixture
def session_id(client: TestClient) -> str:
    return client.post("/session").json()["session_id"]


@pytest.fixture
def key() -> ec.EllipticCurvePrivateKey:
    return ec.generate_private_key(ec.SECP256R1())


def intent_payload(session_id: str, **overrides: object) -> str:
    body = {
        "session_id": session_id, "budget_max": 40, "categories": ["moisturizer"], "verified_only": True,
        "max_quantity": 2, "autonomy": "stage", "issued_at": datetime.now(timezone.utc).isoformat(),
        "nonce": "n-" + session_id,
    }
    body.update(overrides)
    return json.dumps(body)


def register_mandate(client: TestClient, session_id: str, key: ec.EllipticCurvePrivateKey, **overrides: object):
    payload = intent_payload(session_id, **overrides)
    return client.post("/mandate/intent", json={
        "session_id": session_id, "public_key_jwk": jwk_from_public_key(key.public_key()),
        "payload": payload, "signature": sign_raw(key, payload),
    })


def read_sse(resp) -> list[tuple[str, dict]]:
    events, name = [], None
    for line in resp.text.splitlines():
        if line.startswith("event: "):
            name = line[7:]
        elif line.startswith("data: "):
            events.append((name, json.loads(line[6:])))
    return events
