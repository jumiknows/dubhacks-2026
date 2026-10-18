"""Hermetic recommendation tests: no startup, data generation, model download or checkout."""

from __future__ import annotations

from decimal import Decimal

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api import search
from api import store as store_module
from api.recommendations import router
from api.schemas import Merchant, PreferenceProfile, Product, RankedProduct, TrustReport
from api.store import Store
from api.textvec import hashed_matrix


def raw_product(product_id: str = "raw-1", **overrides: object) -> dict:
    """Local fixture matching fetchBot.js RawProduct; no claim of a live listing."""
    raw = {
        "id": product_id, "store": "Target", "title": "Fixture camp light",
        "price": "12.34", "currency": "USD", "image": None,
        "url": "https://www.target.com/p/fixture", "dimensions": None,
        "shippingDays": None, "inStock": True,
    }
    raw.update(overrides)
    return raw


@pytest.fixture
def catalog() -> Store:
    product = Product(
        id="reviewed", title="Fixture hydrating cream", brand="Fixture brand", price=20.0,
        image="/static/products/fixture.svg", subcategory="moisturizer",
        attributes={"hydrating": True, "fragrance_free": True, "skin_type": "dry"},
        rating_listed=4.2, review_count=50, summary="A fixture moisturizer.", merchant_id="m_target",
    )
    report = TrustReport(
        product_id=product.id, score=90, tier="trusted", rating_listed=4.2,
        rating_adjusted=4.1, signals=[], top_reasons=["Fixture evidence"],
        evidence_review_ids=["fixture-review"],
    )
    return Store(
        products={product.id: product}, trust={product.id: report},
        merchants={
            "m_target": Merchant(id="m_target", name="Target", verified=True),
            "m_unapproved": Merchant(id="m_unapproved", name="Unapproved", verified=False),
        },
    )


@pytest.fixture
def local_ranker(catalog: Store) -> search.Ranker:
    return search.Ranker(catalog, embedder=("hashed-ngrams", hashed_matrix))


@pytest.fixture
def recommend_client(monkeypatch, catalog: Store, local_ranker: search.Ranker):
    # The endpoint resolves these module globals, but each test receives private in-memory data.
    monkeypatch.setattr(store_module, "store", catalog)
    monkeypatch.setattr(search, "_ranker", local_ranker)
    app = FastAPI()
    app.include_router(router)
    with TestClient(app) as client:
        yield client


def recommend(client: TestClient, products: list, **constraints: object) -> dict:
    response = client.post("/products/recommend", json={"products": products, **constraints})
    assert response.status_code == 200, response.text
    return response.json()


def result_ids(body: dict) -> set[str]:
    return {result["product"]["id"] for result in body["results"]}


def test_sparse_node_record_is_ranked_without_invented_fields(recommend_client) -> None:
    body = recommend(recommend_client, [raw_product()], query="camp light")
    assert result_ids(body) == {"raw-1"}
    assert body["issues"] == []
    result = body["results"][0]
    product = result["product"]
    assert product["merchant_id"] == "m_target"
    assert Decimal(product["price"]) == Decimal("12.34")
    for field in ("brand", "summary", "subcategory", "rating_listed", "review_count", "image"):
        assert product[field] is None
    assert product["attributes"] == {}
    assert result["total_price"] is None
    assert result["trust_score"] is None
    assert body["budget_scope"] == "unit_product_price"
    assert any("Shipping or tax is unknown" in warning for warning in result["warnings"])


def test_missing_delivery_stays_unknown_even_with_shipping_duration(recommend_client) -> None:
    body = recommend(recommend_client, [raw_product(shippingDays=3)])
    delivery = body["results"][0]["product"]["delivery"]
    assert delivery == {
        "shipping_price": None, "tax": None, "shipping_days": 3,
        "estimated_arrival": None, "estimate_reference_date": None,
    }


def test_complete_known_cost_uses_exact_decimal_addition(recommend_client) -> None:
    body = recommend(recommend_client, [raw_product(price="0.10", shippingPrice="0.20", tax="0.00")])
    result = body["results"][0]
    assert Decimal(result["total_price"]) == Decimal("0.30")
    assert Decimal(result["product"]["delivery"]["shipping_price"]) == Decimal("0.20")
    assert not any("not a complete total" in warning for warning in result["warnings"])


def test_budget_includes_exact_maximum_and_excludes_one_cent_over(recommend_client) -> None:
    body = recommend(
        recommend_client,
        [raw_product("at-limit", price="19.99"), raw_product("over-limit", price="20.00")],
        max_price="19.99",
    )
    assert result_ids(body) == {"at-limit"}
    assert [(issue["product_id"], issue["code"]) for issue in body["issues"]] == [("over-limit", "over_budget")]


def test_currency_is_not_inferred_or_converted(recommend_client) -> None:
    body = recommend(recommend_client, [raw_product("eur", currency="EUR"), raw_product("unknown", currency=None)])
    assert body["results"] == []
    assert {issue["code"] for issue in body["issues"]} == {"currency_mismatch"}
    assert body["normalized"][1]["currency"] is None
    declared = recommend(recommend_client, [raw_product(currency=None)], source_currency="usd")
    assert result_ids(declared) == {"raw-1"}


def test_source_currency_conflict_is_a_record_error(recommend_client) -> None:
    body = recommend(recommend_client, [raw_product(currency="EUR")], source_currency="USD")
    assert body["results"] == []
    assert body["issues"][0]["code"] == "invalid_product"
    assert body["issues"][0]["field"] == "currency"


def test_missing_price_is_preserved_and_excluded(recommend_client) -> None:
    body = recommend(recommend_client, [raw_product(price=None)])
    assert body["normalized"][0]["price"] is None
    assert body["results"] == []
    assert body["issues"][0]["code"] == "missing_price"


@pytest.mark.parametrize("price", [-1, "-0.01", "free", "12,34", "0.001", True])
def test_invalid_prices_are_record_errors(recommend_client, price) -> None:
    body = recommend(recommend_client, [raw_product(price=price)])
    assert body["normalized"] == body["results"] == []
    assert body["issues"][0]["code"] == "invalid_product"
    assert body["issues"][0]["field"] == "price"


def test_required_boolean_attribute_needs_verified_boolean_value(recommend_client) -> None:
    body = recommend(
        recommend_client,
        [raw_product("yes", attributes={"waterproof": True}),
         raw_product("no", attributes={"waterproof": False}),
         raw_product("number", attributes={"waterproof": 1}),
         raw_product("unknown")],
        required_attributes={"waterproof": True},
    )
    assert result_ids(body) == {"yes"}
    assert len(body["issues"]) == 3
    assert all(issue["code"] == "required_attribute" for issue in body["issues"])


def test_avoided_attribute_excludes_only_verified_match_and_warns_on_unknown(recommend_client) -> None:
    body = recommend(
        recommend_client,
        [raw_product("yes", attributes={"waterproof": True}),
         raw_product("no", attributes={"waterproof": False}),
         raw_product("number", attributes={"waterproof": 1}),
         raw_product("unknown")],
        avoided_attributes={"waterproof": True},
    )
    assert result_ids(body) == {"no", "number", "unknown"}
    assert body["issues"][0]["code"] == "avoided_attribute"
    unknown = next(result for result in body["results"] if result["product"]["id"] == "unknown")
    assert any("'waterproof' is unknown" in warning for warning in unknown["warnings"])


def test_known_boolean_attribute_strings_are_normalized_before_filtering(recommend_client) -> None:
    body = recommend(
        recommend_client,
        [raw_product("true", attributes={"fragrance_free": "true"}),
         raw_product("false", attributes={"fragrance_free": "false"})],
        required_attributes={"fragrance_free": True},
    )
    assert result_ids(body) == {"true"}
    assert body["results"][0]["product"]["attributes"]["fragrance_free"] is True


def test_out_of_stock_and_unknown_merchants_are_excluded(recommend_client) -> None:
    body = recommend(
        recommend_client,
        [raw_product("stock", inStock=False), raw_product("unknown", store="Unknown fixture merchant"),
         raw_product("unapproved", store="Unapproved")],
    )
    assert body["results"] == []
    assert {issue["code"] for issue in body["issues"]} == {
        "out_of_stock", "unknown_merchant", "merchant_not_approved",
    }
    body = recommend(
        recommend_client,
        [raw_product("unknown", store="Unknown fixture merchant"), raw_product("unapproved", store="Unapproved")],
        verified_only=False,
    )
    assert result_ids(body) == {"unapproved"}
    assert body["issues"][0]["code"] == "unknown_merchant"


def test_all_duplicate_identifiers_are_excluded(recommend_client) -> None:
    body = recommend(recommend_client, [raw_product("duplicate"), raw_product("duplicate", price="1.00")])
    assert body["results"] == []
    assert len(body["normalized"]) == 2
    assert [issue["index"] for issue in body["issues"]] == [0, 1]
    assert all(issue["code"] == "duplicate_id" for issue in body["issues"])


def test_malformed_records_do_not_prevent_valid_results(recommend_client) -> None:
    body = recommend(recommend_client, [None, [], "not a product", {}, {"id": "no-title"}, raw_product()])
    assert result_ids(body) == {"raw-1"}
    assert len(body["issues"]) == 5
    assert all(issue["code"] == "invalid_product" for issue in body["issues"])
    assert {issue["field"] for issue in body["issues"]} == {"product", "id", "title"}


def test_empty_input_and_no_matches_return_empty_results(recommend_client) -> None:
    assert recommend(recommend_client, []) == {
        "currency": "USD", "budget_scope": "unit_product_price", "normalized": [], "results": [], "issues": [],
    }
    body = recommend(recommend_client, [raw_product()], max_price="0.00")
    assert body["results"] == []
    assert body["issues"][0]["code"] == "over_budget"


def test_uploaded_id_cannot_borrow_catalog_trust_or_change_global_catalog(
    recommend_client, catalog: Store, local_ranker: search.Ranker,
) -> None:
    before_products = {key: product.model_dump() for key, product in catalog.products.items()}
    before_reports = {key: report.model_dump() for key, report in catalog.trust.items()}
    body = recommend(
        recommend_client,
        [raw_product("reviewed", title="Different unreviewed fixture", trust_score=100, verified=True)],
    )
    result = body["results"][0]
    assert result["trust_score"] is None
    assert result["fit_terms"]["trust"] == 0.5
    assert any("not a measured score" in warning for warning in result["warnings"])
    assert any("domain ownership has not been verified" in warning for warning in result["warnings"])
    assert {key: product.model_dump() for key, product in catalog.products.items()} == before_products
    assert {key: report.model_dump() for key, report in catalog.trust.items()} == before_reports
    assert search.ranker() is local_ranker
    assert local_ranker.ids == ["reviewed"]


@pytest.mark.parametrize("extra", [
    {"max_price": "-1.00"}, {"max_price": "1.001"}, {"currency": "EUR"},
    {"required_attributes": {"waterproof": None}}, {"products": "not a list"},
])
def test_invalid_request_constraints_are_rejected(recommend_client, extra) -> None:
    payload = {"products": [raw_product()], **extra}
    response = recommend_client.post("/products/recommend", json=payload)
    assert response.status_code == 422


def test_legacy_ranker_preserves_formula_response_and_catalog_trust(local_ranker: search.Ranker) -> None:
    assert (search.W_SEMANTIC, search.W_ATTR, search.W_TRUST, search.W_FEEDBACK) == (0.45, 0.25, 0.20, 0.10)
    results = local_ranker.search(search.SearchRequest())
    assert len(results) == 1 and isinstance(results[0], RankedProduct)
    result = results[0]
    assert result.id == "reviewed" and result.price == 20.0
    assert result.fit_terms.model_dump() == {
        "semantic": 0.5, "attribute_match": 0.5, "trust": 0.9, "feedback": 0.5,
    }
    assert result.fit_percent == round(100 * (0.45 * 0.5 + 0.25 * 0.5 + 0.20 * 0.9 + 0.10 * 0.5))
    assert "Trust Score 90 (trusted)" in result.reasons
    assert local_ranker.search(search.SearchRequest(max_price=19.99)) == []
    profile = PreferenceProfile(needs=["hydrating"], avoid=["fragrance"], liked_ids=["reviewed"])
    preferred = local_ranker.search(search.SearchRequest(query="hydrating cream"), profile)[0]
    assert preferred.fit_terms.attribute_match == 1.0
    assert preferred.fit_terms.semantic == 1.0
    assert preferred.fit_terms.feedback == 1.0


def test_production_app_serves_new_endpoint_without_running_startup(monkeypatch, catalog, local_ranker) -> None:
    from api.main import app

    monkeypatch.setattr(store_module, "store", catalog)
    monkeypatch.setattr(search, "_ranker", local_ranker)
    # No context manager: exercise actual app routing without its data-loading lifespan.
    client = TestClient(app)
    try:
        assert result_ids(recommend(client, [raw_product()])) == {"raw-1"}
    finally:
        client.close()
