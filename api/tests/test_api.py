from __future__ import annotations

import base64

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.utils import decode_dss_signature

from api.guard import grounding
from api.guard.mandates import jwk_from_public_key, sign_raw, verify_signature
from api.store import store
from api.tests.conftest import read_sse, register_mandate

HERO = "fragrance-free moisturizer for dry, sensitive skin, under $40"


def test_health(client) -> None:
    body = client.get("/health").json()
    assert body["ok"] and body["products"] == 20


def test_hero_query_without_llm(client, session_id) -> None:
    events = read_sse(client.post("/chat", json={"session_id": session_id, "text": HERO}))
    names = [e for e, _ in events]
    assert names[-1] == "done" and "say" in names
    results = [d for e, d in events if e == "action" and d["action"] == "show_results"]
    assert len(results) == 1 and len(results[0]["product_ids"]) == 6
    for pid in results[0]["product_ids"]:
        p = store.products[pid]
        assert p.attributes["fragrance_free"] is True and p.price < 40
    done = events[-1][1]
    assert done == {"grounded": True, "source": "fallback"}
    first_say = next(d["text"] for e, d in events if e == "say")
    assert "AI" in first_say


def test_actions_stream_before_speech(client, session_id) -> None:
    names = [e for e, _ in read_sse(client.post("/chat", json={"session_id": session_id, "text": HERO}))]
    assert names.index("action") < names.index("say") < names.index("done")


def test_search_endpoint(client) -> None:
    res = client.get("/products/search", params={"q": HERO}).json()
    assert len(res) == 6 and all("fit_percent" in r and len(r["reasons"]) <= 2 for r in res)
    assert set(res[0]["fit_terms"]) == {"semantic", "attribute_match", "trust", "feedback"}


def test_unknown_session_is_404(client) -> None:
    assert client.get("/profile/not-a-session").status_code == 404
    assert client.post("/chat", json={"session_id": "nope", "text": "hi"}).status_code == 404


def test_wipe(client, session_id) -> None:
    client.post("/chat", json={"session_id": session_id, "text": HERO})
    out = client.delete(f"/profile/{session_id}").json()
    assert out["wiped"] and out["deleted"]["profile"]["budget_max"] == 40
    assert client.get(f"/profile/{session_id}").json()["budget_max"] is None
    audit = client.get(f"/audit/{session_id}").json()
    assert audit["valid"] and audit["entries"][-1]["kind"] == "wiped"


# --- signatures & checkout ---------------------------------------------------


def test_webcrypto_raw_signature_verifies(key) -> None:
    msg = '{"a":1}'
    der = key.sign(msg.encode(), ec.ECDSA(hashes.SHA256()))
    r, s = decode_dss_signature(der)
    raw_b64 = base64.b64encode(r.to_bytes(32, "big") + s.to_bytes(32, "big")).decode()
    jwk = jwk_from_public_key(key.public_key())
    assert verify_signature(jwk, msg, raw_b64)
    assert not verify_signature(jwk, '{"a":2}', raw_b64)


def _stage(client, session_id: str, product_id: str = "p01") -> dict:
    return client.post("/checkout/stage", json={"session_id": session_id, "product_id": product_id, "quantity": 1}).json()


def test_checkout_happy_path(client, session_id, key) -> None:
    assert register_mandate(client, session_id, key).status_code == 200
    staged = _stage(client, session_id)
    assert staged["action"] == "stage_checkout" and staged["policy"]["allowed"]
    sig = sign_raw(key, staged["cart_payload"])
    res = client.post("/checkout/intent", json={"session_id": session_id, "cart_hash": staged["cart"]["cart_hash"], "signature": sig})
    assert res.status_code == 200 and res.json()["amount"] == 2800


def test_checkout_rejects_unsigned(client, session_id, key) -> None:
    register_mandate(client, session_id, key)
    staged = _stage(client, session_id)
    res = client.post("/checkout/intent", json={"session_id": session_id, "cart_hash": staged["cart"]["cart_hash"]})
    assert res.status_code == 401


def test_checkout_rejects_one_byte_change(client, session_id, key) -> None:
    register_mandate(client, session_id, key)
    staged = _stage(client, session_id)
    payload = staged["cart_payload"]
    tampered = payload.replace('"quantity":1', '"quantity":2')
    assert tampered != payload
    for bad in (tampered, payload[:-2] + ("0" if payload[-2] != "0" else "1") + payload[-1]):
        res = client.post("/checkout/intent", json={
            "session_id": session_id, "cart_hash": staged["cart"]["cart_hash"], "signature": sign_raw(key, bad)})
        assert res.status_code == 401


def test_checkout_rejects_other_key(client, session_id, key) -> None:
    register_mandate(client, session_id, key)
    staged = _stage(client, session_id)
    other = ec.generate_private_key(ec.SECP256R1())
    res = client.post("/checkout/intent", json={
        "session_id": session_id, "cart_hash": staged["cart"]["cart_hash"], "signature": sign_raw(other, staged["cart_payload"])})
    assert res.status_code == 401


def test_checkout_rejects_unknown_hash(client, session_id, key) -> None:
    register_mandate(client, session_id, key)
    res = client.post("/checkout/intent", json={"session_id": session_id, "cart_hash": "0" * 64, "signature": "AA=="})
    assert res.status_code == 409


def test_unverified_merchant_refused(client, session_id) -> None:
    staged = _stage(client, session_id, "p05")
    assert staged["action"] == "policy_refusal"
    failed = [c["rule"] for c in staged["policy"]["checks"] if not c["passed"]]
    assert failed == ["merchant_verified"]


def test_grounding_catches_invented_number() -> None:
    facts = [{"price": 28.0, "trust_score": 92, "share": 0.35}]
    assert grounding.is_grounded("It's $28 with a Trust Score of 92; 35% arrived in one week.", facts)
    assert grounding.ungrounded("It's $25 with a Trust Score of 92.", facts) == [25.0]
