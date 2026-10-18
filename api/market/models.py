from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

Marketplace = Literal["amazon", "ebay", "walmart"]


class PriceChange(BaseModel):
    date: str
    price: float


class PriceHistory(BaseModel):
    source: Literal["camel", "camelmart", "none"] = "none"
    current: float | None = None
    low: float | None = None
    high: float | None = None
    avg_90: float | None = None
    last_drop: str | None = None
    changes: list[PriceChange] = []


class MarketProduct(BaseModel):
    id: str
    store: str
    title: str
    price: float | None = None
    currency: str = "USD"
    image: str | None = None
    url: str | None = None
    dimensions: dict | None = None
    shipping_days: int | None = None
    in_stock: bool = True
    rating: float | None = None
    review_count: int = 0
    seller: str | None = None
    seller_rating: float | None = None
    condition: str = "new"
    prime: bool = False
    query: str = ""
    marketplace: Marketplace = "amazon"
    brand: str | None = None
    asin: str | None = None
    walmart_id: str | None = None
    ebay_id: str | None = None
    specs: dict[str, str] = {}
    coupon: float = 0
    shipping_fee: float = 0
    history: PriceHistory | None = None
    bang_per_buck: float | None = None
    relevancy: float | None = None
    trust: float | None = None
    initial_value: float | None = None
    trust_multiplier: float | None = None
    score: float | None = None
    flags: list[str] = []


class SearchRequest(BaseModel):
    query: str = Field(min_length=1, max_length=200)
    marketplaces: list[Marketplace] = ["amazon", "ebay", "walmart"]
    limit: int = Field(default=50, ge=1, le=50)
    details: bool = False
    min_price: float | None = None
    max_price: float | None = None
    brands_include: list[str] = []
    brands_exclude: list[str] = []


class SearchResponse(BaseModel):
    query: str
    source: Literal["selenium", "fixture"]
    products: list[MarketProduct]
    errors: list[str] = []


class DetailsRequest(BaseModel):
    urls: list[str] = Field(min_length=1, max_length=12)
    query: str = ""


class PlanItemIn(BaseModel):
    name: str
    quantity: float = 1
    unit: str | None = None
    reason: str | None = None


class ScoreBreakdown(BaseModel):
    value: float
    trust: float
    shipping: float
    availability: float
    fit: float
    condition: float
    completeness: float
    total: float
    flags: list[str] = []


class ScoredProduct(MarketProduct):
    scores: ScoreBreakdown


class SynthesizeRequest(BaseModel):
    item: PlanItemIn
    products: list[MarketProduct]
    weights: dict[str, float] | None = None


class SynthesizeResponse(BaseModel):
    summary: str
    image: str | None
    dimensions: dict | None
    shipping_date: str | None
    total_price: float | None
    currency: str
    best: ScoredProduct | None
    alternatives: list[ScoredProduct]
    weights: dict[str, float]
    method: str
