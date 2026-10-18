from __future__ import annotations

import logging

from api.config import get_settings
from api.market import browser, fixtures, sites
from api.market.models import MarketProduct, Marketplace, SearchRequest, SearchResponse
from api.market.recall import recall_scored
from api.market.valued import ValuedItem

log = logging.getLogger(__name__)


def search_products(req: SearchRequest) -> SearchResponse:
    settings = get_settings()
    markets = req.marketplaces or ["amazon", "ebay", "walmart"]
    cap = min(req.limit, settings.scrape_limit)
    errors: list[str] = []
    source = "fixture"
    if settings.selenium_enabled:
        products, errors = _live(markets, req.query, cap, req.details)
        source = "selenium" if products else "fixture"
        if not products:
            products = fixtures.for_query(req.query, markets, cap)
    else:
        products = fixtures.for_query(req.query, markets, cap)

    valued = recall_scored(
        products,
        req.query,
        per_site=cap,
        min_price=req.min_price,
        max_price=req.max_price,
        brands_include=req.brands_include,
        brands_exclude=req.brands_exclude,
    )
    return SearchResponse(query=req.query, source=source, products=[_as_market(item) for item in valued], errors=errors)


def fetch_details(urls: list[str], query: str) -> list[MarketProduct]:
    products: list[MarketProduct] = []
    for url in urls:
        market = _market_from_url(url)
        if market is None:
            continue
        html = browser.fetch_html(url)
        products.append(sites.parse_product(market, html, url, query))
    return products


def _live(markets: list[Marketplace], query: str, cap: int, details: bool) -> tuple[list[MarketProduct], list[str]]:
    products: list[MarketProduct] = []
    errors: list[str] = []
    for market in markets:
        try:
            html = browser.fetch_html(sites.search_url(market, query))
            urls = sites.listing_urls(market, html, cap)
            if not details:
                for url in urls:
                    products.append(MarketProduct(
                        id=f"{market}-{abs(hash(url)) % 10_000_000}",
                        store={"amazon": "Amazon", "ebay": "eBay", "walmart": "Walmart"}[market],
                        title=query,
                        url=url,
                        query=query,
                        marketplace=market,
                    ))
                continue
            for url in urls:
                try:
                    page = browser.fetch_html(url)
                    products.append(sites.parse_product(market, page, url, query))
                except Exception as exc:
                    log.warning("detail fetch failed %s: %s", url, exc)
                    errors.append(f"{market} detail: {exc}")
        except Exception as exc:
            log.warning("search failed %s %s: %s", market, query, exc)
            errors.append(f"{market}: {exc}")
    return products, errors


def _as_market(item: ValuedItem) -> MarketProduct:
    data = item.model_dump()
    allowed = set(MarketProduct.model_fields)
    payload = {key: data[key] for key in allowed if key in data}
    payload["id"] = item.id
    payload["store"] = item.store
    payload["title"] = item.title
    return MarketProduct(**payload)


def _market_from_url(url: str) -> Marketplace | None:
    host = url.lower()
    if "amazon." in host:
        return "amazon"
    if "ebay." in host:
        return "ebay"
    if "walmart." in host:
        return "walmart"
    return None
