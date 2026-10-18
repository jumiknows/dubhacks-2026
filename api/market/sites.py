from __future__ import annotations

import re
from urllib.parse import quote_plus, urljoin

from api.market.models import MarketProduct, Marketplace
from api.market.parse import (
    first_attr,
    first_text,
    parse_price,
    product_ld,
    rating_from_text,
    reviews_from_text,
    shipping_days,
    soup,
)

SEARCH_URLS = {
    "amazon": "https://www.amazon.com/s?k={q}",
    "ebay": "https://www.ebay.com/sch/i.html?_nkw={q}",
    "walmart": "https://www.walmart.com/search?q={q}",
}

LISTING_SELECTORS = {
    "amazon": ["div[data-component-type='s-search-result'] h2 a", "h2 a.a-link-normal"],
    "ebay": ["ul.srp-results li.s-item a.s-item__link", "a.s-item__link"],
    "walmart": ["a[link-identifier='itemTitle']", "a[href*='/ip/']"],
}


def search_url(marketplace: Marketplace, query: str) -> str:
    return SEARCH_URLS[marketplace].format(q=quote_plus(query))


def listing_urls(marketplace: Marketplace, html: str, limit: int) -> list[str]:
    doc = soup(html)
    urls: list[str] = []
    seen: set[str] = set()
    for selector in LISTING_SELECTORS[marketplace]:
        for node in doc.select(selector):
            href = node.get("href")
            if not href:
                continue
            url = urljoin(SEARCH_URLS[marketplace], str(href).split("?")[0] if marketplace != "ebay" else str(href))
            if url in seen or url.startswith("javascript:"):
                continue
            seen.add(url)
            urls.append(url)
            if len(urls) >= limit:
                return urls
    return urls


def parse_product(marketplace: Marketplace, html: str, url: str, query: str) -> MarketProduct:
    # TODO: ASIN / Walmart id / eBay id, spec table → dict, review histogram + quotes, sold-by vs ships-from
    data = product_ld(html) or {}
    offers = data.get("offers") or {}
    if isinstance(offers, list):
        offers = offers[0] if offers else {}
    doc = soup(html)
    title = data.get("name") or _title(marketplace, doc) or query
    price = _ld_price(offers) or _price(marketplace, doc)
    image = _image(data) or _image_el(marketplace, doc)
    rating = _ld_rating(data) or _rating(marketplace, doc)
    reviews = _ld_reviews(data) or _reviews(marketplace, doc)
    ship_text = _shipping(marketplace, doc)
    seller = _seller(marketplace, doc, data)
    asin, walmart_id, ebay_id = _listing_ids(marketplace, url)
    return MarketProduct(
        id=f"{marketplace}-{abs(hash(url)) % 10_000_000}",
        store=_store(marketplace),
        title=str(title)[:180],
        brand=_brand(data),
        price=price,
        image=image,
        url=url,
        dimensions=_dimensions(doc),
        shipping_days=shipping_days(ship_text),
        in_stock=_in_stock(marketplace, doc, offers),
        rating=rating,
        review_count=reviews,
        seller=seller,
        condition=_condition(doc, data),
        prime="prime" in (ship_text or "").lower() or marketplace == "amazon" and bool(doc.select_one(".a-icon-prime")),
        query=query,
        marketplace=marketplace,
        specs=_specs(doc),
        asin=asin,
        walmart_id=walmart_id,
        ebay_id=ebay_id,
    )


def _listing_ids(marketplace: Marketplace, url: str) -> tuple[str | None, str | None, str | None]:
    asin = walmart_id = ebay_id = None
    if marketplace == "amazon":
        match = re.search(r"/(?:dp|gp/product)/([A-Z0-9]{10})", url or "", re.I)
        asin = match.group(1).upper() if match else None
    elif marketplace == "walmart":
        match = re.search(r"/ip/[^/]+/(\d+)", url or "")
        walmart_id = match.group(1) if match else None
    elif marketplace == "ebay":
        match = re.search(r"/itm/(?:[^/]+/)?(\d+)", url or "")
        ebay_id = match.group(1) if match else None
    return asin, walmart_id, ebay_id


def _brand(data: dict) -> str | None:
    brand = data.get("brand")
    if isinstance(brand, dict):
        name = brand.get("name")
        return str(name) if name else None
    return brand if isinstance(brand, str) else None


def _specs(doc) -> dict[str, str]:
    specs: dict[str, str] = {}
    for row in doc.select("table.a-normal tr, table.prodDetTable tr, .ux-layout-section-evo tr"):
        cells = row.find_all(["th", "td"])
        if len(cells) < 2:
            continue
        key = cells[0].get_text(" ", strip=True)
        value = cells[1].get_text(" ", strip=True)
        if key and value:
            specs[key[:40]] = value[:80]
        if len(specs) >= 8:
            break
    return specs


def _store(marketplace: Marketplace) -> str:
    return {"amazon": "Amazon", "ebay": "eBay", "walmart": "Walmart"}[marketplace]


def _ld_price(offers: dict) -> float | None:
    return parse_price(str(offers.get("price") or offers.get("lowPrice") or ""))


def _ld_rating(data: dict) -> float | None:
    agg = data.get("aggregateRating") or {}
    try:
        return float(agg.get("ratingValue"))
    except (TypeError, ValueError):
        return None


def _ld_reviews(data: dict) -> int:
    agg = data.get("aggregateRating") or {}
    try:
        return int(agg.get("reviewCount") or agg.get("ratingCount") or 0)
    except (TypeError, ValueError):
        return 0


def _image(data: dict) -> str | None:
    image = data.get("image")
    if isinstance(image, list) and image:
        image = image[0]
    if isinstance(image, dict):
        image = image.get("url")
    return image if isinstance(image, str) else None


def _title(marketplace: Marketplace, doc) -> str | None:
    selectors = {
        "amazon": ["#productTitle", "h1"],
        "ebay": ["h1.x-item-title__mainTitle", "h1"],
        "walmart": ["h1", "[itemprop='name']"],
    }[marketplace]
    return first_text(doc, selectors)


def _price(marketplace: Marketplace, doc) -> float | None:
    selectors = {
        "amazon": [".a-price .a-offscreen", "#priceblock_ourprice"],
        "ebay": [".x-price-primary", "[itemprop='price']"],
        "walmart": ["[itemprop='price']", "[data-testid='price-wrap']"],
    }[marketplace]
    return parse_price(first_text(doc, selectors) or first_attr(doc, ["[itemprop='price']"], "content"))


def _image_el(marketplace: Marketplace, doc) -> str | None:
    selectors = {
        "amazon": ["#landingImage", "#imgTagWrapperId img"],
        "ebay": [".ux-image-carousel-item img", "img[src*='i.ebayimg']"],
        "walmart": ["img[data-testid='hero-image']", "img"],
    }[marketplace]
    return first_attr(doc, selectors, "src") or first_attr(doc, selectors, "data-old-hires")


def _rating(marketplace: Marketplace, doc) -> float | None:
    selectors = {
        "amazon": ["#acrPopover", "span.a-icon-alt"],
        "ebay": [".x-star-rating", "[itemprop='ratingValue']"],
        "walmart": ["[itemprop='ratingValue']", "[data-testid='ratings']"],
    }[marketplace]
    return rating_from_text(first_text(doc, selectors) or first_attr(doc, selectors, "content"))


def _reviews(marketplace: Marketplace, doc) -> int:
    selectors = {
        "amazon": ["#acrCustomerReviewText"],
        "ebay": [".x-star-rating", "[itemprop='reviewCount']"],
        "walmart": ["[itemprop='reviewCount']"],
    }[marketplace]
    return reviews_from_text(first_text(doc, selectors) or first_attr(doc, selectors, "content"))


def _shipping(marketplace: Marketplace, doc) -> str | None:
    selectors = {
        "amazon": ["#mir-layout-DELIVERY_BLOCK", "#deliveryMessageMirId", "#amazonGlobal_feature_div"],
        "ebay": [".d-shipping-minview", "[data-testid='ux-labels-values']"],
        "walmart": ["[data-testid='fulfillment-message']", "[data-testid='shipping-message']"],
    }[marketplace]
    return first_text(doc, selectors)


def _seller(marketplace: Marketplace, doc, data: dict) -> str | None:
    brand = data.get("brand")
    if isinstance(brand, dict):
        brand = brand.get("name")
    if isinstance(brand, str) and brand:
        return brand
    selectors = {
        "amazon": ["#sellerProfileTriggerId", "#bylineInfo"],
        "ebay": [".x-sellercard-atf__info__about-seller a", ".mbg-nw"],
        "walmart": ["[data-testid='seller-name']"],
    }[marketplace]
    return first_text(doc, selectors)


def _in_stock(marketplace: Marketplace, doc, offers: dict) -> bool:
    availability = str(offers.get("availability") or "")
    if "OutOfStock" in availability:
        return False
    text = (first_text(doc, ["#availability", "[data-testid='out-of-stock']", ".vi-qty-pur-link"]) or "").lower()
    if "out of stock" in text or "unavailable" in text:
        return False
    return True


def _dimensions(doc) -> dict | None:
    dimension_terms = ("dimension", "product size", "item size", "package size", "size")
    for row in doc.select("table tr, .ux-layout-section-evo tr, [data-testid*='spec'] tr"):
        cells = row.find_all(["th", "td"])
        if len(cells) < 2:
            continue
        key = cells[0].get_text(" ", strip=True)
        value = cells[1].get_text(" ", strip=True)
        if key and value and any(term in key.lower() for term in dimension_terms):
            return {"label": f"{key}: {value}"[:120]}

    text = first_text(doc, ["#productDetails_techSpec_section_1", "#detailBullets_feature_div", ".ux-layout-section-evo"])
    if text:
        flattened = " ".join(text.split())
        match = re.search(r"((?:item|package|product)?\s*dimensions?|size)\s*[:\-]?\s*([^|·]{2,80})", flattened, re.I)
        if match:
            return {"label": f"{match.group(1).strip()}: {match.group(2).strip()}"[:120]}
    return None


def _condition(doc, data: dict) -> str:
    text = f"{data.get('itemCondition', '')} {first_text(doc, ['.x-item-condition-text', '#newAccordionCaption_feature_div']) or ''}".lower()
    if "used" in text:
        return "used"
    if "refurb" in text:
        return "refurbished"
    return "new"
