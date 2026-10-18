"""Compute bang-per-buck, relevancy, and trust from a listing. History is past price changes."""

from __future__ import annotations

import math
import re
from statistics import median

from api.market.models import MarketProduct
from api.market.valued import ValuedItem, finish

LOWER_BETTER = {"weight", "packed size", "price", "shipping"}


def landed(product: MarketProduct) -> float | None:
    if product.price is None:
        return None
    return max(0.0, product.price - (product.coupon or 0) + (product.shipping_fee or 0))


def relevancy(query: str, product: MarketProduct) -> float:
    title_tokens = _overlap(query, f"{product.title} {product.brand or ''}")
    spec_match = _spec_match(query, product.specs) if product.specs else title_tokens
    constraint = _constraint_ok(query, product)
    bundle = 1.0 if any(token in (product.title + " ".join(product.specs.values())).lower()
                        for token in ("include", "kit", "bundle", "stakes", "charger")) else 0.55
    return _clip(0.45 * spec_match + 0.25 * title_tokens + 0.15 * constraint + 0.15 * bundle)


def bang_per_buck(product: MarketProduct, cohort: list[MarketProduct]) -> tuple[float, list[str]]:
    flags: list[str] = []
    cost = landed(product)
    if cost is None or cost <= 0:
        return 0.35, flags
    hist = product.history
    hist_ref = None
    if hist and hist.avg_90:
        hist_ref = max(hist.avg_90, (hist.low or hist.avg_90) * 1.05)
        if hist.avg_90 and cost > 1.1 * hist.avg_90:
            flags.append("above-typical")
        if hist.low and hist.low > 0 and abs(cost - hist.low) / hist.low <= 0.05:
            flags.append("near-low")
        if hist.changes and len(hist.changes) >= 2 and hist.changes[-1].price > hist.changes[-2].price:
            flags.append("price-spike")
        if hist.changes and len(hist.changes) >= 2 and hist.changes[-1].price < hist.changes[-2].price:
            flags.append("price-drop")
    prices = [landed(row) for row in cohort if landed(row)]
    peer = median(prices) if prices else cost
    if cost < 0.4 * peer:
        flags.append("too-cheap")
    ref = hist_ref or peer
    deal = ref / cost
    utility = _spec_utility(product)
    return _clip(deal * utility, 0.05, 1.0), flags


def trust(product: MarketProduct) -> float:
    rating = (product.rating or 0) / 5
    volume = math.log(1 + (product.review_count or 0)) / math.log(1 + 2000)
    volume = min(1.0, volume)
    seller = ((product.seller_rating or product.rating or 3.5) / 5) if product.seller else 0.45
    known = 0.1 if product.store in {"Amazon", "Walmart"} else 0.0
    score = 0.35 * rating + 0.20 * volume + 0.15 * seller + 0.15 * 0.7 + 0.15 * rating + known
    if (product.review_count or 0) < 15:
        score *= 0.85
    return _clip(score)


def score_product(product: MarketProduct, query: str, cohort: list[MarketProduct], trust_floor: float = 0.5) -> ValuedItem:
    rel = relevancy(query, product)
    bang, flags = bang_per_buck(product, cohort)
    tr = trust(product)
    valued = ValuedItem(
        id=product.id,
        title=product.title,
        store=product.store,
        url=product.url,
        price=product.price,
        in_stock=product.in_stock,
        bang_per_buck=bang,
        relevancy=rel,
        trust=tr,
        flags=flags,
        brand=product.brand,
        specs=product.specs,
        history=product.history.model_dump() if product.history else None,
        marketplace=product.marketplace,
        condition=product.condition,
        rating=product.rating,
        review_count=product.review_count,
        prime=product.prime,
        shipping_days=product.shipping_days,
        image=product.image,
        currency=product.currency,
        asin=product.asin,
        walmart_id=product.walmart_id,
        ebay_id=product.ebay_id,
        query=product.query,
        dimensions=product.dimensions,
        seller=product.seller,
        seller_rating=product.seller_rating,
        coupon=product.coupon,
        shipping_fee=product.shipping_fee,
    )
    return finish(valued, trust_floor)


def apply_filters(
    items: list[ValuedItem],
    min_price: float | None = None,
    max_price: float | None = None,
    brands_include: list[str] | None = None,
    brands_exclude: list[str] | None = None,
) -> list[ValuedItem]:
    include = {name.lower() for name in (brands_include or []) if name}
    exclude = {name.lower() for name in (brands_exclude or []) if name}
    kept: list[ValuedItem] = []
    for item in items:
        price = item.price
        if min_price is not None and (price is None or price < min_price):
            continue
        if max_price is not None and (price is None or price > max_price):
            continue
        brand = (item.brand or "").lower()
        if include and brand not in include:
            continue
        if exclude and brand in exclude:
            continue
        kept.append(item)
    return kept


def _overlap(query: str, text: str) -> float:
    q = {token for token in _tokens(query) if len(token) > 2}
    t = set(_tokens(text))
    if not q:
        return 0.5
    return _clip(len(q & t) / len(q))


def _spec_match(query: str, specs: dict[str, str]) -> float:
    blob = " ".join(specs.keys()) + " " + " ".join(specs.values())
    return _overlap(query, blob)


def _constraint_ok(query: str, product: MarketProduct) -> float:
    q = query.lower()
    if "not used" in q or "new only" in q or re.search(r"\bnew\b", q):
        if product.condition != "new":
            return 0.0
    if "not refurbished" in q and product.condition == "refurbished":
        return 0.0
    return 1.0


def _spec_utility(product: MarketProduct) -> float:
    if not product.specs:
        return 0.85
    return 0.9


def _tokens(text: str) -> list[str]:
    return re.findall(r"[a-z0-9]+", (text or "").lower().replace("-", " "))


def _clip(value: float, lo: float = 0.0, hi: float = 1.0) -> float:
    return max(lo, min(hi, value))
