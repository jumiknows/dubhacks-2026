Scoring and recall

Search cards first (details=false, limit 50). Price history (Camel/CamelMart fixtures, otherwise a synthetic 90-day band) is attached only as a change series for bang-per-buck — not extra catalogs.
Relevancy is real (spec overlap, title tokens, constraints, bundle fit), not a 1.0 stub.
score = (bang_per_buck × relevancy) × (trust_floor + (1 − trust_floor) × trust).
After relevancy, optional min_price / max_price / brand include-exclude apply. Top 10 mixes Amazon, eBay, and Walmart.
UI

Each to-buy card lists the shortlist. Pick two listings for a two-up sheet (axes, pick/split, “Use this listing”).
Trust-floor slider (default 50%) recomputes the sheet without refetching pages.
Check

python -m api.scripts.smoke_compare passed (150 tent fixtures, top 10).
In the browser, camping plan → two tent listings → compare sheet; slider moved to 20% without losing the pair.
The ~50-per-site fixture catalog is served by Python on :8000 (POST /market/search). If that API is down, Express still plans from its small catalog and compares locally with the same formula. Start npm run api (after pip install -r api/requirements.txt on that interpreter) to get the full 50-per-site recall.