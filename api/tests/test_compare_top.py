from api.market.compare_service import compare_items
from api.market.top_service import top_items
from api.market.valued import ValuedItem


def _item(id, bang, trust, relevancy=1.0, **extra):
    return ValuedItem(id=id, title=id, bang_per_buck=bang, trust=trust, relevancy=relevancy, **extra)


def test_compare_trust_floor_changes_pick():
    cheap = _item("cheap", bang=0.9, trust=0.2, relevancy=1.0)
    trusted = _item("trusted", bang=0.6, trust=0.9, relevancy=1.0)
    low_floor = compare_items(cheap, trusted, trust_floor=0.2)
    assert low_floor.pick == "right"
    high_floor = compare_items(cheap, trusted, trust_floor=0.95)
    assert high_floor.left.score >= high_floor.right.score
    assert high_floor.left.trust_multiplier >= 0.95


def test_compare_out_of_stock_loses():
    a = _item("a", bang=0.99, trust=1, in_stock=False)
    b = _item("b", bang=0.4, trust=0.5, in_stock=True)
    out = compare_items(a, b, trust_floor=0.5)
    assert out.pick == "right"


def test_top_items_limit_and_order(client):
    items = [
        _item("a", bang=0.4, trust=1.0),
        _item("b", bang=0.9, trust=0.9),
        _item("c", bang=0.8, trust=0.1),
    ]
    res = client.post("/market/top", json={"items": [i.model_dump() for i in items], "limit": 2, "trust_floor": 0.5})
    assert res.status_code == 200
    body = res.json()
    assert body["count"] == 2
    assert body["items"][0]["id"] == "b"
    cmp = client.post("/market/compare", json={
        "left": items[1].model_dump(),
        "right": items[2].model_dump(),
        "trust_floor": 0.5,
    })
    assert cmp.status_code == 200
    assert cmp.json()["pick"] in {"left", "right", None}


def test_top_service_direct():
    items = [_item(str(i), bang=i / 10, trust=0.5) for i in range(1, 15)]
    out = top_items(items, limit=10, trust_floor=0.5)
    assert out.count == 10
    scores = [row.score for row in out.items]
    assert scores == sorted(scores, reverse=True)
