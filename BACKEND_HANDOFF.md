# Backend handoff

This branch contains a locally integrated hackathon backend. It does not turn the demo
inventory, synthetic reviews, or mock payment intents into live integrations.

Review insights now adds optional configured WooCommerce written-review retrieval,
supplied-review analysis, evidence-checked AI interpretation and a browser workbench.
See [review insights](docs/review-insights.md) for configuration, API contracts,
live-check results and merge boundaries. Existing product rankers are unchanged.

## Validation on this branch

- Regression suites: 22 Node tests and 539 Python tests passed (561 total).
- `npm run build`: current frontend production build passed.
- `npm run smoke:backend`: real local HTTP gateway, plan updates, raw recommendations,
  constrained catalog search and fallback SSE passed.
- `npm run smoke:backend -- --live-ai`: the configured Gemini agent completed a full
  tool-planning turn through the actual gateway in about 4.4 seconds, with matching
  product constraints and a valid audit chain. This is one measured run, not a latency guarantee.
- Shared demo fixtures were unchanged; temporary smoke-check servers were stopped.

The Python test run emits one existing Starlette/httpx deprecation warning. It does
not fail the suite; dependency migration is separate from this backend integration.

## Start and verify

Use Node 24 and Python 3.11+:

```bash
npm ci
npm run api:setup
npm test
npm run build
npm run smoke:backend
npm run dev
```

On this workstation, dependencies and `api/.venv` have already been set up. The Gemini
key belongs only in the ignored `api/.env`. Never put it in the client, shared types,
Git, screenshots, or a team handoff. Restart after changing configuration.

- Frontend: `http://localhost:5173`
- Express: `http://localhost:3001`
- Python docs: `http://localhost:8000/docs`
- Same-origin Python health: `/api/conjure/health`
- `npm start` starts Express only; use `npm run dev` for all three processes.

`npm test` is offline. It blocks default outbound HTTP transports, uses mock provider
responses and hashed embeddings, generates test review fixtures in temporary folders,
and checks that the shared `api/data` files have not changed.

`npm run smoke:backend` starts temporary Python/Express servers on random localhost
ports, verifies the real HTTP gateway and fallback stream, then stops those servers.
The optional `npm run smoke:backend -- --live-ai` makes a real provider request with
your locally configured key; its output withholds the key and provider messages.

## Two contracts, preserved deliberately

### Existing Planboard frontend

`POST /api/plans` accepts `{prompt, category}`. `GET /api/plans/:id` retrieves a plan.
`PATCH /api/plans/:id/items/:itemId` accepts `{purchased: boolean}` and returns the full
updated plan. Templates and `fetchBot.js` fixtures remain deterministic demo sources.

- Existing `items`, `products`, `synthesis`, and `quote` keys are preserved.
- Prices are validated, calculated in cents, and compared only within matching explicit
  supported currencies. There is no exchange-rate conversion.
- `totalPrice` is a merchandise subtotal. It excludes delivery and tax.
- Unknown or mixed-currency plan totals are `null`, never a misleading zero.
- `knownSubtotal`, `missingPriceCount`, `subtotalComplete`, `priceScope`, `costComplete`,
  and `fullTotal` explain completeness. Full delivered cost stays unknown without a
  documented charge scope, avoiding multiplied or double-counted fees.
- `shippingDate` requires a source ship date; `estimatedArrival` is separate. Mock
  shipping durations are not turned into dated delivery promises. `readyBy` requires
  arrival evidence for every outstanding item.
- Source/demo flags and warnings are additive. The frontend must visibly display
  them and label subtotals correctly; its current components ignore those new fields.
- Stock can be `true`, `false`, or `null`. Render `null` as **unknown**.

### Conjure Python assistant

The fixed-origin Express gateway maps `/api/conjure/*` onto allowed Python endpoints.
It forwards incremental SSE without forwarding browser cookies or credential headers.
Set `CONJURE_API_URL` to an HTTP(S) origin without credentials, path or query. Its
default is `http://127.0.0.1:8000`; timeout defaults to 125 seconds, maximum 180 seconds.
Keep Python's `LLM_TURN_BUDGET_S` below the gateway timeout.

For chat, create a session with `POST /api/conjure/session`, then send:

```json
{
  "session_id": "THE_RETURNED_SESSION_ID",
  "text": "Find a fragrance-free moisturizer for dry skin under $40",
  "ui_context": {"visible_ids": [], "focused_id": null}
}
```

to `POST /api/conjure/chat`. Read it as `text/event-stream`, buffering across network
chunks. Handle `action`, `trace`, `say`, and final `done` events; ignore comment
heartbeats. `done.source` distinguishes the LLM agent from fallback. Actions and
speech have separate payloads. Shared types are in `shared/types.ts`.

Other gateway endpoints include search, product detail, trust, feedback, compare,
profile GET/PUT/DELETE, audit, signed intent mandates, staged checkout, mock checkout
intents, and optional voice proxies. See Python's interactive docs for exact schemas.
The current frontend still needs to consume this chat/feedback interface.

The catalog is fictional skincare inventory. Review evidence is synthetic; local
merchant `verified` flags express policy approval and do not prove domain ownership.
Trust is a heuristic review assessment, not a merchant safety guarantee. Health
reports configuration and data provenance; a configured provider can still fail.

The LLM plans tool calls. The server builds spoken product facts from those structured
results rather than reading arbitrary generated prose. `done.source` identifies the
agent path and `grounded` refers to the server-rendered response, not an unrestricted
LLM fact-checking guarantee. Unknown shipping remains unknown.

## Raw normalization and recommendations

`POST /api/conjure/products/recommend` accepts a request-local `products` batch plus
explicit currency, unit-price budget, required/avoided attributes and soft preferences.
See `api/README.md` for the complete example and aliases.

- `api/normalization.py` validates raw input, preserves unknowns and uses Decimal money.
- `api/recommendations.py` returns normalized records, ranked results and indexed issues.
- Monetary amounts in this response are decimal strings, unlike Node's numeric plan
  fields. Do not silently interchange the two response shapes.
- This endpoint recommends USD only, without FX. `max_price` means single-unit
  merchandise price, not a delivered total.
- Missing review evidence stays null. Uploaded product IDs cannot borrow catalog trust.
- Unknown merchants cannot acquire approval from a client-supplied boolean.
- Node fixture merchants and Python approved merchant IDs differ. Agree on registration
  and a source contract before wiring fetched Node listings into this endpoint.
- Catalog ranking still uses 45% semantic, 25% attributes, 20% trust and 10% feedback.
  Hashed embeddings are the offline default; neural embeddings remain optional.

## Safety and integration scope

Budgets, signed restrictions, product identity, explicit cart consent and checkout
signatures are enforced in backend code. Cart money uses exact cent arithmetic while
preserving the existing public numeric schema. Changed catalog prices/merchants are
rejected before mock payment authorization. Shipping, tax and actual retail payment
integration remain separate tasks requiring real source data and agreed contracts.

Sessions, plans, caches and audit logs are in memory and are lost on restart.
ElevenLabs is optional; browser fallback is expected without its key. Live written
reviews require a configured WooCommerce store. Live retailer product search, FX,
domain verification and real charges remain outside this branch's implementation.

## Eventual manual Git integration

No commit, push, merge, rebase, reset or branch switch was performed by the assistant.
Ernest's fetched AI implementation was incorporated as ordinary local source edits;
its commit ancestry was not merged. Overlapping changes can therefore still require
manual conflict resolution with the team.

Preserve both sides' behavior when reviewing these overlapping files:

- `api/main.py`: LLM lifecycle **and** recommendations router plus the original routes.
- `api/search.py`: `search_with_stats()` **and** `score()` / `with_catalog()`.
- `api/nlu.py`: added vocabulary, safe budget parsing and structural product typing.
- `api/agent/*`, `api/config.py`, `api/sessions.py`: Gemini transport and intent guards.
- `api/schemas.py` and `shared/types.ts`: additive trace events; original Product shape.
- `server/index.js`: existing plan routes **and** the separate Conjure gateway.

Review `git status`, `git diff --stat`, and the full diff before manually staging,
committing and pushing. Run `npm test` and `npm run build` after team integration too.

## Working-tree change summary

Relative to the existing local commit `4c2aff5`: 28 tracked files are modified
(`git diff --stat`: 1,754 insertions, 335 deletions), with 18 additional new files.
The ordinary Git diff summary excludes those new, untracked files until staging.
No frontend source file or shared demo data file was changed.

- Python runtime: `api/agent/fallback.py`, `orchestrator.py`, `tools.py`, new
  `llm.py` and `prompts.py`; `api/checkout.py`, `config.py`, `main.py`, `nlu.py`,
  `normalization.py`, `schemas.py`, `search.py`, `sessions.py`, `store.py`,
  `trust/pipeline.py`, and `voice.py`.
- Python tests: `api/tests/conftest.py`, `test_normalization.py`, `test_trust.py`,
  plus new `test_agent.py`, `test_api_contracts.py`, `test_checkout_prices.py`,
  `test_fallback_phrasing.py`, `test_llm.py`, `test_query_constraints.py`,
  `test_search_stats.py`, and `test_voice.py`.
- Node runtime: `server/index.js`, `server/services/fetchBot.js`, `pipeline.js`,
  `planner.js`, `synthesizeBot.js`, plus new `server/pythonGateway.js`.
- Node tests: new `server/tests/api.test.js`, `gateway.test.js`, `synthesis.test.js`.
- Shared contract: additive events in `shared/types.ts`.
- Launch/test metadata: `package.json`, `package-lock.json`, `server/package.json`;
  new `scripts/smoke-backend.mjs`, `test-api.mjs`, and `test_api.py`.
- Documentation: `README.md`, `api/README.md`, and this new `BACKEND_HANDOFF.md`.

The local `api/.env`, `api/.venv`, `node_modules` and build output are ignored by Git.
