from __future__ import annotations

import asyncio

from api.live_tools import LiveContext, _brief_plan
from api.main import app


def test_health_reports_gemini_live(client) -> None:
    body = client.get("/health").json()
    assert body["integrations"]["gemini_live"] == "not configured"


def test_ws_live_without_key_closes(client) -> None:
    with client.websocket_connect("/ws-live") as ws:
        message = ws.receive_json()
        assert message["type"] == "error"
        assert "error" in message


def test_unknown_tool() -> None:
    result = asyncio.run(LiveContext().execute("fetchProjectMetrics", {"timeframe": "today"}))
    assert "Unknown function" in result["error"]


def test_set_trust_floor_and_brief_plan() -> None:
    ctx = LiveContext()
    out = asyncio.run(ctx.execute("set_trust_floor", {"trust_floor": 0.2}))
    assert out["trust_floor"] == 0.2
    assert out["ui"] == "TRUST_FLOOR"
    brief = _brief_plan({
        "id": "p1",
        "title": "Camping",
        "items": [{
            "id": "i1",
            "name": "Tent",
            "purchased": False,
            "products": [{"id": "a"}, {"id": "b"}],
            "synthesis": {"best": {"id": "a", "title": "Coleman", "store": "Amazon", "price": 79}},
        }],
        "quote": {"totalPrice": 79},
    })
    assert brief["items"][0]["listing_count"] == 2
    assert brief["items"][0]["best"]["store"] == "Amazon"


def test_live_router_mounted() -> None:
    # FastAPI 0.14x wraps included routers, so check the live router itself.
    from api import live

    assert "/ws-live" in {getattr(route, "path", None) for route in live.router.routes}


# --- relay against a fake Gemini ------------------------------------------

import json  # noqa: E402

import pytest  # noqa: E402

from api import live  # noqa: E402
from api.config import get_settings  # noqa: E402


class FakeGemini:
    """Stands in for the Gemini Live socket: records what the relay sends, replays a script."""

    def __init__(self) -> None:
        self.sent: list[dict] = []
        self.tool_answered = asyncio.Event()
        self.audio_seen = asyncio.Event()

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def send(self, raw: str) -> None:
        message = json.loads(raw)
        self.sent.append(message)
        if "toolResponse" in message:
            self.tool_answered.set()
        if "audio" in message.get("realtimeInput", {}):
            self.audio_seen.set()

    def __aiter__(self):
        return self._script()

    async def _script(self):
        yield json.dumps({"setupComplete": {}})
        await self.audio_seen.wait()
        yield json.dumps({"toolCall": {"functionCalls": [
            {"id": "c1", "name": "create_plan", "args": {"prompt": "camping this weekend", "category": "camping"}},
        ]}})
        await self.tool_answered.wait()
        yield json.dumps({"serverContent": {"modelTurn": {"parts": [{"inlineData": {"mimeType": "audio/pcm;rate=24000", "data": "AAAA"}}]}}})
        await asyncio.Event().wait()  # stay open until the browser leaves


@pytest.fixture
def live_relay(monkeypatch):
    fake = FakeGemini()
    express_calls: list[tuple] = []

    async def fake_http(self, method, path, payload=None):
        express_calls.append((method, path, payload))
        return {"id": "plan-1", "title": "Camping trip", "status": "pricing", "quote": {}, "items": [
            {"id": "i1", "name": "Tent", "quantity": 1, "purchased": False, "products": [], "synthesis": None},
        ]}

    settings = get_settings()
    monkeypatch.setattr(settings, "gemini_api_key", "test-key")
    monkeypatch.setattr(live.websockets, "connect", lambda *a, **k: fake)
    monkeypatch.setattr(live, "_resolved_model", "gemini-test-live")
    monkeypatch.setattr(LiveContext, "_http", fake_http)
    return fake, express_calls


def test_relay_session_flow(client, live_relay) -> None:
    fake, express_calls = live_relay
    with client.websocket_connect("/ws-live") as ws:
        ws.send_json({"type": "session", "audio_mode": "manual"})
        assert "setupComplete" in ws.receive_json()
        ws.send_text("not JSON")
        ws.send_text("[]")
        ws.send_text(json.dumps({"setup": {"model": "models/other"}}))  # ignored: client may not reconfigure
        ws.send_text(json.dumps({"realtimeInput": {"activityStart": {}}}))
        ws.send_bytes(b"\x01\x00" * 160)
        ui = ws.receive_json()
        assert ui == {"type": "UI_UPDATE", "action": "PLAN", "payload": ui["payload"], "item_id": None}
        assert ui["payload"]["status"] == "pricing"
        assert "Prices are still loading" in ui["payload"]["note"]
        audio = ws.receive_json()
        assert audio["serverContent"]["modelTurn"]["parts"][0]["inlineData"]["data"] == "AAAA"

    setup = fake.sent[0]["setup"]
    assert setup["model"] == "models/gemini-test-live"
    assert setup["realtimeInputConfig"] == {"automaticActivityDetection": {"disabled": True}}
    assert "slidingWindow" in setup["contextWindowCompression"]
    assert not any("setup" in message for message in fake.sent[1:])
    assert {"realtimeInput": {"activityStart": {}}} in fake.sent
    audio_in = next(m for m in fake.sent if "audio" in m.get("realtimeInput", {}))
    assert audio_in["realtimeInput"]["audio"]["mimeType"] == "audio/pcm;rate=16000"
    assert express_calls[0][2]["async"] is True
    reply = next(m for m in fake.sent if "toolResponse" in m)["toolResponse"]["functionResponses"][0]
    assert reply["id"] == "c1" and reply["response"]["output"]["plan"]["id"] == "plan-1"


def test_resolve_model_falls_back_to_an_available_live_model(monkeypatch) -> None:
    class Listing:
        def json(self):
            return {"models": [
                {"name": "models/gemini-2.5-flash", "supportedGenerationMethods": ["generateContent"]},
                {"name": "models/gemini-live-2.5-flash-preview", "supportedGenerationMethods": ["bidiGenerateContent"]},
                {"name": "models/gemini-2.5-flash-native-audio-preview", "supportedGenerationMethods": ["bidiGenerateContent"]},
            ]}

    class Client:
        def __init__(self, *a, **k): ...
        async def __aenter__(self): return self
        async def __aexit__(self, *exc): return False
        async def get(self, *a, **k): return Listing()

    monkeypatch.setattr(live, "_resolved_model", None)
    monkeypatch.setattr(live.httpx, "AsyncClient", Client)
    assert asyncio.run(live.resolve_model("k", "gemini-2.0-flash-exp")) == "gemini-2.5-flash-native-audio-preview"
    monkeypatch.setattr(live, "_resolved_model", None)
    assert asyncio.run(live.resolve_model("k", "retired-model")) != "gemini-2.5-flash"  # never a non-Live model
    monkeypatch.setattr(live, "_resolved_model", None)
    assert asyncio.run(live.resolve_model("k", "gemini-live-2.5-flash-preview")) == "gemini-live-2.5-flash-preview"
    monkeypatch.setattr(live, "_resolved_model", None)


def test_brief_plan_reports_pricing_progress() -> None:
    brief = _brief_plan({"id": "p", "status": "pricing", "items": [
        {"id": "a", "name": "Tent", "synthesis": {"best": {"id": "x", "price": 79}}},
        {"id": "b", "name": "Stove", "synthesis": None},
    ]})
    assert brief["note"] == "Prices are still loading on screen (1 of 2 items priced)."


def test_relay_ends_at_session_limit(client, live_relay, monkeypatch) -> None:
    monkeypatch.setattr(get_settings(), "gemini_live_max_session_s", 0.02)
    with client.websocket_connect("/ws-live") as ws:
        assert "setupComplete" in ws.receive_json()
        assert ws.receive_json() == {"type": "error", "error": "session_limit"}


def test_shortlist_and_compare_refresh_async_plan(monkeypatch) -> None:
    ctx = LiveContext()
    ctx.plan_id = "p"
    ctx.plan = {"id": "p", "status": "pricing", "items": [{"id": "i", "products": []}]}
    calls = []
    products = [{"id": "a", "price": 10, "currency": "USD"}, {"id": "b", "price": 11, "currency": "USD"}]

    async def fake_http(method, path, payload=None):
        calls.append((method, path))
        if method == "GET":
            return {"id": "p", "status": "ready", "items": [{"id": "i", "products": products}]}
        return {"pick": "left", "left": products[0], "right": products[1]}

    monkeypatch.setattr(ctx, "_http", fake_http)
    out = asyncio.run(ctx.execute("list_shortlist", {"item_id": "i"}))
    assert [p["id"] for p in out["listings"]] == ["a", "b"]
    out = asyncio.run(ctx.execute("compare_listings", {"item_id": "i", "left_product_id": "a", "right_product_id": "b"}))
    assert out["ui"] == "COMPARE"
    assert calls == [("GET", "/api/plans/p"), ("GET", "/api/plans/p"), ("POST", "/api/compare")]


def test_plan_http_preserves_only_app_session_cookie(monkeypatch) -> None:
    import httpx

    seen = []

    def handler(request):
        seen.append(request.headers.get("cookie"))
        return httpx.Response(200, json={"id": "p"}, headers={"set-cookie": "pb_sid=refreshed-token; HttpOnly; Path=/"})

    original_client = httpx.AsyncClient
    monkeypatch.setattr(httpx, "AsyncClient", lambda **kw: original_client(**kw, transport=httpx.MockTransport(handler)))
    ctx = LiveContext(session_cookie="browser-token")
    assert asyncio.run(ctx._http("GET", "/api/plans/p"))["id"] == "p"
    assert seen == ["pb_sid=browser-token"]
    assert ctx.session_cookie == "refreshed-token"
    assert LiveContext(session_cookie="a; unrelated_cookie=secret").session_cookie is None


def test_tool_errors_remain_errors_and_invalid_values_are_rejected(monkeypatch) -> None:
    ctx = LiveContext()
    ctx.plan_id = "missing"

    async def missing(*args, **kwargs):
        return {"error": "plan not found"}

    monkeypatch.setattr(ctx, "_http", missing)
    assert asyncio.run(ctx.execute("get_plan", {})) == {"error": "plan not found"}
    assert "error" in asyncio.run(ctx.execute("mark_purchased", {"purchased": "false"}))
    assert "error" in asyncio.run(ctx.execute("set_trust_floor", {"trust_floor": float("nan")}))


def test_cart_rejects_unknown_offer_and_owned_items(monkeypatch) -> None:
    ctx = LiveContext()
    ctx.plan_id = "p"
    item = {"id": "i", "name": "Tent", "synthesis": {"totalPrice": 12, "best": {"id": "x", "price": 12}}}
    async def get_plan(*args, **kwargs):
        return {"id": "p", "items": [item]}
    monkeypatch.setattr(ctx, "_http", get_plan)
    assert "error" in asyncio.run(ctx.execute("add_to_cart", {"item_id": "i"}))
    item["synthesis"]["best"].update(currency="USD", inStock=True)
    assert asyncio.run(ctx.execute("add_to_cart", {"item_id": "i"}))["ui"] == "CART"
    item["owned"] = True
    assert "error" in asyncio.run(ctx.execute("add_to_cart", {"item_id": "i"}))
    item["owned"] = False
    item["synthesis"]["totalPrice"] = float("nan")
    assert "error" in asyncio.run(ctx.execute("add_to_cart", {"item_id": "i"}))
