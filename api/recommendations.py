"""Request-local raw product recommendations. Never imports products into checkout."""

from __future__ import annotations

import re
from collections import Counter
from dataclasses import dataclass
from decimal import Decimal
from typing import Any, Literal

from fastapi import APIRouter
from pydantic import BaseModel, ConfigDict, Field, field_validator

from api import search
from api.normalization import NormalizationError, NormalizedProduct, normalize_attributes, normalize_product, parse_amount
from api.schemas import AttrValue, FitTerms, Merchant, PreferenceProfile, TrustReport
from api.store import Store

router = APIRouter()


class RecommendationRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    products: list[Any] = Field(max_length=100)
    query: str = Field(default="", max_length=300, description="Semantic query; provide hard constraints in the structured fields.")
    source_currency: str | None = None
    currency: Literal["USD"] = "USD"
    max_price: Decimal | None = Field(default=None, description="Inclusive USD unit product-price ceiling; excludes shipping and tax.")
    required_attributes: dict[str, AttrValue] = Field(default_factory=dict)
    avoided_attributes: dict[str, AttrValue] = Field(default_factory=dict)
    needs: list[str] = Field(default_factory=list, max_length=20)
    skin_type: str | None = None
    verified_only: bool = True
    limit: int = Field(default=6, ge=1, le=50)

    @field_validator("source_currency")
    @classmethod
    def valid_source_currency(cls, value: str | None) -> str | None:
        if value is not None and not re.fullmatch(r"[A-Za-z]{3}", value):
            raise ValueError("Expected a three-letter source currency.")
        return value.upper() if value else None

    @field_validator("max_price", mode="before")
    @classmethod
    def valid_budget(cls, value: Any) -> Decimal | None:
        return parse_amount(value, "USD")

    @field_validator("required_attributes", "avoided_attributes", mode="before")
    @classmethod
    def valid_constraints(cls, value: Any) -> dict[str, AttrValue]:
        if not isinstance(value, dict) or any(v is None for v in value.values()):
            raise ValueError("Attribute constraints require an object with explicit scalar values.")
        return normalize_attributes(value)


class RecordIssue(BaseModel):
    index: int
    product_id: str | None = None
    code: str
    field: str | None = None
    message: str


class Recommendation(BaseModel):
    product: NormalizedProduct
    fit_percent: int
    fit_terms: FitTerms
    reasons: list[str]
    trust_score: int | None = None
    warnings: list[str]
    total_price: Decimal | None = None


class RecommendationResponse(BaseModel):
    currency: Literal["USD"] = "USD"
    budget_scope: Literal["unit_product_price"] = "unit_product_price"
    normalized: list[NormalizedProduct]
    results: list[Recommendation]
    issues: list[RecordIssue]


@dataclass
class RecommendationCatalog:
    products: dict[str, NormalizedProduct]
    merchants: dict[str, Merchant]

    def trust_report(self, product_id: str) -> TrustReport | None:
        # An uploaded ID is not evidence that this is the reviewed catalog listing.
        return None

    def merchant_verified(self, merchant_id: str | None) -> bool:
        merchant = self.merchants.get(merchant_id) if merchant_id is not None else None
        return bool(merchant and merchant.verified)


def _matches(actual: AttrValue, expected: AttrValue) -> bool:
    if type(actual) is bool or type(expected) is bool:
        return type(actual) is type(expected) and actual == expected
    if type(actual) in (int, float) and type(expected) in (int, float):
        return Decimal(str(actual)) == Decimal(str(expected))
    return type(actual) is type(expected) and actual == expected


def _exclusion(p: NormalizedProduct, req: RecommendationRequest, store: Store) -> tuple[str, str] | None:
    if p.currency != req.currency:
        return "currency_mismatch", "Currency is unknown or differs from USD; no conversion was performed."
    if p.price is None:
        return "missing_price", "Unknown prices cannot be compared with a budget or other prices."
    if p.merchant_id not in store.merchants:
        return "unknown_merchant", "Merchant identifier is not in the server's approved catalog."
    if req.verified_only and not store.merchant_verified(p.merchant_id):
        return "merchant_not_approved", "Merchant does not pass the local catalog's verified-only rule."
    if p.in_stock is False:
        return "out_of_stock", "Source explicitly reports that this product is out of stock."
    if req.max_price is not None and p.price > req.max_price:
        return "over_budget", "Unit product price exceeds the maximum budget."
    for key, expected in req.required_attributes.items():
        if key not in p.attributes or not _matches(p.attributes[key], expected):
            return "required_attribute", "An explicitly required attribute is missing or does not match."
    for key, expected in req.avoided_attributes.items():
        if key in p.attributes and _matches(p.attributes[key], expected):
            return "avoided_attribute", "Source attributes explicitly match an avoided value."
    return None


def recommend_products(req: RecommendationRequest, store: Store, ranker: search.Ranker) -> RecommendationResponse:
    normalized: list[tuple[int, NormalizedProduct]] = []
    issues: list[RecordIssue] = []
    for index, raw in enumerate(req.products):
        try:
            normalized.append((index, normalize_product(raw, store.merchants, source_currency=req.source_currency)))
        except NormalizationError as exc:
            issues.append(RecordIssue(index=index, code="invalid_product", field=exc.field, message=str(exc)))

    counts = Counter(p.id for _, p in normalized)
    candidates: dict[str, NormalizedProduct] = {}
    for index, p in normalized:
        excluded = ("duplicate_id", "Every occurrence of this duplicate product ID was excluded.") if counts[p.id] > 1 else _exclusion(p, req, store)
        if excluded:
            issues.append(RecordIssue(index=index, product_id=p.id, code=excluded[0], message=excluded[1]))
        else:
            candidates[p.id] = p

    local = RecommendationCatalog(candidates, dict(store.merchants))
    scorer = ranker.with_catalog(local)
    # Explicit constraints were checked above; needs/skin type remain soft preferences.
    scores = scorer.score(
        search.SearchRequest(query=req.query, limit=req.limit),
        PreferenceProfile(needs=req.needs, skin_type=req.skin_type),
    )
    results: list[Recommendation] = []
    for score in scores:
        p = candidates[score.product_id]
        warnings = [
            "Trust evidence is unavailable; the trust ranking term uses the existing neutral fallback, not a measured score.",
            "Merchant approval uses local catalog flags; domain ownership has not been verified.",
        ]
        if p.in_stock is None:
            warnings.append("Stock status is unknown.")
        if p.delivery.estimated_arrival is None:
            warnings.append("Arrival date is unknown; shipping duration alone does not establish an arrival date.")
        for key in req.avoided_attributes:
            if key not in p.attributes:
                warnings.append(f"Avoided attribute '{key}' is unknown; absence has not been verified.")
        complete_cost = p.delivery.shipping_price is not None and p.delivery.tax is not None
        if not complete_cost:
            warnings.append("Shipping or tax is unknown; the unit product price is not a complete total.")
        results.append(Recommendation(
            product=p, fit_percent=score.fit_percent, fit_terms=score.fit_terms,
            reasons=score.reasons, warnings=warnings,
            total_price=p.price + p.delivery.shipping_price + p.delivery.tax if complete_cost else None,
        ))
    return RecommendationResponse(normalized=[p for _, p in normalized], results=results, issues=issues)


@router.post("/products/recommend", response_model=RecommendationResponse)
def products_recommend(req: RecommendationRequest) -> RecommendationResponse:
    from api.store import store

    return recommend_products(req, store, search.ranker())
