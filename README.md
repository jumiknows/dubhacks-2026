# ESPER

A planner for groceries and events. A prompt such as “I need to prepare for camping.” becomes a checklist. Checked items drop out of the buy list. What is left is priced from store data: image, dimensions, ship date, and total.

React (Vite) frontend + Express backend. The list, the store lookup, and the offer summary are separate stubs so they can be built in parallel.

## Setup

```bash
npm install
npm run api:setup   # optional: pip-installs api/requirements.txt into this Python (needs Python 3.11+ on PATH)
npm run dev         # starts the Conjure API, the Express server, and the client
```

On Windows, if `server/.env` is missing:

```bash
copy server\.env.example server\.env
```

- Frontend: http://localhost:5173
- Backend: http://localhost:3001 (the frontend proxies `/api/*` to it)
- Conjure API: http://localhost:8000 · docs http://localhost:8000/docs · health http://localhost:8000/health (see `api/README.md`)

## How a plan is built

1. `server/services/planner.js` turns the prompt into items. **Stub** — templates stand in for a model.
2. `server/services/fetchBot.js` searches two sources in parallel and merges the listings: Python `POST /market/search` (Amazon, eBay, Walmart; Selenium off by default, so fixtures — set `SELENIUM_ENABLED=true` in `api/.env` for live pages) and every configured store API in `server/services/stores/`. Store keys go in `server/.env` (see `.env.example`); without keys, Open Food Facts + Open Prices, UPCitemdb, Shopify stores and the sample APIs (DummyJSON, Fake Store) still work. Falls back to the mock catalog.
3. `server/services/synthesizeBot.js` posts listings to `POST /market/synthesize` and ranks value, trust, shipping, availability, fit, condition, and completeness. Ideas for more axes: [docs/product-compare.md](docs/product-compare.md).
4. `server/services/pipeline.js` awaits those two promises and attaches them to the plan.
5. `client/src/ui/` renders the plan. HTTP stays in `client/src/App.jsx`.

## Demo: fake purchase

With no `STRIPE_SECRET_KEY` in `server/.env`, checkout is a simulation. Nothing is charged.

1. In `server/.env`, set `STORES_SAMPLE_DATA=always` so DummyJSON and Fake Store listings appear next to real stores.
2. Build the Groceries list. Eggs usually comes from DummyJSON; for Milk or Coffee, compare listings and press "Use this listing" on a DummyJSON one.
3. In **Cart**, tick items and press **Pay**, then **Place mock order** (demo card •••• 4242).
4. The receipt shows the cart id DummyJSON / Fake Store issued for their items. Other items are recorded locally.

`MOCK_ORDER_SANDBOX=off` skips those sandbox calls for offline demos. With a `sk_test_` key, the same Pay button opens real Stripe Checkout in test mode (card 4242 4242 4242 4242).

## API

- `POST /api/plans` `{ prompt, category }` → plan, including `items[].products`, `items[].synthesis`, and `quote`
- `GET /api/plans/:id`
- `PATCH /api/plans/:id/items/:itemId` `{ purchased: boolean }` → plan with the buy list recomputed
- `GET /api/stores` → each store API, whether it is enabled, and its last result
- `GET /api/products/search?q=headlamp` → merged results from every enabled store

`category` is `groceries`, `wedding`, `camping`, or `custom`. If the prompt mentions one of those occasions, that list wins over the selected tab.

Camping tab ideas — what that widget should surface for a trip — are in [docs/camping-widget.md](docs/camping-widget.md).

The home shell — side dock, pull bar, and the sheet that slides in — is described in [docs/ui-shell.md](docs/ui-shell.md).

## Team workflow

- Branch off `main` for each feature: `git checkout -b feature/thing`
- Open a PR and merge often to avoid big conflicts
- Never commit `.env` (it's gitignored)
