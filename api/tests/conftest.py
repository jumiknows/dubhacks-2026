from __future__ import annotations

import json
from collections.abc import Iterator
from datetime import datetime, timezone

import pytest
from cryptography.hazmat.primitives.asymmetric import ec
from fastapi.testclient import TestClient

from api.config import get_settings
from api.guard.mandates import jwk_from_public_key, sign_raw
from api.main import app

# Tests never use real keys from a developer's api/.env: no network calls, no credits spent,
# same results on every machine. Tests that need a key set one themselves.
_settings = get_settings()
_settings.llm_api_key = _settings.elevenlabs_api_key = _settings.stripe_secret_key = ""


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
