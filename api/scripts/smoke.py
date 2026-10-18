"""End-to-end smoke test of the demo path against a running server.

Run the server first, then from the repo root:
    api/.venv/bin/python -m api.scripts.smoke            # quiet: PASS/FAIL per step
    api/.venv/bin/python -m api.scripts.smoke --verbose  # also print what the assistant said

Signs mandates and carts the same way the browser will (ECDSA P-256, raw r||s).
"""

from __future__ import annotations

import argparse
import json
import sys
import uuid
from datetime import datetime, timezone

import httpx
from cryptography.hazmat.primitives.asymmetric import ec

from api.guard.mandates import jwk_from_public_key, sign_raw

HERO = "fragrance-free moisturizer for dry, sensitive skin, under $40"
failures: list[str] = []
verbose = False


def check(name: str, ok: bool, detail: str = "") -> None:
    print(f"  {'PASS' if ok else 'FAIL'}  {name}" + (f"  ({detail})" if detail and not ok else ""))
    if not ok:
        failures.append(name)


def chat(c: httpx.Client, sid: str, text: str, **ctx: object) -> tuple[list[dict], list[str], dict]:
    actions, says, done = [], [], {}
    with c.stream("POST", "/chat", json={"session_id": sid, "text": text, "ui_context": ctx}) as r:
        event = None
        for line in r.iter_lines():
            if line.startswith("event: "):
                event = line[7:]
            elif line.startswith("data: "):
                data = json.loads(line[6:])
                if event == "action":
                    actions.append(data)
                elif event == "say":
                    says.append(data["text"])
                elif event == "done":
                    done = data
    if verbose:
        print(f"    you: {text}\n    ai:  {' '.join(says)}")
    return actions, says, done


def kinds(actions: list[dict]) -> list[str]:
    return [a["action"] for a in actions]


def main() -> int:
    global verbose
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default="http://localhost:8000")
    ap.add_argument("--verbose", action="store_true")
    args = ap.parse_args()
    verbose = args.verbose
    c = httpx.Client(base_url=args.url, timeout=10)

    print("1. Health")
    try:
        h = c.get("/health").json()
    except httpx.ConnectError:
        print(f"  Can't reach {args.url}. Start the server: api/.venv/bin/uvicorn api.main:app")
        return 1
    check("server up with 20 products", h.get("products") == 20, str(h))
    print(f"     integrations: {h['integrations']}")
    sid = c.post("/session").json()["session_id"]

    print("2. Hero query")
    actions, says, done = chat(c, sid, HERO)
    shown = next((a["product_ids"] for a in actions if a["action"] == "show_results"), [])
    check("six results", len(shown) == 6, str(shown))
    products = [c.get(f"/products/{pid}").json() for pid in shown]
    check("all fragrance-free and under $40",
          all(p["attributes"]["fragrance_free"] and p["price"] < 40 for p in products))
    check("first line says it's an AI", bool(says) and "AI" in says[0])
    check("speech grounded", done.get("grounded") is True, str(done))

    print("3. Why is this flagged? (Brightfern, p05)")
    actions, says, _ = chat(c, sid, "why is this one flagged?", visible_ids=shown, focused_id="p05")
    speech = " ".join(says)
    check("highlights trust", "highlight_trust" in kinds(actions))
    check("uses 'patterns consistent with', never 'fake'", "patterns consistent with" in speech and "fake" not in speech.lower())

    print("4. Why am I seeing this? (p01)")
    actions, says, _ = chat(c, sid, "why am I seeing this?", visible_ids=shown, focused_id="p01")
    check("explains fit", "% fit" in " ".join(says), " ".join(says))

    print("5. Compare")
    actions, _, _ = chat(c, sid, "compare these", visible_ids=shown, focused_id="p01")
    cmp = next((a for a in actions if a["action"] == "open_compare"), None)
    check("opens comparison with tradeoffs", bool(cmp and cmp["tradeoffs"]))

    print("6. Dismiss: 'this one has fragrance'")
    actions, _, _ = chat(c, sid, "this one has fragrance", visible_ids=shown, focused_id="p04")
    rerank = next((a for a in actions if a["action"] == "rerank"), None)
    check("reranks without the dismissed product", bool(rerank and "p04" not in rerank["product_ids"]))
    check("profile now avoids fragrance", "fragrance" in c.get(f"/profile/{sid}").json()["avoid"])

    print("7. Buy from an unverified seller (p05)")
    actions, says, _ = chat(c, sid, "yes, buy it", visible_ids=shown, focused_id="p05")
    check("policy refuses", kinds(actions) == ["policy_refusal"], " ".join(says))

    print("8. Signed checkout (p01)")
    key = ec.generate_private_key(ec.SECP256R1())
    payload = json.dumps({
        "session_id": sid, "budget_max": 40, "categories": ["moisturizer"], "verified_only": True,
        "max_quantity": 2, "autonomy": "stage", "issued_at": datetime.now(timezone.utc).isoformat(),
        "nonce": uuid.uuid4().hex,
    })
    r = c.post("/mandate/intent", json={"session_id": sid, "public_key_jwk": jwk_from_public_key(key.public_key()),
                                        "payload": payload, "signature": sign_raw(key, payload)})
    check("intent mandate accepted", r.status_code == 200, r.text)
    staged = c.post("/checkout/stage", json={"session_id": sid, "product_id": "p01", "quantity": 1}).json()
    check("cart staged, policy allows", staged.get("action") == "stage_checkout" and staged["policy"]["allowed"])
    h_ = staged["cart"]["cart_hash"]
    r = c.post("/checkout/intent", json={"session_id": sid, "cart_hash": h_})
    check("unsigned cart rejected", r.status_code == 401, r.text)
    tampered = staged["cart_payload"].replace('"quantity":1', '"quantity":2')
    r = c.post("/checkout/intent", json={"session_id": sid, "cart_hash": h_, "signature": sign_raw(key, tampered)})
    check("tampered cart rejected", r.status_code == 401, r.text)
    r = c.post("/checkout/intent", json={"session_id": sid, "cart_hash": h_, "signature": sign_raw(key, staged["cart_payload"])})
    check("signed cart gets a payment intent", r.status_code == 200 and r.json()["amount"] == 2800, r.text)
    r = c.post("/checkout/intent", json={"session_id": sid, "cart_hash": h_, "signature": sign_raw(key, staged["cart_payload"])})
    check("paying twice rejected", r.status_code == 409, r.text)

    print("9. Audit and privacy")
    audit = c.get(f"/audit/{sid}").json()
    check("audit chain valid", audit["valid"])
    check("wipe works", c.delete(f"/profile/{sid}").json()["wiped"])
    check("unknown session gets 404", c.get("/profile/not-a-session").status_code == 404)

    print(f"\n{'ALL PASSED' if not failures else f'{len(failures)} FAILED: ' + ', '.join(failures)}")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
