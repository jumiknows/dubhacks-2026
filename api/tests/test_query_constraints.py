"""USD query constraints and profile vocabulary, using only in-memory products."""

from __future__ import annotations

import pytest

from api import nlu, search
from api.agent import tools
from api.schemas import IntentMandate, Merchant, PreferenceProfile, Product, TrustReport
from api.sessions import Session
from api.store import Store
from api.textvec import hashed_matrix


@pytest.mark.parametrize("text,expected", [
    ("under $1,000", 1000), ("at most USD 1,000.25", 1000.25),
    ("below USD1000", 1000), ("under 1000 USD", 1000),
    ("$1,000 or less", 1000), ("USD 40 budget", 40),
    ("under 40", 40), ("under40", 40), ("< $25.50", 25.5),
    ("under $40, fragrance-free", 40), ("under $40.", 40),
    ("maximum 0", 0), ("under $0.00", 0),
    ("under $40 and at most $25", 25),
])
def test_whole_usd_budgets_are_parsed_including_zero_and_comma_grouping(text, expected):
    parsed = nlu.parse(text)
    assert parsed.budget_max == expected
    assert parsed.budget_error is None
    assert parsed.has_shopping_terms


@pytest.mark.parametrize("text", [
    "under $1,00", "under $1, 000", "under $1 000", "under $1.000,00",
    "under $12.345", "under $10..50", "under $10-$20", "under $-1",
    "under $1e3", "under $NaN", "under $Infinity", "under $100000",
])
def test_malformed_or_unsupported_budget_is_never_partially_parsed(text):
    parsed = nlu.parse(text)
    assert parsed.budget_max is None
    assert parsed.budget_error and "USD" in parsed.budget_error
    assert parsed.has_shopping_terms


@pytest.mark.parametrize("text", [
    "under €40", "under £40", "under JPY 1000", "under CAD40", "under C$40",
    "under 40 EUR", "under 40 euros", "under $40 EUR", "buy it for €40",
    "under CHF 40", "under 40usd and under EUR 30",
])
def test_foreign_currency_never_becomes_a_usd_ceiling(text):
    parsed = nlu.parse(text)
    assert parsed.budget_max is None
    assert parsed.budget_error and "USD" in parsed.budget_error


@pytest.mark.parametrize("text", ["SPF 50 sunscreen", "SPF50", "50 ml moisturizer"])
def test_attribute_numbers_are_not_budget_constraints(text):
    parsed = nlu.parse(text)
    assert parsed.budget_max is None and parsed.budget_error is None


@pytest.mark.parametrize("text", [
    "under-eye cream", "cream for under my eyes", "cream for under eyes",
    "maximum SPF 50 sunscreen", "max SPF50 sunscreen",
])
def test_nonmonetary_uses_of_budget_words_do_not_block_shopping(text):
    parsed = nlu.parse(text)
    assert parsed.budget_max is None and parsed.budget_error is None


@pytest.mark.parametrize("text", ["under EUR40", "under$unknown", "under $NaN"])
def test_explicit_money_still_requires_a_supported_valid_usd_amount(text):
    parsed = nlu.parse(text)
    assert parsed.budget_max is None and parsed.budget_error


@pytest.fixture
def catalog(monkeypatch):
    products = {}
    for pid, price, attributes in [
        ("cheap", 12, {"fragrance_free": True, "hydrating": True}),
        ("boundary", 25, {"fragrance_free": True, "hydrating": True}),
        ("expensive", 30, {"fragrance_free": True, "hydrating": True}),
        ("scented", 10, {"fragrance_free": False}),
        ("unknown", 8, {}),
        ("acid", 20, {"fragrance_free": True, "key_ingredient": "Salicylic Acid"}),
    ]:
        products[pid] = Product(
            id=pid, title=f"Fixture {pid}", brand="Fixture", price=price,
            image="/static/products/fixture.svg", subcategory="moisturizer",
            attributes=attributes, rating_listed=4, review_count=30,
            summary="Private fixture", merchant_id="approved",
        )
    store = Store(products=products, merchants={
        "approved": Merchant(id="approved", name="Fixture Shop", verified=True),
    })
    store.trust["cheap"] = TrustReport(
        product_id="cheap", score=90, tier="trusted", rating_listed=4, rating_adjusted=4,
        signals=[], top_reasons=["Synthetic fixture"], evidence_review_ids=["fixture-review"],
    )
    monkeypatch.setattr(tools, "store", store)
    monkeypatch.setattr(search, "_ranker", search.Ranker(store, embedder=("hashed-ngrams", hashed_matrix)))
    return store


def test_profile_case_and_synonyms_apply_at_search_without_mutating_saved_profile(catalog):
    profile = PreferenceProfile(
        needs=["HYDRATION", "Fragrance-Free"], avoid=["PERFUME", " Salicylic_Acid ", ""],
        skin_type=" DRY ",
    )
    before = profile.model_dump()
    session = Session(id="fixture-session", profile=profile)

    results, removed, effective = tools.run_search_with_stats(session, tools.SearchArgs())

    assert {p.id for p in results} == {"cheap", "boundary", "expensive"}
    assert removed == {"avoid": 3}
    assert effective.needs == ["hydrating"]
    assert effective.avoid == ["fragrance", "salicylic acid"]
    assert effective.skin_type == "dry"
    assert session.profile.model_dump() == before


def test_avoid_restrictions_after_twentieth_entry_are_not_silently_dropped(catalog):
    profile = PreferenceProfile(avoid=[f"fixture ingredient {i}" for i in range(20)] + ["SALICYLIC-ACID"])
    results = tools.run_search(None, tools.SearchArgs(), profile=profile)
    assert "acid" not in {p.id for p in results}


@pytest.mark.parametrize("avoid", ["Fragrance", "PERFUME", "scent", " fragrANCES "])
def test_direct_ranker_also_respects_avoid_canonicalization(catalog, avoid):
    results = search.ranker().search(search.SearchRequest(), PreferenceProfile(avoid=[avoid]))
    assert "scented" not in {p.id for p in results}
    assert "unknown" not in {p.id for p in results}


def test_budget_trace_uses_query_ceiling_and_clears_hidden_focus(catalog):
    session = Session(id="fixture-session", profile=PreferenceProfile(budget_max=40), focused_id="expensive")
    outcome = tools.search_products(session, tools.SearchArgs(query="moisturizer under $25"))
    budget_trace = next(t for t in outcome.traces if "budget" in t.why)

    assert "$25" in budget_trace.why and "$40" not in budget_trace.why
    assert session.focused_id is None
    assert "expensive" not in session.last_results
    assert session.profile.budget_max == 40


def test_budget_trace_uses_tightest_query_request_profile_and_signed_limit(catalog):
    session = Session(id="fixture-session", profile=PreferenceProfile(budget_max=40))
    session.intent_mandate = IntentMandate(
        session_id=session.id, budget_max=15, categories=["moisturizer"], issued_at="2026-10-17T00:00:00Z",
    )
    outcome = tools.search_products(session, tools.SearchArgs(query="under $25", max_price=20))
    budget_trace = next(t for t in outcome.traces if "budget" in t.why)
    assert "$15" in budget_trace.why
    assert all(item["price"] <= 15 for item in outcome.result["results"])


@pytest.mark.parametrize("query", ["moisturizer under €40", "moisturizer under $1,00"])
def test_unsupported_budget_cannot_silently_become_unconstrained_search(catalog, query):
    session = Session(id="fixture-session", last_results=["cheap"], focused_id="cheap")
    with pytest.raises(ValueError, match="USD"):
        tools.search_products(session, tools.SearchArgs(query=query))
    assert session.last_results == ["cheap"] and session.focused_id == "cheap"


def test_trust_tool_explicitly_labels_current_evidence_as_synthetic(catalog):
    session = Session(id="fixture-session")
    result = tools.get_trust(session, tools.ProductArg(product_id="cheap")).result
    assert result["score"] == 90
    assert result["data_source"] == "synthetic_demo_reviews"
    assert result["catalog_source"] == "fictional_demo_catalog"
    assert result["evidence_is_synthetic"] is True
    assert "security_flags" not in result  # No raw injection excerpt reaches the LLM.


def test_unknown_boolean_or_spf_attribute_does_not_become_positive_evidence(catalog):
    product = catalog.products["unknown"]
    product.attributes = {"fragrance_free": "false", "hydrating": "false", "spf": "unknown"}
    assert nlu.violates_avoid(product, "Fragrance")
    assert not nlu.meets_need(product, "HYDRATION")
    assert not nlu.meets_need(product, "Sun Protection")
