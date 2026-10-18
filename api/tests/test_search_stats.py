"""In-memory search compatibility checks; no startup, model download or data generation."""

from __future__ import annotations

import pytest

from api import search
from api import store as store_module
from api.normalization import normalize_product
from api.recommendations import RecommendationCatalog
from api.schemas import Dismissal, IntentMandate, Merchant, PreferenceProfile, Product, TrustReport
from api.store import Store
from api.textvec import hashed_matrix


def _product(product_id: str, **overrides: object) -> Product:
    fields = {
        "id": product_id, "title": f"Fixture {product_id} cream", "brand": "Fixture",
        "price": 10.0, "image": "/static/products/fixture.svg", "subcategory": "moisturizer",
        "attributes": {"fragrance_free": True, "hydrating": True, "skin_type": "dry"},
        "rating_listed": 4.0, "review_count": 30, "summary": "Fixture hydrating cream.",
        "merchant_id": "approved",
    }
    fields.update(overrides)
    return Product(**fields)


def _store(*products: Product) -> Store:
    return Store(
        products={p.id: p for p in products},
        merchants={
            "approved": Merchant(id="approved", name="Approved fixture", verified=True),
            "unapproved": Merchant(id="unapproved", name="Unapproved fixture", verified=False),
        },
    )


def _ranker(catalog: Store | RecommendationCatalog) -> search.Ranker:
    return search.Ranker(catalog, embedder=("hashed-ngrams", hashed_matrix))


def _snapshot(catalog: Store) -> dict:
    return {
        "products": {key: p.model_dump() for key, p in catalog.products.items()},
        "trust": {key: report.model_dump() for key, report in catalog.trust.items()},
        "merchants": {key: merchant.model_dump() for key, merchant in catalog.merchants.items()},
    }


def test_search_interfaces_preserve_order_terms_and_public_results() -> None:
    catalog = _store(
        _product("hydrating", price=12.0),
        _product("light", price=9.0, attributes={"fragrance_free": True, "skin_type": "oily"}),
        _product("gentle", price=15.0),
    )
    ranker = _ranker(catalog)
    request = search.SearchRequest(query="hydrating cream", limit=3)
    profile = PreferenceProfile(needs=["hydrating"], skin_type="dry", liked_ids=["hydrating"])

    legacy = ranker.search(request, profile)
    traced, removed = ranker.search_with_stats(request, profile)
    scores = ranker.score(request, profile)

    assert len(legacy) == 3 and removed == {}
    assert [p.model_dump() for p in legacy] == [p.model_dump() for p in traced]
    assert [p.id for p in legacy] == [s.product_id for s in scores]
    assert [(p.fit_percent, p.fit_terms.model_dump(), p.reasons) for p in legacy] == [
        (s.fit_percent, s.fit_terms.model_dump(), s.reasons) for s in scores
    ]
    for result in traced:
        assert result.price == catalog.products[result.id].price
        assert result.title == catalog.products[result.id].title


def test_only_first_filter_reason_counts_in_priority_order() -> None:
    catalog = _store()
    raw = [
        {"id": "category", "subcategory": "cleanser", "price": None},
        {"id": "unpriced", "price": None},
        {"id": "expensive", "price": "20.01"},
        {"id": "avoided", "price": "10.00"},
        {"id": "unverified", "price": "10.00", "attributes": {"fragrance_free": True}},
        {"id": "dismissed", "price": "10.00", "merchant_id": "approved",
         "attributes": {"fragrance_free": True}},
    ]
    products = {}
    for record in raw:
        product = normalize_product({
            "title": "Fixture cream", "currency": "USD", "subcategory": "moisturizer",
            "merchant_id": "unapproved", "attributes": {"fragrance_free": False}, **record,
        }, catalog.merchants)
        products[product.id] = product
    ranker = _ranker(RecommendationCatalog(products, catalog.merchants))
    profile = PreferenceProfile(
        avoid=["fragrance"], dismissed=[Dismissal(id=product_id) for product_id in products],
    )
    mandate = IntentMandate(
        session_id="fixture-session", budget_max=100, categories=["moisturizer"],
        verified_only=True, issued_at="2026-10-17T00:00:00Z",
    )

    results, removed = ranker.search_with_stats(
        search.SearchRequest(max_price=20, subcategory="moisturizer"), profile, mandate,
    )

    assert results == []
    assert removed == {
        "subcategory": 1, "missing_price": 1, "budget": 1,
        "avoid": 1, "unverified": 1, "dismissed": 1,
    }
    assert sum(removed.values()) == len(products)


def test_empty_catalog_returns_no_results_or_exclusions() -> None:
    ranker = _ranker(_store())
    request = search.SearchRequest(query="hydrating cream", max_price=10)

    assert ranker.search_with_stats(request) == ([], {})
    assert ranker.search(request) == []
    assert ranker.score(request) == []


def test_result_limit_does_not_count_eligible_products_as_exclusions() -> None:
    ranker = _ranker(_store(
        _product("cheap", price=5), _product("middle", price=10),
        _product("boundary", price=15), _product("expensive", price=30),
    ))

    results, removed = ranker.search_with_stats(search.SearchRequest(max_price=15, limit=1))
    all_results, all_removed = ranker.search_with_stats(search.SearchRequest(max_price=15, limit=50))

    assert [p.id for p in results] == ["cheap"]
    assert [p.id for p in all_results] == ["cheap", "middle", "boundary"]
    assert removed == all_removed == {"budget": 1}


@pytest.mark.parametrize("request_budget,profile_budget", [(10, 20), (20, 10)])
def test_stats_use_tighter_budget_and_include_exact_boundary(request_budget, profile_budget) -> None:
    ranker = _ranker(_store(
        _product("below", price=8), _product("boundary", price=10),
        _product("over", price=10.01),
    ))
    request = search.SearchRequest(max_price=request_budget)
    profile = PreferenceProfile(budget_max=profile_budget)

    results, removed = ranker.search_with_stats(request, profile)

    assert [p.id for p in results] == ["below", "boundary"]
    assert removed == {"budget": 1}
    assert [s.product_id for s in ranker.score(request, profile)] == [p.id for p in results]


@pytest.mark.parametrize("request_budget,profile_budget,mandate_budget", [
    (20, 30, 10), (10, 30, 20), (30, 10, 20), (None, None, 10),
])
def test_signed_budget_cannot_be_relaxed_by_request_or_profile(
    request_budget, profile_budget, mandate_budget,
) -> None:
    ranker = _ranker(_store(
        _product("boundary", price=10), _product("over", price=10.01),
    ))
    mandate = IntentMandate(
        session_id="fixture-session", budget_max=mandate_budget, categories=[],
        issued_at="2026-10-17T00:00:00Z",
    )
    req = search.SearchRequest(max_price=request_budget)
    profile = PreferenceProfile(budget_max=profile_budget)

    results, removed = ranker.search_with_stats(req, profile, mandate)

    assert [p.id for p in results] == ["boundary"]
    assert removed == {"budget": 1}
    assert [p.product_id for p in ranker.score(req, profile, mandate)] == ["boundary"]


def test_signed_categories_apply_without_requested_category_and_keep_first_reason() -> None:
    ranker = _ranker(_store(
        _product("allowed", subcategory="moisturizer"),
        _product("wrong-category", subcategory="cleanser", price=30),
        _product("over-budget", subcategory="moisturizer", price=30),
    ))
    mandate = IntentMandate(
        session_id="fixture-session", budget_max=20, categories=["MOISTURIZER"],
        issued_at="2026-10-17T00:00:00Z",
    )

    results, removed = ranker.search_with_stats(search.SearchRequest(), mandate=mandate)

    assert [p.id for p in results] == ["allowed"]
    assert removed == {"subcategory": 1, "budget": 1}
    assert ranker.search(search.SearchRequest(subcategory="cleanser"), mandate=mandate) == []


def test_empty_signed_category_list_keeps_any_category_allowed() -> None:
    ranker = _ranker(_store(_product("cream"), _product("cleanser", subcategory="cleanser")))
    mandate = IntentMandate(
        session_id="fixture-session", budget_max=20, categories=[],
        issued_at="2026-10-17T00:00:00Z",
    )

    results, removed = ranker.search_with_stats(search.SearchRequest(), mandate=mandate)

    assert {p.id for p in results} == {"cream", "cleanser"}
    assert removed == {}


def test_score_safely_excludes_unpriced_sparse_products() -> None:
    catalog = _store()
    products = {
        key: normalize_product({
            "id": key, "title": "Fixture camp lamp", "merchant_id": "approved",
            "currency": "USD", "price": amount,
        }, catalog.merchants)
        for key, amount in [("unpriced", None), ("priced", "12.34")]
    }
    ranker = _ranker(RecommendationCatalog(products, catalog.merchants))

    scores = ranker.score(search.SearchRequest(query="camp lamp", max_price=20))

    assert [s.product_id for s in scores] == ["priced"]
    assert scores[0].fit_terms.trust == 0.5
    assert products["unpriced"].price is None
    assert products["priced"].brand is None and products["priced"].summary is None
    assert products["priced"].attributes == {}


def test_request_local_ranker_preserves_catalog_trust_vectors_and_global_state(monkeypatch) -> None:
    catalog = _store(_product("reviewed"))
    catalog.trust["reviewed"] = TrustReport(
        product_id="reviewed", score=90, tier="trusted", rating_listed=4,
        rating_adjusted=4, signals=[], top_reasons=["Fixture evidence"],
        evidence_review_ids=["fixture-review"],
    )
    original = _ranker(catalog)
    catalog_before = _snapshot(catalog)
    ids_before = list(original.ids)
    vectors_before = original.vectors.tolist()
    global_store = store_module.store
    global_before = _snapshot(global_store)
    global_ranker = search._ranker
    uploaded = normalize_product({
        "id": "reviewed", "title": "Different unreviewed fixture lamp",
        "price": "5.00", "currency": "USD", "merchant_id": "approved",
    }, catalog.merchants)

    def unexpected_embedder_load():
        raise AssertionError("with_catalog must reuse the existing embedder")

    monkeypatch.setattr(search, "_make_embedder", unexpected_embedder_load)
    local = original.with_catalog(RecommendationCatalog({uploaded.id: uploaded}, dict(catalog.merchants)))
    local_scores = local.score(search.SearchRequest(query="lamp"))
    original_results, removed = original.search_with_stats(search.SearchRequest())

    assert local is not original and local.backend == original.backend
    assert local_scores[0].fit_terms.trust == 0.5
    assert original_results[0].fit_terms.trust == 0.9 and removed == {}
    assert _snapshot(catalog) == catalog_before
    assert original.ids == ids_before and original.vectors.tolist() == vectors_before
    assert store_module.store is global_store and _snapshot(global_store) == global_before
    assert search._ranker is global_ranker
