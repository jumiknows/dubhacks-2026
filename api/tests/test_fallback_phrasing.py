"""The rule-based agent must understand everyday phrasings: it carries the demo if the Wi-Fi dies.

Each case runs after the hero search, with the hero results on screen.
"""

from __future__ import annotations

import pytest

from api.tests.conftest import read_sse

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
