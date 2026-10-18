"""Keep ~50 most relevant listings per marketplace, then optional price/brand filters."""

from __future__ import annotations

from collections import defaultdict

from api.market.history import attach
from api.market.models import MarketProduct
from api.market.value_terms import apply_filters, score_product
from api.market.valued import ValuedItem


def recall_scored(
    products: list[MarketProduct],
    query: str,
    per_site: int = 50,
    trust_floor: float = 0.5,
    min_price: float | None = None,
    max_price: float | None = None,
    brands_include: list[str] | None = None,
    brands_exclude: list[str] | None = None,
) -> list[ValuedItem]:
    with_history = [attach(product) for product in products]
    scored = [score_product(product, query, with_history, trust_floor) for product in with_history]
    by_site: dict[str, list[ValuedItem]] = defaultdict(list)
    for item in scored:
        by_site[item.marketplace or "amazon"].append(item)
    pool: list[ValuedItem] = []
    for rows in by_site.values():
        rows.sort(key=lambda row: row.relevancy, reverse=True)
        pool.extend(rows[:per_site])
    return apply_filters(pool, min_price, max_price, brands_include, brands_exclude)
