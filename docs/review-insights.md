# Review insights: backend and team handoff

Review insights interprets written reviews and reports evidence. It does not add
another product-ranking formula, replace `TrustReport`, approve merchants, or
authorize purchases. Positive sentiment is not proof of authenticity.

## Try the feature

Start with `npm run dev`, then open:

On Windows, use `npm.cmd run dev` if PowerShell blocks `npm.ps1`.

**http://localhost:3001/api/conjure/reviews/workbench**

Direct FastAPI: `http://localhost:8000/reviews/workbench`.
The self-contained workbench uses the same API that React can consume; no existing
frontend component or shopping flow was replaced.

1. Click **Analyze synthetic demo**. The response explicitly says `demo`.
2. Inspect mixed opinions, duplicates, missing dates, and an instruction aimed at
   an assistant. Expand the complete response to inspect supporting review IDs.
3. Optionally enable AI. This uses the configured backend model and may spend API
   credits. The UI identifies AI coverage and deterministic fallback.
4. Analyze supplied records, or configure a real store below. Source failures
   never substitute fictional customer opinions.

The synthetic headphone reviews are a behavior test, not factual product evidence.

## API contract

Express adds `/api/conjure` to these FastAPI paths:

- `GET /reviews/sources`: configured capabilities, never credentials or merchant
  approval. A configured store is not an independently verified safe merchant.
- `GET /reviews/products?merchant=shop&q=headphones&limit=5`: search one store and
  select the exact returned product reference. This is discovery, not a new ranker.
- `POST /reviews/fetch`: retrieve up to 100 newest available reviews (default 50).
  Source status is `ok`, `partial`, `empty`, `not_configured`, `unsupported_source`,
  `rate_limited`, `invalid_request`, or `unavailable`. Unavailable evidence has
  `analysis: null`. An empty public response does not prove no reviews exist.
- `POST /reviews/analyze`: supplied records, always `uploaded`. Clients cannot
  provide live provenance, model classifications, or trust scores.
- `POST /reviews/demo`: explicitly synthetic; accepts `{ "use_llm": false }`.
- `GET /reviews/workbench`: browser demonstration without client-side keys.

Analysis calls return `{source, analysis, classification, summary}`. Summaries
are rendered from calculated facts, not unrestricted model prose.

Example supplied-review request (fictional text):

```json
{
  "product": {"source": "supplied", "external_id": "headphones-123"},
  "reviews": [{
    "review_id": "review-1",
    "product": {"source": "supplied", "external_id": "headphones-123"},
    "text": "Great sound but terrible battery life.",
    "rating": 3, "rating_scale": 5,
    "published_at": null, "source_url": null, "verified_purchase": null
  }],
  "use_llm": false
}
```

The report distinguishes received records, distinct valid reviews, source-claimed
total, sample stars, sentiment, high/low/newest examples, recurring topics with
exact quotes, duplicate exclusions, security flags, and limitations. AI metadata
shows classified count and fallback. Uploads never acquire an invented collection
timestamp. A source-supplied verification badge is not independent proof.

## Configure a real written-review source

The initial live adapter uses the public WooCommerce Store API, extending a
platform already present in `feat/shop-apis`. It needs no paid scraper or API key.
A specific reachable store must expose public written reviews; not every store
does. Nothing is configured automatically.

Add a map to the ignored **api/.env**, then restart Python:

```dotenv
REVIEW_WOOCOMMERCE_STORES='{"shop":"https://your-merchant.example"}'
```

The example domain is a placeholder. Search `/reviews/products`, then use the
returned exact reference with `/reviews/fetch`:

```json
{
  "product": {"source": "woocommerce", "merchant": "shop", "external_id": "33"},
  "limit": 50,
  "use_llm": false
}
```

Python does not read Node's secret file. Node's `WOOCOMMERCE_STORES` and Python's
map are separate configuration. Preserve canonical external product IDs and a
configured merchant key when connecting the team's product adapters; never infer
an ID across stores or variants. Aggregate stars alone are not written reviews.
Amazon, Walmart, Target, Best Buy, eBay, Shopify and Etsy written-review adapters
are not implemented here. Unsupported sources return an explicit status.

## Analysis and trust boundaries

1. Validate bounded records and bind source + merchant + product ID. Malformed
   rows receive indexed issues; valid rows can still be analyzed.
2. Normalize declared rating scales using Decimal, independently of sentiment.
   Missing stays unknown. Date-only precision is preserved; timezone-less,
   invalid and future dates cannot establish recency.
3. Exclude duplicate IDs and exact/very-near text conservatively. Preserve changed
   ratings, negation and contrasting claims. Similarity is not fraud detection.
4. Quarantine detected instructions from language interpretation. Their numerical
   ratings remain source claims; this behavior is explicitly disclosed.
5. With opt-in AI, classify small batches through the existing model client. The
   sole function schema is a response format; no executable shopping, payment or
   profile tools are provided. Validate IDs, enums and exact supporting quotes.
   Unsupported output uses explicitly labeled deterministic English fallback.
  Earlier fully validated batches survive a later failure; a failed batch contributes
  no labels or quotes. Coverage and skipped IDs remain explicit.
6. Python calculates statistics and examples. Recurring topics need at least two
   distinct reviews. Highest/lowest/newest examples can overlap.

Sentiment balance: `100 * (positive - negative) / classified_count` (−100..100).
Mixed/neutral enter the denominator; unknown does not. No evidence means null,
not a made-up neutral score. It is not a probability or product-quality score.
No weighted average blends it into existing ranking. Display insights alongside
the ranker; coordinate separately before using review aspects in personalization.

No trend claim is made from a recent-only sample. Exact quotations establish
provenance, not semantic correctness. Sarcasm, unsupported languages, imperfect
injection detection, classifier errors, and biased samples remain limitations.

## Resource limits

- One MiB streaming upload cap through both gateway and direct FastAPI; max 200
  supplied rows, bounded text and examples.
- Live fetches use configured HTTPS stores, public DNS/IP checks with connection
  pinning and original TLS hostname, no redirects/proxies/client target URLs,
  bounded responses/timeouts, per-store budgets, cooldown and TTL cache. Cache
  hits retain original retrieval time. Reviewer names/emails/avatars are omitted.
- AI defaults: opt-in, 12 reviews maximum per analysis (configurable to 30), three
  reviews per model call, 25-second total deadline, two simultaneous analyses.
  Process-local rolling budgets allow six analysis jobs/minute and 100/day; each
  job can make multiple model calls. These are development limits, not distributed
  production authentication. No failed provider bodies or key values are logged.
- Settings: `REVIEW_LLM_TIMEOUT_S`, `REVIEW_LLM_MAX_REVIEWS`,
  `REVIEW_LLM_REQUESTS_PER_MINUTE`, `REVIEW_LLM_REQUESTS_PER_DAY`,
  `REVIEW_SOURCE_TIMEOUT_S`, `REVIEW_SOURCE_CACHE_TTL_S`.

## Team integration and verification

Most files are new under `api/reviews/` and `api/tests/test_review_*`. Existing
integration edits are small: settings in `api/config.py`, router/middleware in
`api/main.py`, and fixed routes in `server/pythonGateway.js`. Preserve additions
from both sides when merging these with `main`. Keep this branch's earlier fixed
gateway mount in `server/index.js`. No `api/market`, product schema, existing trust
pipeline, checkout, or product ranker was edited for review insights.

```powershell
npm test
npm run build
npm run smoke:backend
```

Offline tests cover evidence, identity, unknowns, dates, deduplication, pagination,
bad sources, request bounds, SSRF restrictions, AI budgets/fallback and integration.
They do not establish that an external provider is reachable. Record live smoke
checks separately with source/time/count, never keys or reviewer information.

Verified separately on October 18, 2026:
- The real adapter retrieved three written reviews with ratings and GMT dates for
  product `616` at `https://www.nopong.com.au`, with a source-reported total of 12.
  `truncated: true` correctly marked the sample as incomplete. This public store
  was a connectivity check, not a merchant endorsement or a product recommendation.
  To try it explicitly, a local example map is
  `REVIEW_WOOCOMMERCE_STORES='{"nopong":"https://www.nopong.com.au"}'`.
- The configured Gemini model classified one synthetic review successfully and
  returned exact supporting evidence. A preceding three-review request timed out;
  provider latency is variable and timeout/partial-batch fallback is tested.
- Final regressions: 539 Python tests and 22 Node tests passed; frontend production
  build and real localhost gateway/review smoke checks passed. Shared demo data
  was unchanged. Browser tools exposed no browser, so visual verification was
  unavailable; JavaScript syntax and workbench HTTP delivery were checked.

Judge demo: show one mixed opinion and its supporting quote, a duplicate exclusion,
an unknown date, and the synthetic badge. If a live store is configured, compare
its source timestamp and sample limits. Explain what the evidence cannot prove.

Official contracts:
- https://developer.woocommerce.com/docs/apis/store-api/
- https://developer.woocommerce.com/docs/apis/store-api/resources-endpoints/product-reviews/
- https://developer.woocommerce.com/docs/apis/store-api/resources-endpoints/products/
- https://ai.google.dev/gemini-api/docs/function-calling
