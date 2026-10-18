from __future__ import annotations

from datetime import date, timedelta

from api.market.history import attach
from api.market.models import (
    MarketProduct,
    PlanItemIn,
    ScoreBreakdown,
    ScoredProduct,
    SynthesizeResponse,
)
from api.market.value_terms import score_product

CONDITION_SCORE = {"new": 1.0, "refurbished": 0.72, "used": 0.48}


def synthesize(item: PlanItemIn, products: list[MarketProduct], weights: dict[str, float] | None = None) -> SynthesizeResponse:
    hydrated = [attach(product) for product in products]
    valued = [score_product(product, item.name, hydrated) for product in hydrated]
    valued.sort(key=lambda row: (row.in_stock, row.score or 0), reverse=True)
    by_id = {product.id: product for product in hydrated}
    scored = [_as_scored(row, by_id.get(row.id)) for row in valued]
    best = scored[0] if scored else None
    method = "bang_per_buck * relevancy * trust_multiplier"
    used = weights or {
        "bang_per_buck": 1,
        "relevancy": 1,
        "trust_multiplier": 1,
    }
    if best is None or best.price is None:
        return SynthesizeResponse(
            summary=f"No priced listing for {item.name} yet.",
            image=None,
            dimensions=None,
            shipping_date=None,
            total_price=None,
            currency="USD",
            best=best,
            alternatives=scored[1:9],
            weights=used,
            method=method,
        )
    quantity = item.quantity if item.quantity > 0 else 1
    pack = f"{int(quantity)} × " if quantity > 1 else ""
    stock = "" if best.in_stock else " (out of stock)"
    return SynthesizeResponse(
        summary=f"{pack}{best.title} from {best.store}{stock}",
        image=best.image,
        dimensions=best.dimensions,
        shipping_date=_ship_date(best.shipping_days),
        total_price=round(best.price * quantity, 2),
        currency=best.currency,
        best=best,
        alternatives=scored[1:9],
        weights=used,
        method=method,
    )


def _as_scored(item, original: MarketProduct | None) -> ScoredProduct:
    base = original.model_dump() if original else item.model_dump()
    base.update({
        "bang_per_buck": item.bang_per_buck,
        "relevancy": item.relevancy,
        "trust": item.trust,
        "initial_value": item.initial_value,
        "trust_multiplier": item.trust_multiplier,
        "score": item.score,
        "flags": item.flags,
    })
    scores = ScoreBreakdown(
        value=item.bang_per_buck,
        trust=item.trust,
        shipping=0.95 if item.prime else 0.4,
        availability=1.0 if item.in_stock else 0.05,
        fit=item.relevancy,
        condition=CONDITION_SCORE.get(item.condition, 0.6),
        completeness=item.trust_multiplier or 0,
        total=item.score or 0,
        flags=item.flags,
    )
    return ScoredProduct(**base, scores=scores)


def _ship_date(days: int | None) -> str | None:
    if days is None:
        return None
    return (date.today() + timedelta(days=days)).isoformat()
