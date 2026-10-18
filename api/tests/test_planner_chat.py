"""Typed planner assistant: rule path (no LLM key in tests) against a fake planner service."""

from __future__ import annotations

import copy
from typing import Any

import httpx
import pytest

from api import live_tools
from api.live_tools import LiveContext, find_item, find_product, openai_tools, ui_event, valued
from api.tests.test_agent import fake_llm, text_msg, tool_msg  # noqa: F401  (fixture re-export)

PLAN: dict[str, Any] = {
    "id": "plan-1",
    "title": "Camping kit",
    "prompt": "camping",
    "category": "camping",
    "quote": {"totalPrice": 268.0},
    "items": [
        {
            "id": "tent", "name": "2-person tent", "quantity": 1, "purchased": False,
            "products": [
                {"id": "rei-tent", "store": "REI", "title": "Half Dome 2", "price": 189.0, "currency": "USD",
                 "score": 0.71, "bang_per_buck": None, "trust": 0.9, "inStock": True},
                {"id": "target-tent", "store": "Target", "title": "Coleman Sundome", "price": 79.0, "currency": "USD",
                 "score": 0.64, "trust": 0.6, "inStock": True},
            ],
            "synthesis": {"totalPrice": 189.0, "currency": "USD", "best": {"id": "rei-tent", "store": "REI",
                                                                           "title": "Half Dome 2", "price": 189.0}},
        },
        {
            "id": "stove", "name": "Camp stove", "quantity": 1, "purchased": False,
            "products": [{"id": "msr", "store": "REI", "title": "PocketRocket", "price": 45.0, "currency": "USD"}],
            "synthesis": {"totalPrice": 45.0, "currency": "USD", "best": {"id": "msr", "store": "REI"}},
        },
        {"id": "lamp", "name": "Headlamp", "quantity": 2, "purchased": False, "products": [], "synthesis": None},
    ],
}


class FakePlanner:
    def __init__(self) -> None:
        self.plan = copy.deepcopy(PLAN)
        self.calls: list[tuple[str, str, Any]] = []

    async def __call__(self, ctx: LiveContext, method: str, path: str, payload: Any = None) -> dict[str, Any]:
        self.calls.append((method, path, payload))
        if method == "POST" and path == "/api/plans":
            return {**self.plan, "prompt": payload["prompt"]}
        if method == "GET" and path == f"/api/plans/{self.plan['id']}":
            return self.plan
        if method == "POST" and path == "/api/compare":
            assert payload["left"]["bang_per_buck"] == 0.5  # None became a neutral default
            assert payload["left"]["in_stock"] is True
            return {"pick": "right", "split_decision": False, "reasons": ["cheaper"], "axes": [],
                    "left": {"score": 0.4}, "right": {"score": 0.6}, "trust_floor": payload["trust_floor"]}
        if method == "PUT" and path.endswith("/listing"):
            item = next(i for i in self.plan["items"] if path.endswith(f"/{i['id']}/listing"))
            chosen = next(p for p in item["products"] if p["id"] == payload["listingId"])
            item["synthesis"] = {**item["synthesis"], "best": chosen, "totalPrice": chosen["price"] * item["quantity"]}
            return self.plan
        if method == "PATCH":
            item = next(i for i in self.plan["items"] if path.endswith(f"/{i['id']}"))
            item["purchased"] = payload["purchased"]
            return self.plan
        return {"error": "unexpected call"}


@pytest.fixture
def planner(monkeypatch: pytest.MonkeyPatch) -> FakePlanner:
    fake = FakePlanner()

    async def http(self: LiveContext, method: str, path: str, payload: Any = None) -> dict[str, Any]:
        return await fake(self, method, path, payload)

    monkeypatch.setattr(LiveContext, "_http", http)
    return fake


def chat(client, text: str, **extra: Any) -> dict[str, Any]:
    r = client.post("/planner/chat", json={"text": text, **extra})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["source"] == "rules"
    return body


def actions(body: dict[str, Any]) -> list[str]:
    return [e["action"] for e in body["events"]]


def test_first_message_builds_a_plan(client, planner) -> None:
    body = chat(client, "camping")
    assert actions(body) == ["PLAN"]
    assert body["events"][0]["payload"]["id"] == "plan-1"
    assert "Camping kit" in body["reply"]


def test_naming_a_trip_starts_a_new_list_but_questions_about_it_do_not(client, planner) -> None:
    for text in ("I'm flying to Lisbon next month", "planning a beach vacation", "trip to Tokyo in March",
                 "Beach weekend in Cancún", "a week in Tokyo"):
        assert actions(chat(client, text, plan_id="plan-1")) == ["PLAN"], text
        assert planner.calls[-1][:2] == ("POST", "/api/plans")
    calls = len(planner.calls)
    body = chat(client, "what's left to buy for my trip?", plan_id="plan-1")
    assert actions(body) == ["PLAN"] and not any(c[:2] == ("POST", "/api/plans") for c in planner.calls[calls:])
    body = chat(client, "I'm going to buy the REI one", plan_id="plan-1", focus_item_id="tent")
    assert not any(c[:2] == ("POST", "/api/plans") for c in planner.calls[calls:])
    body = chat(client, "what do I still need?", plan_id="plan-1", focus_item_id="tent")
    assert actions(body) == ["PLAN"] and not any(c[0] == "PATCH" for c in planner.calls[calls:])


def test_small_talk_does_not_create_a_plan(client, planner) -> None:
    body = chat(client, "thanks", plan_id="plan-1")
    assert body["events"] == []
    assert not any(c[0] == "POST" for c in planner.calls)


def test_compare_defaults_to_the_two_best_listings(client, planner) -> None:
    body = chat(client, "compare the tents", plan_id="plan-1", trust_floor=0.3)
    assert actions(body) == ["COMPARE"]
    compare = body["events"][0]["payload"]
    assert compare["left"]["id"] == "rei-tent" and compare["right"]["id"] == "target-tent"
    assert compare["trust_floor"] == 0.3
    assert "Coleman Sundome from Target wins" in body["reply"]


def test_use_the_winner_picks_and_adds_to_cart(client, planner) -> None:
    last = {"item_id": "tent", "left_id": "rei-tent", "right_id": "target-tent", "winner_id": "target-tent"}
    body = chat(client, "use the winner and add it to my cart", plan_id="plan-1", compare=last)
    assert actions(body) == ["PLAN", "CART"]
    put = next(c for c in planner.calls if c[0] == "PUT")
    assert put[2] == {"listingId": "target-tent"}


def test_use_the_winner_after_a_tie_asks_for_a_store(client, planner) -> None:
    tie = {"item_id": "tent", "left_id": "rei-tent", "right_id": "target-tent", "winner_id": None}
    body = chat(client, "use the winner", plan_id="plan-1", compare=tie)
    assert body["events"] == []
    assert "too close to call" in body["reply"] and "REI" in body["reply"]
    assert not any(c[0] == "PUT" for c in planner.calls)


def test_store_name_picks_that_listing(client, planner) -> None:
    body = chat(client, "go with the REI one", plan_id="plan-1", focus_item_id="tent")
    assert actions(body) == ["PLAN"]
    assert next(c for c in planner.calls if c[0] == "PUT")[2] == {"listingId": "rei-tent"}


def test_cart_needs_a_price_and_checkout_only_opens_review(client, planner) -> None:
    body = chat(client, "add the headlamp to my cart", plan_id="plan-1")
    assert actions(body) == []
    assert "no priced listing" in body["reply"]
    body = chat(client, "check out", plan_id="plan-1")
    assert actions(body) == ["CHECKOUT"]
    assert "place it yourself" in body["reply"]
    assert not any(c[0] == "POST" and "checkout" in c[1] for c in planner.calls)


def test_bought_trust_and_open(client, planner) -> None:
    assert actions(chat(client, "I already have a stove", plan_id="plan-1")) == ["PLAN"]
    assert planner.plan["items"][1]["purchased"] is True
    body = chat(client, "set the trust floor to 80%", plan_id="plan-1")
    assert body["events"][0]["payload"] == {"trust_floor": 0.8}
    body = chat(client, "show me the tent", plan_id="plan-1")
    assert actions(body) == ["FOCUS"] and body["events"][0]["item_id"] == "tent"


def test_llm_path_runs_tools_and_streams_ui_events(client, planner, fake_llm) -> None:
    fake_llm.script = [
        tool_msg(("compare_listings", {"item_id": "tent"})),
        text_msg("The Coleman from Target is the better value."),
    ]
    r = client.post("/planner/chat", json={"text": "which tent should I get?", "plan_id": "plan-1"})
    body = r.json()
    assert body["source"] == "llm" and actions(body) == ["COMPARE"]
    assert "Coleman Sundome from Target wins at $79.00" in body["reply"]
    sent = fake_llm.requests[0]
    assert {t["function"]["name"] for t in sent["tools"]} >= {"pick_listing", "start_checkout"}
    assert "Screen state" in sent["messages"][1]["content"]


def test_llm_failure_after_tools_does_not_rerun_them(client, planner, fake_llm) -> None:
    fake_llm.script = [tool_msg(("create_plan", {"prompt": "camping"})), httpx.ReadTimeout("slow")]
    body = client.post("/planner/chat", json={"text": "camping"}).json()
    assert body["source"] == "llm" and actions(body) == ["PLAN"]
    assert sum(1 for c in planner.calls if c[:2] == ("POST", "/api/plans")) == 1


def test_llm_failure_before_tools_falls_back_to_rules(client, planner, fake_llm) -> None:
    fake_llm.script = [httpx.ReadTimeout("slow")]
    body = client.post("/planner/chat", json={"text": "compare the tents", "plan_id": "plan-1"}).json()
    assert body["source"] == "rules" and actions(body) == ["COMPARE"]


def test_request_limits(client) -> None:
    assert client.post("/planner/chat", json={"text": ""}).status_code == 422
    assert client.post("/planner/chat", json={"text": "x", "trust_floor": 2}).status_code == 422


def test_tie_reply_names_the_tradeoff() -> None:
    from api.planner_chat import _tie

    text = _tie({"store": "Amazon", "price": 57.59, "currency": "USD", "trust": 0.91}, {"store": "Walmart", "price": 35.28, "currency": "USD", "trust": 0.81})
    assert "Walmart is $22.31 cheaper" in text and "Amazon has a higher trust score" in text


def test_lookup_helpers() -> None:
    assert find_item(PLAN, "tents")["id"] == "tent"
    assert find_item(PLAN, "Camp stove")["id"] == "stove"
    assert find_item(PLAN, "spaceship") is None
    tent = PLAN["items"][0]
    assert find_product(tent, "target")["id"] == "target-tent"
    assert find_product(tent, "half dome")["id"] == "rei-tent"
    assert find_product(tent, "someone else's listing") is None


def test_valued_never_sends_nulls_compare_rejects() -> None:
    v = valued({"id": "x", "price": None, "bang_per_buck": None, "trust": None, "in_stock": None,
                "condition": None, "specs": {"Weight": 3, "Color": None}})
    assert v["bang_per_buck"] == 0.5 and v["trust"] == 0.5 and v["in_stock"] is False
    assert v["condition"] == "new" and v["specs"] == {"Weight": "3"}


def test_tool_schemas_and_ui_events() -> None:
    tools = openai_tools()
    names = {t["function"]["name"] for t in tools}
    assert {"create_plan", "compare_listings", "pick_listing", "add_to_cart", "start_checkout"} <= names
    assert tools[0]["function"]["parameters"]["type"] == "object"
    assert ui_event({"ui": "CHECKOUT"}) == {"type": "UI_UPDATE", "action": "CHECKOUT", "payload": {}}
    assert ui_event({"error": "nope"}) is None
    assert all("pay" not in d["name"] for d in live_tools.FUNCTION_DECLARATIONS)


def test_model_prose_cannot_invent_product_facts(client, planner, fake_llm) -> None:
    fake_llm.script = [tool_msg(("get_plan", {})), text_msg("The tent is waterproof, costs $1, and payment succeeded.")]
    body = client.post("/planner/chat", json={"text": "what is on my list?", "plan_id": "plan-1"}).json()
    assert body["source"] == "llm"
    assert "Camping kit" in body["reply"]
    assert "waterproof" not in body["reply"] and "payment succeeded" not in body["reply"]


def test_typed_planner_forwards_only_session_cookie(client, monkeypatch) -> None:
    seen = []
    async def http(self, method, path, payload=None):
        seen.append(self.session_cookie)
        return {"id": "p", "items": []}
    monkeypatch.setattr(LiveContext, "_http", http)
    client.cookies.set("pb_sid", "browser-token")
    client.cookies.set("unrelated", "secret")
    assert client.post("/planner/chat", json={"text": "camping"}).status_code == 200
    assert seen == ["browser-token"]


def test_timed_out_tool_is_not_retried(monkeypatch) -> None:
    import asyncio
    from api.agent.llm import Completion, ToolCall
    from api.config import get_settings
    from api.planner_chat import PlannerChatRequest, _llm_turn
    calls = []
    class Model:
        async def complete(self, *args):
            return Completion(content="", tool_calls=[ToolCall(id="c", name="create_plan", arguments='{"prompt":"camping"}')], raw_message={})
    ctx = LiveContext()
    async def slow(name, args):
        calls.append(name)
        await asyncio.sleep(1)
        return {"id": "p"}
    monkeypatch.setattr(ctx, "execute", slow)
    monkeypatch.setattr(get_settings(), "llm_turn_budget_s", 0.01)
    result = asyncio.run(_llm_turn(Model(), ctx, PlannerChatRequest(text="camping")))
    assert calls == ["create_plan"]
    assert "timed out" in result["reply"] and result["events"] == []


def test_unknown_and_mixed_currencies_are_not_presented_as_usd() -> None:
    from api.planner_chat import _summary, _tie
    text = _summary([("pick_listing", {"picked": {"title": "Tent", "store": "Store", "price": 79}})])
    assert "currency unknown" in text and "$" not in text
    text = _tie({"store": "A", "price": 20, "currency": "CAD"}, {"store": "B", "price": 15, "currency": "USD"})
    assert "cheaper" not in text and "20.00 CAD" in text
