# ESPER

A shopping planner and Conjure shopping-assistant backend. A prompt becomes a checklist; purchased items drop out of its buy list. The current product offers and review datasets are explicitly demo data, not live retailer quotes.

React/Vite talks to Express for plans. Express also exposes the Python/FastAPI assistant through `/api/conjure/*`. The assistant supports a configured Gemini/OpenAI-compatible provider, deterministic fallback, search, trust reports, feedback, and signed mock checkout. See [BACKEND_HANDOFF.md](BACKEND_HANDOFF.md) for integration boundaries and remaining frontend work.

Review evidence and website safety have standalone workbenches at
`/api/conjure/reviews/workbench` and `/api/conjure/websites/workbench` on the Express
server. See [website setup](docs/website-safety.md): live fetching now holds without
registered merchant origins and completed reputation checks. Offline demos stay explicit.

## Setup

```bash
npm ci              # Node 24; installs the locked dependencies
npm run api:setup   # once: creates api/.venv and installs the Python API (needs Python 3.11+)
npm run dev         # starts the Conjure API, the Express server, and the client
```

All external credentials are optional and stay in the ignored `api/.env`. For Gemini, use the settings documented in [api/README.md](api/README.md). An absent key selects the deterministic fallback. `server/.env` is optional; it can configure the gateway origin and timeout without containing an LLM key.

Run the offline backend tests and frontend build:

```bash
npm test
npm run build
```

- Frontend: http://localhost:5173
- Backend: http://localhost:3001 (the frontend proxies `/api/*` to it)
- Conjure API: http://localhost:8000 · docs http://localhost:8000/docs · health http://localhost:8000/health (see `api/README.md`)

## How a plan is built

1. `server/services/planner.js` turns the prompt into items with deterministic templates; it is separate from the AI assistants.
2. `server/services/fetchBot.js` asks Python `POST /market/search` (Amazon, eBay, Walmart; fixtures unless `SELENIUM_ENABLED=true`) and falls back to labelled demo listings.
3. `server/services/synthesizeBot.js` validates every listing (integer cents, safe links, no invented dates) and lets the Python weighted scorer pick, falling back to the cheapest explicitly in-stock listing.
4. `server/services/pipeline.js` attaches the offers and reports incomplete totals honestly.
5. `client/src/ui/` renders the plan. HTTP stays in `client/src/App.jsx`.

## API

- `POST /api/plans` `{ prompt, category }` → plan, including `items[].products`, `items[].synthesis`, and `quote`
- `GET /api/plans/:id`
- `PATCH /api/plans/:id/items/:itemId` `{ purchased: boolean }` → plan with the buy list recomputed
- `/api/conjure/*` → allowed Python assistant endpoints, including streamed `/chat`, `/session`, `/products/search`, `/products/recommend`, `/trust/:id`, and signed mock checkout

`category` accepts `groceries`, `wedding`, `camping`, `custom`, and the teammate frontend's `electronics` tab. Electronics currently uses custom checklist parsing; there is no dedicated electronics inventory. If the prompt mentions a supported template occasion, that list wins over the selected tab.

`npm run dev` starts all three services. `npm start` starts Express only; it does not serve a built frontend or start Python. Gateway configuration: `CONJURE_API_URL=http://127.0.0.1:8000` and `CONJURE_API_TIMEOUT_MS=125000` (maximum 180000). The URL must be a credential-free HTTP(S) origin. Keep the Python turn budget below the gateway timeout.

Camping tab ideas — what that widget should surface for a trip — are in [docs/camping-widget.md](docs/camping-widget.md).

The home shell — side dock, pull bar, and the sheet that slides in — is described in [docs/ui-shell.md](docs/ui-shell.md).

## Team workflow

- Review the local changes on your existing feature branch before committing and pushing manually.
- Coordinate integration with the backend and frontend owners; preserve both the AI lifecycle and recommendation route when resolving overlapping changes.
- Never commit `.env` (it's gitignored)

## Hand gesture feature

The reusable gesture module lives in [`gesture_pipeline/`](gesture_pipeline/README.md). It provides index-pointer control, pinch click/drag, horizontal reveal/dismiss gestures and vertical catalogue scrolling for the existing Vite frontend. See its README for installation, asset preparation, UI integration and tuning. The feature has no standalone demo server.

The existing frontend also includes a two-hand lab at **http://localhost:5173/gesture-lab**. Run `npm.cmd run dev -w client` from the root to try it; no backend is needed for the lab. Use thumb/index pinches with both hands to pull one original apart, bring its grouped components horizontally together, or compare two originals by bringing them together. Camera-free landmark replays demonstrate all three. [Implementation, tuning and tests](docs/two-hand-gestures.md).

On the normal `/` page, **Test gestures · spawn test objects** opens the populated lab. Its feature selector loads scenes for all current gestures; **Run all feature replays** checks the software path, while **Begin live trial** measures your camera attempts separately. Export task outcomes, errors, tracking/timing evidence and perceived smoothness as JSON.
