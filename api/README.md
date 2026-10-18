# Conjure API

Review analysis and the evidence workbench: [review insights handoff](../docs/review-insights.md).
Website reputation, merchant identity and the external-destination gate:
[website safety handoff](../docs/website-safety.md). Live review fetching now requires
matching origin registrations and completed reputation checks; missing evidence holds.

FastAPI backend for Conjure. Runs fully on mock data with an empty `.env`.

```bash
npm run api:setup                     # once: creates api/.venv and installs requirements
cp api/.env.example api/.env          # optional, every key is optional
npm run dev                           # API on :8000 plus the rest of the app
npm run api                           # or: just the API
npm run test:api                      # offline tests; verifies shared fixtures unchanged
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
  Explicit `estimated_arrival`/`estimatedArrival` and
  `estimate_reference_date`/`estimateReferenceDate` are copied only as valid
  `YYYY-MM-DD` source dates. Relative phrases, conflicting aliases and an arrival
  before the source reference date are rejected; missing dates stay null.
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
after fetching, or the frontend can use `/api/conjure/products/recommend` through
the new Express gateway. Node fixtures still need an agreed approved-merchant mapping
before that handoff; the gateway does not silently create one.

### Integrated catalog agent

The application includes the AI tool loop, filter traces, voice proxies, Gemini compatibility, and safety fixes.

`Ranker.search_with_stats()` now supports the catalog agent's expected interface
while `score()` and `with_catalog()` still support sparse normalized products.
All wrappers share one scoring pass and the same weights. Statistics count each
excluded product once, under its first filter reason; top-N truncation is not a
filter rejection. The additional `missing_price` reason covers sparse records.

Safe tests (no real credentials, outbound API calls, or embedding-model downloads):

```bash
npm run test:api
```

The complete suite now generates trust-test data only in pytest temporary directories.
The runner additionally hashes the shared demo data before and after testing and fails
if it changes. Mock provider requests may appear in test logs; they use explicit
`httpx.MockTransport`, not the real provider.

### Gemini configuration

Save these settings in the ignored `api/.env`, keeping the actual key local:

```dotenv
LLM_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai/
LLM_MODEL=gemini-3.8-flash
LLM_API_KEY=YOUR_LOCAL_REPLACEMENT_KEY
LLM_REASONING_EFFORT=low
LLM_TIMEOUT_S=60
LLM_TURN_BUDGET_S=120
LLM_MAX_TOKENS=2048
```

These are configurable time limits, not promised response times. The local provider
smoke test took about 35 seconds. Gemini 3 tool-call thought signatures are preserved
between requests. Provider failure or a bounded turn timeout selects deterministic
fallback. `/health` says **configured**, which is not proof that a provider request
succeeded. Restart the backend after changing environment settings.

The LLM chooses among the allowed tools. Spoken product statements are rendered by
the server from structured tool results; arbitrary model prose is not presented as
verified product evidence. This prevents a numerical whitelist from incorrectly
validating an invented ingredient, shipping claim, or a price assigned to the wrong
product. A `done.source` of `llm` identifies the tool planner; `grounded` describes
the server-rendered response, not a general fact-checking guarantee for LLM prose.

Voice is optional: without `ELEVENLABS_API_KEY`, STT/TTS return 503 with browser fallback
hints. Payment intents remain explicitly mocked even when a Stripe key exists. No
agent tool can authorize payment; staging still requires consent and payment requires
the user's signed cart. No real shipping retrieval or FX conversion has been added.

## Marketplace fetch (planner)

Express `fetchBot.js` calls these:

- `POST /market/search` `{ query, marketplaces, limit, details }`
- `POST /market/details` `{ urls, query }` (live Selenium only)
- `POST /market/synthesize` `{ item, products, weights? }`
- `POST /market/compare` `{ left, right, trust_floor? }` — pairwise. Each side already has `bang_per_buck`, `relevancy`, `trust`.
- `POST /market/top` `{ items, limit?, trust_floor? }` — about ten best, same fields. Default `limit` 10, `trust_floor` 0.5.

Express proxies those as `POST /api/compare` and `POST /api/top`.

`SELENIUM_ENABLED=false` (default) returns fixture listings. Chrome must be installed for live mode. Comparison ideas live in `docs/product-compare.md`.

