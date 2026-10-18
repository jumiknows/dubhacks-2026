"""Finish a listing whose bang-per-buck, relevancy, and trust are already known."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field


class ValuedItem(BaseModel):
    model_config = ConfigDict(extra="allow")

    id: str
    title: str = ""
    store: str = ""
    url: str | None = None
    price: float | None = None
    in_stock: bool = True
    bang_per_buck: float = Field(ge=0)  # TODO: compute from landed price + Camel/CamelMart hist_ref
    relevancy: float = Field(default=1.0, ge=0)  # TODO: spec/prompt match; 1.0 is a stub
    trust: float = Field(ge=0, le=1)  # TODO: histogram, verified share, review bursts, aspect_fit
    initial_value: float | None = None
    trust_multiplier: float | None = None
    score: float | None = None
    flags: list[str] = []
    brand: str | None = None
    specs: dict[str, str] = {}
    marketplace: str | None = None
    history: dict | None = None
    condition: str = "new"
    rating: float | None = None
    review_count: int = 0
    prime: bool = False
    shipping_days: int | None = None
    image: str | None = None
    currency: str = "USD"
    asin: str | None = None
    walmart_id: str | None = None
    ebay_id: str | None = None
    query: str = ""
    dimensions: dict | None = None
    seller: str | None = None
    seller_rating: float | None = None
    coupon: float = 0
    shipping_fee: float = 0


def trust_multiplier(trust: float, trust_floor: float) -> float:
    floor = min(1.0, max(0.0, trust_floor))
    t = min(1.0, max(0.0, trust))
    return floor + (1.0 - floor) * t


def finish(item: ValuedItem, trust_floor: float = 0.5) -> ValuedItem:
    """Apply score = (bang_per_buck × relevancy) × trust_multiplier. Does not recompute value terms."""
    # TODO: persist trust_floor on the session/profile instead of only on the request.
    bang = item.bang_per_buck
    relevancy = item.relevancy
    initial = bang * relevancy if item.initial_value is None else item.initial_value
    mult = trust_multiplier(item.trust, trust_floor)
    return item.model_copy(update={
        "initial_value": round(initial, 4),
        "trust_multiplier": round(mult, 4),
        "score": round(initial * mult, 4),
    })


def rank(items: list[ValuedItem], trust_floor: float = 0.5) -> list[ValuedItem]:
    finished = [finish(item, trust_floor) for item in items]
    finished.sort(key=lambda row: (row.in_stock, row.score or 0), reverse=True)
    return finished
