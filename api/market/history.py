"""Past price-change series. CamelCamelCamel (Amazon) and CamelMart (Walmart)."""

from __future__ import annotations

from api.market.models import MarketProduct, PriceChange, PriceHistory

# Fixture series keyed by ASIN / Walmart id. Live fetch is TODO behind Selenium.
_SERIES: dict[str, PriceHistory] = {
    "B00COLEMAN": PriceHistory(
        source="camel", current=79.99, low=59.00, high=99.00, avg_90=72.00, last_drop="2026-09-12",
        changes=[
            PriceChange(date="2026-07-01", price=89.00),
            PriceChange(date="2026-08-15", price=79.99),
            PriceChange(date="2026-09-12", price=69.00),
            PriceChange(date="2026-10-01", price=79.99),
        ],
    ),
    "W123TENT": PriceHistory(
        source="camelmart", current=49.00, low=39.00, high=59.00, avg_90=47.00, last_drop="2026-08-20",
        changes=[
            PriceChange(date="2026-06-01", price=54.00),
            PriceChange(date="2026-08-20", price=39.00),
            PriceChange(date="2026-10-01", price=49.00),
        ],
    ),
}


def lookup(product: MarketProduct) -> PriceHistory:
    if product.marketplace == "amazon" and product.asin and product.asin in _SERIES:
        return _SERIES[product.asin]
    if product.marketplace == "walmart" and product.walmart_id and product.walmart_id in _SERIES:
        return _SERIES[product.walmart_id]
    if product.price is None:
        return PriceHistory(source="none")
    # Synthetic 90-day band so bang-per-buck still has a hist_ref on fixtures.
    price = product.price
    return PriceHistory(
        source="none",
        current=price,
        low=round(price * 0.82, 2),
        high=round(price * 1.18, 2),
        avg_90=round(price * 0.96, 2),
        changes=[
            PriceChange(date="2026-08-01", price=round(price * 1.05, 2)),
            PriceChange(date="2026-09-15", price=round(price * 0.94, 2)),
            PriceChange(date="2026-10-10", price=price),
        ],
    )


def attach(product: MarketProduct) -> MarketProduct:
    return product.model_copy(update={"history": lookup(product)})
