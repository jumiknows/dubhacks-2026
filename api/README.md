# Conjure API

FastAPI backend for Conjure. Runs fully on mock data with an empty `.env`.

```bash
npm run api:setup                     # once: creates api/.venv and installs requirements
cp api/.env.example api/.env          # optional, every key is optional
npm run dev                           # API on :8000 plus the rest of the app
npm run api                           # or: just the API
api/.venv/bin/python -m pytest api/tests      # includes tests that regenerate mock data
api/.venv/bin/python -m api.trust.make_mock   # regenerate mock catalog + trust reports
```

Interactive docs: http://localhost:8000/docs · Status: http://localhost:8000/health

All brands in the mock catalog are fictional.

## Raw product recommendation milestone

`POST /products/recommend` accepts a request-local batch of raw products, normalizes
them, applies hard constraints, and reuses the existing recommendation formula.
It does not write to the catalog, trust reports, sessions, or checkout. Existing
`GET /products/search` and shared TypeScript/Pydantic Product contracts remain intact.

Example using **local fictional test input**, not a live offer:

```json
{
  "products": [
    {
      "id": "example-only",
      "title": "Example cream",
      "merchant_id": "m_dermadirect",
      "price": "19.99",
      "currency": "USD",
      "attributes": {"fragrance_free": true},
      "shippingDays": 3
    }
  ],
  "query": "cream",
  "max_price": "20.00",
  "required_attributes": {"fragrance_free": true},
  "avoided_attributes": {"key_ingredient": "retinal"}
}
```

The response contains `normalized` records, ranked `results`, and indexed `issues`
for invalid/excluded records. Monetary values serialize as decimal **strings**;
missing values serialize as `null`. The new response is deliberately separate from
the existing Product schema, which cannot represent unknown ratings or prices.

Integration boundary for Ernest:

- Supported inputs are the Python catalog shape and the documented Node RawProduct
  shape. `product_id`/`name`/`description` are accepted aliases for `id`/`title`/`summary`;
  conflicting aliases are rejected. Identifiers and titles are required.
- Node `store` names resolve only against server-side merchant names. Unknown
  merchants are excluded. The current catalog has fictional skincare merchants,
  so real store identifiers/names must be registered and agreed before live use.
  Local `verified` flags are policy inputs, not domain ownership checks. HTTPS URL
  parsing rejects unsafe syntax but does not establish merchant legitimacy.
- Currency must be explicit in each record or declared with `source_currency`.
  The existing Python catalog omits currency: its caller must explicitly declare
  `"source_currency": "USD"`. This milestone recommends USD only, without conversion.
- Prices accept numeric values or dot-decimal strings, including `"1,234.56"` and
  USD-marked strings with explicit USD currency. Negative/nonfinite/ambiguous
  amounts and more than two fractional digits are rejected, never rounded.
- `max_price` is an inclusive **single-unit product-price** ceiling, checked with
  Decimal. `budget_scope` states this explicitly. It is not a delivered-cost or
  payment authorization guarantee. Shipping and tax stay separate; `total_price`
  is null unless both charges are explicitly provided for that one-unit offer.
  `query` supplies semantic search text only: callers must send budgets and hard
  requirements in `max_price`, `required_attributes`, and `avoided_attributes`.
- Source fields `shipping_price`/`shippingPrice`, `tax`, and
  `shipping_days`/`shippingDays` are supported. No arrival date is inferred from
  duration alone: there is no agreed reference date or shipping calendar yet.
- Required/avoided attributes use exact scalar values. Missing required values
  exclude a product. Explicit avoided matches exclude a product; unknown values
  remain eligible with a warning. Booleans never equal numbers. Known boolean
  attributes normalize `"true"`/`"false"`; nested attributes are rejected.
- `needs` and `skin_type` are optional soft preferences for the existing scorer.
  They are separate from `required_attributes`. Ranking weights are unchanged.
- Uploaded IDs and trust/verification claims cannot attach existing trust reports
  to arbitrary products. Trust stays null; the existing neutral ranking term is
  explained in warnings. Review-evidence integration requires a trusted identity
  mapping in a later milestone.

The current React/Vite frontend still calls Express `/api/plans`; it does not call
this endpoint. Ernest can invoke the same pure `recommend_products()` function
after fetching, or a frontend can adopt the new documented endpoint. Neither
transport was changed here. Existing payment calculations are outside this slice.

Safe tests for this milestone (no model download or shared fixture generation):

```bash
api/.venv/bin/python -m pytest -q api/tests/test_normalization.py api/tests/test_recommendations.py
```

On Windows use `api/.venv/Scripts/python.exe`. The tests use local synthetic
records, an in-memory catalog, hashed vectors, and a small FastAPI test app. Avoid
running the entire trust suite against shared data: its `mock_reports` fixture
calls the mock generator and overwrites catalog/review/report/image fixtures.
