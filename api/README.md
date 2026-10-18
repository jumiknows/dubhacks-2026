# Conjure API

Review analysis and the evidence workbench: [review insights handoff](../docs/review-insights.md).
Website reputation, merchant identity and the external-destination gate:
[website safety handoff](../docs/website-safety.md). Live review fetching now requires
matching origin registrations and completed reputation checks; missing evidence holds.

FastAPI backend for Conjure. Runs fully on mock data with an empty `.env`.

```bash
npm run api:setup                     # optional: pip-installs requirements into this Python
cp api/.env.example api/.env          # optional, every key is optional
npm run dev                           # API on :8000 plus the rest of the app
npm run api                           # or: just the API
npm run test:api                      # offline tests; verifies shared fixtures unchanged
api/.venv/bin/python -m api.trust.make_mock   # regenerate mock catalog + trust reports
```

Uses the Python on your PATH (or `PYTHON` if set). No virtualenv.

Interactive docs: http://localhost:8000/docs · Status: http://localhost:8000/health

All brands in the mock catalog are fictional.

## Team setup: API keys

Keys live in `api/.env`, which is **never committed** (git ignores it), so they can't leak when
the repo goes public.

1. Ask a teammate for the team's `api/.env` file (sent by DM, never posted in a channel or committed).
2. Save it as `api/.env` in your copy of the repo, next to `.env.example`.
3. Restart `npm run dev`.
4. Check http://localhost:8000/health: `"elevenlabs": "live"` means voice is on.

No file? Everything still runs: the app uses the rule-based agent and the browser's own speech
instead. To make your own: `cp api/.env.example api/.env` and fill in the keys you have.

Never paste keys into Slack/Discord channels, GitHub issues, or code. If one leaks, rotate it in the
provider's dashboard and send the team the new file.

## Turning on the AI and voice

Set these in `api/.env` (copy from `.env.example`), then restart. `/health` shows what's live.

| Feature | Variables | Without them |
|---|---|---|
| LLM agent | `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL` (any OpenAI-compatible provider) | Rule-based fallback agent answers |
| Voice | `ELEVENLABS_API_KEY` (+ optional `ELEVENLABS_VOICE_ID`) | `/stt/token` and `/tts` return 503 with the browser fallback to use |

Example for Gemini:

```
LLM_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai
LLM_API_KEY=your-key
LLM_MODEL=gemini-2.5-flash
```

**Check it works:** `/health` should say `"llm": "live (...)"`. Then run
`python -m api.scripts.smoke --verbose` (with the API running). If the output shows
`source: fallback`, LLM calls are taking longer than 4 s: switch to a faster model or raise `LLM_TIMEOUT_S`.

The LLM never pays and never sees raw review text. Each turn allows at most 4 tool calls and 1 cart
proposal, staging a cart needs an explicit "yes", and any number it says must appear in a tool
result. A call over `LLM_TIMEOUT_S` (4 s) falls back to the rule-based agent. After 3 failures in a
row, the circuit breaker skips the LLM for 60 s. After 2 anomalous turns, that session switches to
the fallback agent for good (kill switch).

## Troubleshooting

- **`localhost:8000` hangs or won't load.** The API's auto-reloader can crash if it reloads while a
  file is half-saved, and it doesn't always recover. Stop `npm run dev` (Ctrl-C) and start it again.
- **"address already in use" on port 8000.** Another copy of the API is still running. Stop the
  other `npm run dev`, or run this one on another port: `python -m uvicorn api.main:app --port 8010`.

## Marketplace fetch (planner)

Express `fetchBot.js` calls these:

- `POST /market/search` `{ query, marketplaces, limit, details }`
- `POST /market/details` `{ urls, query }` (live Selenium only)
- `POST /market/synthesize` `{ item, products, weights? }`
- `POST /market/compare` `{ left, right, trust_floor? }` — pairwise. Each side already has `bang_per_buck`, `relevancy`, `trust`.
- `POST /market/top` `{ items, limit?, trust_floor? }` — about ten best, same fields. Default `limit` 10, `trust_floor` 0.5.

Express proxies those as `POST /api/compare` and `POST /api/top`.

`SELENIUM_ENABLED=false` (default) returns fixture listings. Chrome must be installed for live mode. Comparison ideas live in `docs/product-compare.md`.

## For the frontend

The contract is in [`shared/types.ts`](../shared/types.ts). Try any endpoint in `/docs`.

- **`POST /chat` streams Server-Sent Events**, in this order:
  - `trace`: what the agent and safeguards did (tool calls with timing, products removed by
    filters, policy checks). Use it for the glass-box receipt.
  - `action`: a `UIAction` to apply to the screen (show results, open compare, stage checkout, ...).
  - `say`: one sentence of speech. Start text-to-speech on the first one.
  - `done`: `{ grounded, source }`. `grounded: false` means the AI's own wording was replaced
    with a safe sentence built from catalog data. `source` is `"llm"` or `"fallback"`.
  - `error`: a short message; the stream still finishes normally.
- **Send `ui_context` with every chat message.** `visible_ids` are the cards on screen and
  `focused_id` is the one the user is pointing at, so "this one" works.
- **`POST /tts` `{ text }`** returns MP3 audio for one sentence. **`GET /stt/token`** returns a
  single-use token for ElevenLabs realtime speech-to-text (expires in 15 minutes).
  If either returns 503, use the browser instead: the response's `fallback` field says which
  (`web_speech` for listening, `speech_synthesis` for speaking).
- **TODO(verify):** the ElevenLabs realtime speech-to-text WebSocket URL and model id the browser
  should connect to with that token. Check the ElevenLabs "Speech to Text: Realtime" docs.
- **Checkout sheet:** render it only from the `cart` and `policy` in the `stage_checkout` action,
  never from what the assistant said. The user signs `cart_payload` exactly as received.

## For backend contributors

- **Who owns what:** the agent and voice code live in `api/agent/`, `api/voice.py` and
  `api/guard/grounding.py`; checkout, payments and the other guards live in `api/checkout.py` and
  `api/guard/`. Whoever changes an endpoint updates `api/schemas.py` and `shared/types.ts` in the
  same commit.
- **Circuit breaker state** for `/security`: `breaker.status()` in `api/sessions.py`.
- **Policy checks already stream as `trace` events** whenever a cart is staged (`stage_checkout`
  in `api/agent/tools.py`).
- **Before merging:** `python -m pytest api/tests` passes and the smoke test shows
  ALL PASSED.

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

### Local AI integration and team merge boundaries

The fetched `origin/backend` at `0bacbe7` already includes `feat/AI` at `b271ab5`.
Its LLM tool loop, filter traces, voice proxies, and fallback tests have been
incorporated as local source edits, with Gemini compatibility and safety fixes.
No Git merge, commit, push, or branch switch was performed.

`Ranker.search_with_stats()` now supports the catalog agent's expected interface
while `score()` and `with_catalog()` still support sparse normalized products.
All wrappers share one scoring pass and the same weights. Statistics count each
excluded product once, under its first filter reason; top-N truncation is not a
filter rejection. The additional `missing_price` reason covers sparse records.

During the team's eventual Git integration, preserve both interfaces in
`api/search.py`, both the LLM lifecycle and recommendation router in `api/main.py`,
and both the new vocabulary and structural type annotations in `api/nlu.py`.
Replacing any of these whole files with one branch's copy can discard the other
branch's behavior. The LLM's catalog tools still need an explicit raw-fetch
handoff; adding this compatibility interface does not connect that flow by itself.

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
