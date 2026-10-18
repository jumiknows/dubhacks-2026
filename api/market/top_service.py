"""Rank a scored catalog into a short top list. Value terms are already on each item."""

from __future__ import annotations

from pydantic import BaseModel, Field

from api.market.value_terms import apply_filters
from api.market.valued import ValuedItem, rank


class TopRequest(BaseModel):
    items: list[ValuedItem]
    limit: int = Field(default=10, ge=1, le=25)
    trust_floor: float = Field(default=0.5, ge=0, le=1)
    min_price: float | None = None
    max_price: float | None = None
    brands_include: list[str] = []
    brands_exclude: list[str] = []


class TopResponse(BaseModel):
    items: list[ValuedItem]
    count: int
    trust_floor: float
    method: str = "bang_per_buck * relevancy * trust_multiplier"


def top_items(
    items: list[ValuedItem],
    limit: int = 10,
    trust_floor: float = 0.5,
    min_price: float | None = None,
    max_price: float | None = None,
    brands_include: list[str] | None = None,
    brands_exclude: list[str] | None = None,
) -> TopResponse:
    filtered = apply_filters(items, min_price, max_price, brands_include, brands_exclude)
    mixed = _spread_sites(rank(filtered, trust_floor), limit)
    return TopResponse(items=mixed, count=len(mixed), trust_floor=trust_floor)


def _spread_sites(items: list[ValuedItem], limit: int) -> list[ValuedItem]:
    buckets: dict[str, list[ValuedItem]] = {}
    for item in items:
        buckets.setdefault(item.marketplace or "other", []).append(item)
    out: list[ValuedItem] = []
    while len(out) < limit and any(buckets.values()):
        for site in list(buckets):
            if buckets[site] and len(out) < limit:
                out.append(buckets[site].pop(0))
            if not buckets[site]:
                buckets.pop(site, None)
    return out
