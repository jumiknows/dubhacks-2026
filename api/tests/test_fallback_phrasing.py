"""The rule-based agent must understand everyday phrasings: it carries the demo if the Wi-Fi dies.

Each case runs after the hero search, with the hero results on screen.
"""

from __future__ import annotations

import pytest

from api.tests.conftest import read_sse
from api.sessions import sessions
from api.store import store

HERO = "fragrance-free moisturizer for dry, sensitive skin, under $40"
VISIBLE = ["p01", "p04", "p03", "p06", "p05", "p02"]
HELP = "I can search, compare"

CASES = [
    # (what the user says, focused product, acceptable first actions)
    ("something for oily skin", None, {"show_results"}),
    ("I need a sunscreen", None, {"show_results"}),
    ("show me serums", None, {"show_results"}),
    ("what do you have for acne", None, {"show_results"}),
    ("cheaper option?", "p01", {"rerank"}),
    ("anything cheaper", None, {"rerank"}),
    ("is this legit?", "p05", {"highlight_trust"}),
    ("can I trust this one", "p05", {"highlight_trust"}),
    ("are these reviews real", "p05", {"highlight_trust"}),
    ("get me two of these", "p01", {"stage_checkout"}),
    ("I'll take it", "p01", {"stage_checkout"}),
    ("add to cart", "p01", {"stage_checkout"}),
    ("sure, let's do it", "p01", {"stage_checkout"}),
    ("nah", "p01", {None}),
    ("no thanks", "p01", {None}),
    ("which is better, this or that", "p01", {"open_compare"}),
    ("how do these two compare", "p01", {"open_compare"}),
    ("tell me more", "p03", {"open_detail"}),
    ("what's in this", "p03", {"open_detail"}),
    ("I hate the smell of this one", "p04", {"rerank"}),
    ("not this one", "p04", {"rerank"}),
    ("I like this", "p03", {"rerank"}),
    ("under $25 please", None, {"show_results"}),
    ("what's the best one", None, {"open_detail"}),
    ("hello", None, {None}),
    ("why is this here", "p01", {"open_detail"}),
    ("is it good for sensitive skin", "p03", {"open_detail"}),
]


@pytest.mark.parametrize(("text", "focused", "expected"), CASES, ids=[c[0] for c in CASES])
def test_phrasing(client, text: str, focused: str | None, expected: set) -> None:
    sid = client.post("/session").json()["session_id"]
    client.post("/chat", json={"session_id": sid, "text": HERO})
    if text == "get me two of these":
        # This case tests phrase recognition: two $28 products need an explicit
        # budget above the hero search's $40 ceiling. Constraint tests below
        # separately require refusal when a requested quantity exceeds budget.
        profile = client.get(f"/profile/{sid}").json()
        assert client.put(f"/profile/{sid}", json={**profile, "budget_max": 80}).status_code == 200
    events = read_sse(client.post("/chat", json={
        "session_id": sid, "text": text, "ui_context": {"visible_ids": VISIBLE, "focused_id": focused},
    }))
    actions = [d["action"] for e, d in events if e == "action" and d["action"] != "update_profile"]
    speech = " ".join(d["text"] for e, d in events if e == "say")
    assert (actions[0] if actions else None) in expected, speech
    if expected != {None} or text == "hello":
        assert HELP not in speech, "fell through to the help message"
    assert events[-1] == ("done", {"grounded": True, "source": "fallback"}), speech


def test_get_me_a_product_is_a_search_not_a_purchase(client) -> None:
    sid = client.post("/session").json()["session_id"]
    client.post("/chat", json={"session_id": sid, "text": HERO})
    events = read_sse(client.post("/chat", json={
        "session_id": sid, "text": "get me a sunscreen", "ui_context": {"visible_ids": VISIBLE, "focused_id": "p01"},
    }))
    assert "stage_checkout" not in [d["action"] for e, d in events if e == "action"]


def test_follow_up_budget_keeps_category_and_tightens(client) -> None:
    sid = client.post("/session").json()["session_id"]
    client.post("/chat", json={"session_id": sid, "text": HERO})
    events = read_sse(client.post("/chat", json={"session_id": sid, "text": "under $25 please"}))
    ids = next(d["product_ids"] for e, d in events if e == "action" and d["action"] == "show_results")
    products = [client.get(f"/products/{i}").json() for i in ids]
    assert products and all(p["subcategory"] == "moisturizer" and p["price"] <= 25 for p in products)


@pytest.mark.parametrize("text", [
    "I don't want to buy it", "Do not buy it", "Should I buy it?",
    "yes I have dry skin", "If I buy it", "buy 20 bottles",
])
def test_ambiguous_or_unsupported_purchase_never_stages(client, text) -> None:
    sid = client.post("/session").json()["session_id"]
    events = read_sse(client.post("/chat", json={
        "session_id": sid, "text": text, "ui_context": {"focused_id": "p01"},
    }))
    assert "stage_checkout" not in [data["action"] for kind, data in events if kind == "action"]


def test_no_fragrance_is_a_search_requirement_not_cancellation(client) -> None:
    sid = client.post("/session").json()["session_id"]
    events = read_sse(client.post("/chat", json={"session_id": sid, "text": "no fragrance moisturizer please"}))
    assert any(kind == "action" and data["action"] == "show_results" for kind, data in events)


@pytest.mark.parametrize("constraint", ["user_budget", "quantity_budget", "profile_budget", "user_avoid", "profile_avoid", "user_category"])
def test_fallback_purchase_respects_current_constraints(client, constraint) -> None:
    sid = client.post("/session").json()["session_id"]
    session = sessions.get(sid)
    product_id, text = "p01", "buy this"
    if constraint == "user_budget":
        text = "buy this under $10"
    elif constraint == "quantity_budget":
        text = "buy two of these under $50"
    elif constraint == "profile_budget":
        session.profile.budget_max = 10
    elif constraint == "user_category":
        text = "buy this sunscreen"
    else:
        product_id = next(p.id for p in store.products.values() if p.attributes.get("fragrance_free") is False)
        if constraint == "profile_avoid":
            session.profile.avoid = ["fragrance"]
        else:
            text = "buy this fragrance-free"
    events = read_sse(client.post("/chat", json={
        "session_id": sid, "text": text, "ui_context": {"focused_id": product_id},
    }))
    assert not any(kind == "action" and data["action"] == "stage_checkout" for kind, data in events)
    assert session.staged == {}
    assert "can't stage" in " ".join(data["text"] for kind, data in events if kind == "say")


def test_fallback_stale_focus_is_not_a_purchase_target(client) -> None:
    sid = client.post("/session").json()["session_id"]
    client.post("/chat", json={"session_id": sid, "text": "tell me more", "ui_context": {"focused_id": "p01"}})
    events = read_sse(client.post("/chat", json={
        "session_id": sid, "text": "buy this", "ui_context": {"visible_ids": ["p02", "p03"]},
    }))
    assert sessions.get(sid).staged == {}
    assert sessions.get(sid).focused_id is None
    assert not any(kind == "action" and data["action"] == "stage_checkout" for kind, data in events)
