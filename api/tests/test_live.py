from __future__ import annotations

import asyncio

from api.live_tools import LiveContext, _brief_plan
from api.main import app


def test_health_reports_gemini_live(client) -> None:
    body = client.get("/health").json()
    assert body["integrations"]["gemini_live"] == "mocked"


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
    paths = {getattr(route, "path", None) for route in app.routes}
    assert "/ws-live" in paths
