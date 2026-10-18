from api.market.fixtures import for_query
from api.market.models import PlanItemIn
from api.market.parse import parse_price, product_ld
from api.market.synthesize import synthesize


def test_parse_price_and_json_ld():
    assert parse_price("$1,234.50") == 1234.50
    html = """
    <script type="application/ld+json">
    {"@type":"Product","name":"Tent","offers":{"price":"79.99"},"aggregateRating":{"ratingValue":4.5,"reviewCount":10}}
    </script>
    """
    data = product_ld(html)
    assert data and data["name"] == "Tent"


def test_synthesize_prefers_trusted_in_stock():
    products = for_query("2-person tent", ["amazon", "ebay", "walmart"], 8)
    out = synthesize(PlanItemIn(name="2-person tent", quantity=1), products)
    assert out.best is not None
    assert out.method.startswith("bang_per_buck")
    if out.alternatives:
        assert out.best.scores.total >= out.alternatives[0].scores.total


def test_market_search_fixture_endpoint(client):
    res = client.post("/market/search", json={"query": "sleeping bag", "limit": 4})
    assert res.status_code == 200
    body = res.json()
    assert body["source"] == "fixture"
    assert body["products"]
    syn = client.post("/market/synthesize", json={
        "item": {"name": "Sleeping bag", "quantity": 2},
        "products": body["products"],
    })
    assert syn.status_code == 200
    offer = syn.json()
    assert offer["total_price"] is None or offer["total_price"] >= 0
    assert "bang_per_buck" in offer["method"]
