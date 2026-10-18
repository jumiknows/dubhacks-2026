from __future__ import annotations

from api.market.models import MarketProduct

SEEDS = [
    dict(query="tent", title="2-Person Tent", brand="Coleman", specs={"capacity": "2 person", "packed size": "7 x 22 in", "weight": "4.8 lb"},
         amazon=79.99, ebay=34.50, walmart=49.00),
    dict(query="sleeping bag", title="Sleeping Bag", brand="Teton", specs={"temp": "20 F", "weight": "3.1 lb"},
         amazon=54.99, ebay=28.00, walmart=24.88),
    dict(query="sleeping pad", title="Sleeping Pad", brand="Therm-a-Rest", specs={"r-value": "2.0", "packed size": "20 x 5 in"},
         amazon=55.00, ebay=22.00, walmart=30.00),
    dict(query="camp stove", title="Camp Stove", brand="MSR", specs={"weight": "2.6 oz"},
         amazon=45.00, ebay=18.00, walmart=22.00),
    dict(query="headlamp", title="LED Headlamp", brand="Petzl", specs={"lumens": "400"},
         amazon=40.00, ebay=12.00, walmart=12.00),
    dict(query="water filter", title="Water Filter", brand="Sawyer", specs={"weight": "3 oz"},
         amazon=45.00, ebay=19.00, walmart=28.00),
    dict(query="first aid", title="First Aid Kit", brand="Adventure Medical", specs={"pieces": "100"},
         amazon=15.00, ebay=8.00, walmart=9.00),
    dict(query="cooler", title="Cooler", brand="Igloo", specs={"capacity": "16 can"},
         amazon=30.00, ebay=18.00, walmart=30.00),
    dict(query="laptop", title="14-inch Laptop 16GB", brand="Lenovo", specs={"ram": "16GB", "storage": "512GB"},
         amazon=649.00, ebay=289.00, walmart=579.00),
    dict(query="invitation", title="Invitation Set", brand="Paper Source", specs={"size": "5 x 7 in"},
         amazon=18.00, ebay=9.00, walmart=12.00),
    dict(query="bouquet", title="Mixed Bouquet", brand="FiftyFlowers", specs={"stems": "24"},
         amazon=45.00, ebay=20.00, walmart=32.00),
    dict(query="cake", title="Celebration Cake", brand="Costco", specs={"size": "8 in"},
         amazon=35.00, ebay=22.00, walmart=28.00),
    dict(query="milk", title="Whole Milk", brand="Organic Valley", specs={"size": "1 gal"},
         amazon=4.49, ebay=3.99, walmart=3.19),
    dict(query="laptop", title="Headphones", brand="Sony", specs={"type": "over-ear"},
         amazon=89.00, ebay=45.00, walmart=69.00),
]

BRANDS = {
    "amazon": ["Coleman", "REI", "Kelty", "MSR", "The North Face", "NEMO", "Big Agnes", "Osprey"],
    "ebay": ["Unbranded", "Generic", "gear-lot", "camp-deals", "refurb-hub", "outdoor-box"],
    "walmart": ["Ozark Trail", "Mainstays", "Hyper Tough", "Better Homes", "Equate", "Great Value"],
}

STORES = {"amazon": "Amazon", "ebay": "eBay", "walmart": "Walmart"}


def _variants(seed: dict, marketplace: str, count: int) -> list[MarketProduct]:
    brand_cycle = BRANDS[marketplace]
    base_price = seed[marketplace]
    rows: list[MarketProduct] = []
    for index in range(count):
        brand = seed["brand"] if index == 0 else brand_cycle[index % len(brand_cycle)]
        price = round(base_price * (0.72 + (index % 17) * 0.04), 2)
        used = marketplace == "ebay" and index % 4 == 0
        asin = f"B00{seed['query'][:4].upper()}{index:02d}" if marketplace == "amazon" else None
        walmart_id = f"W{index:05d}{seed['query'][:3].upper()}" if marketplace == "walmart" else None
        if index == 0 and marketplace == "amazon" and seed["query"] == "tent":
            asin = "B00COLEMAN"
        if index == 0 and marketplace == "walmart" and seed["query"] == "tent":
            walmart_id = "W123TENT"
        rows.append(MarketProduct(
            id=f"{marketplace}-{seed['query'].replace(' ', '-')}-{index}",
            store=STORES[marketplace],
            title=f"{brand} {seed['title']}" + (" Used" if used else ""),
            brand=brand,
            price=price,
            image=f"/static/products/p{(index % 20) + 1:02d}.svg",
            url=f"https://www.{marketplace}.com/item/{index}",
            dimensions={"label": seed["specs"].get("packed size") or seed["specs"].get("size") or "see specs"},
            shipping_days=2 if marketplace == "amazon" else 4 + index % 5,
            rating=round(min(5.0, 3.6 + (index % 9) * 0.15), 2),
            review_count=40 + index * 37 + (12000 if index == 0 and marketplace == "amazon" else 0),
            seller=STORES[marketplace] if marketplace != "ebay" else brand,
            seller_rating=4.8 if marketplace != "ebay" else 4.0,
            condition="used" if used else "new",
            prime=marketplace == "amazon" and index % 3 != 2,
            query=seed["query"],
            marketplace=marketplace,  # type: ignore[arg-type]
            specs=dict(seed["specs"]),
            asin=asin,
            walmart_id=walmart_id,
            in_stock=index != 13,
        ))
    return rows


FIXTURES: list[MarketProduct] = []
for seed in SEEDS:
    for market in ("amazon", "ebay", "walmart"):
        FIXTURES.extend(_variants(seed, market, 50))


def for_query(query: str, marketplaces: list[str], limit: int) -> list[MarketProduct]:
    needle = query.lower()
    tokens = [part for part in needle.replace("-", " ").split() if len(part) > 2] or needle.split()
    hits: list[MarketProduct] = []
    for product in FIXTURES:
        if product.marketplace not in marketplaces:
            continue
        hay = f"{product.title} {product.query} {product.brand or ''}".lower()
        if any(token in hay for token in tokens):
            hits.append(product.model_copy(update={"query": query}))
    if not hits:
        return [MarketProduct(
            id=f"unlisted-{query.lower().replace(' ', '-')[:40]}",
            store="No listing",
            title=query,
            price=None,
            in_stock=False,
            query=query,
            marketplace=marketplaces[0] if marketplaces else "amazon",  # type: ignore[arg-type]
        )]
    by_site: dict[str, list[MarketProduct]] = {}
    for product in hits:
        by_site.setdefault(product.marketplace, []).append(product)
    pool: list[MarketProduct] = []
    for rows in by_site.values():
        pool.extend(rows[:limit])
    return pool
