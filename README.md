# Planboard

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
2. `server/services/fetchBot.js` posts each item name to Python `POST /market/search` (Amazon, eBay, Walmart). Selenium is off by default (fixtures). Set `SELENIUM_ENABLED=true` in `api/.env` to open search pages, then each product page.
3. `server/services/synthesizeBot.js` posts listings to `POST /market/synthesize` and ranks value, trust, shipping, availability, fit, condition, and completeness. Ideas for more axes: [docs/product-compare.md](docs/product-compare.md).
4. `server/services/pipeline.js` awaits those two promises and attaches them to the plan.
5. `client/src/ui/` renders the plan. HTTP stays in `client/src/App.jsx`.

## API

- `POST /api/plans` `{ prompt, category }` → plan, including `items[].products`, `items[].synthesis`, and `quote`
- `GET /api/plans/:id`
- `PATCH /api/plans/:id/items/:itemId` `{ purchased: boolean }` → plan with the buy list recomputed

`category` is `groceries`, `wedding`, `camping`, or `custom`. If the prompt mentions one of those occasions, that list wins over the selected tab.

## Team workflow

- Branch off `main` for each feature: `git checkout -b feature/thing`
- Open a PR and merge often to avoid big conflicts
- Never commit `.env` (it's gitignored)
