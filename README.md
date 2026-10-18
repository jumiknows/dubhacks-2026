# Planboard

A planner for groceries and events. A prompt such as “I need to prepare for camping.” becomes a checklist. Checked items drop out of the buy list. What is left is priced from store data: image, dimensions, ship date, and total.

React (Vite) frontend + Express backend. The list, the store lookup, and the offer summary are separate stubs so they can be built in parallel.

## Setup

```bash
npm install
npm run dev
```

On Windows, if `server/.env` is missing:

```bash
copy server\.env.example server\.env
```

- Frontend: http://localhost:5173
- Backend: http://localhost:3001 (the frontend proxies `/api/*` to it)

## How a plan is built

1. `server/services/planner.js` turns the prompt into items. **Stub** — templates stand in for a model.
2. `server/services/fetchBot.js` returns a **Promise** of products for one query. **Stub** — mock catalog. Replace `searchCatalog()` with trusted-store APIs.
3. `server/services/synthesizeBot.js` returns a **Promise** of one offer: image, dimensions, ship date, total price. **Stub** — cheapest in-stock listing.
4. `server/services/pipeline.js` awaits those two promises and attaches them to the plan.
5. `client/src/ui/` renders the plan. **UI stub** — replace the layout. Keep the props on `PlannerUI`. HTTP stays in `client/src/App.jsx`.

## API

- `POST /api/plans` `{ prompt, category }` → plan, including `items[].products`, `items[].synthesis`, and `quote`
- `GET /api/plans/:id`
- `PATCH /api/plans/:id/items/:itemId` `{ purchased: boolean }` → plan with the buy list recomputed

`category` is `groceries`, `wedding`, `camping`, or `custom`. If the prompt mentions one of those occasions, that list wins over the selected tab.

Camping tab ideas — what that widget should surface for a trip — are in [docs/camping-widget.md](docs/camping-widget.md).

The home shell — side dock, pull bar, and the sheet that slides in — is described in [docs/ui-shell.md](docs/ui-shell.md).

## Team workflow

- Branch off `main` for each feature: `git checkout -b feature/thing`
- Open a PR and merge often to avoid big conflicts
- Never commit `.env` (it's gitignored)

## Hand gesture feature

The reusable gesture module lives in [`gesture_pipeline/`](gesture_pipeline/README.md). It provides index-pointer control, pinch click/drag, horizontal reveal/dismiss gestures and vertical catalogue scrolling for the existing Vite frontend. See its README for installation, asset preparation, UI integration and tuning. The feature has no standalone demo server.

The existing frontend also includes a two-hand lab at **http://localhost:5173/gesture-lab**. Run `npm.cmd run dev -w client` from the root to try it; no backend is needed for the lab. Use thumb/index pinches with both hands to pull one original apart, bring its grouped components horizontally together, or compare two originals by bringing them together. Camera-free landmark replays demonstrate all three. [Implementation, tuning and tests](docs/two-hand-gestures.md).

On the normal `/` page, **Test gestures · spawn test objects** opens the populated lab. Its feature selector loads scenes for all current gestures; **Run all feature replays** checks the software path, while **Begin live trial** measures your camera attempts separately. Export task outcomes, errors, tracking/timing evidence and perceived smoothness as JSON.
