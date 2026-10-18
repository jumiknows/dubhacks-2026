# ESPER

ESPER combines shopping lists, store offers, comparison, review evidence, voice, hand gestures, and checkout in one React/Vite application with Express and Python/FastAPI services.

## Run locally

Use Node.js 22+ and Python 3.11+.

```bash
npm ci
npm run api:setup
npm run dev
```

Setup creates `api/.venv`; development and tests use that environment. `PYTHON` can select another Python 3.11+ interpreter for development. Stop the development command to stop all three services.

- Application: http://localhost:5173
- Express: http://localhost:3001
- Python API docs: http://localhost:8000/docs
- Health: `/api/health` and `/api/conjure/health`

Copy `server/.env.example` to `server/.env` and `api/.env.example` to `api/.env` to configure optional integrations. Keep credentials in these ignored files. The application supports offline sample data. Google, live retailer APIs, Gemini voice, and Stripe test mode require their respective configuration; the UI reports availability and data provenance.

For the built application, run `npm run build`, keep Python running with `npm run api`, and run `npm start` to serve the application and its API on port 3001. Set `CLIENT_URL` and `APP_ORIGIN` in `server/.env` to that application origin so Google and checkout return to it.

## Application flow

Complete or skip onboarding, choose a calendar suggestion or describe a shopping task, and build a list. Multiple lists share the shopping board. Open a group with a click or hand gesture, inspect items, compare listings, select an offer, and add it to the cart. Purchased items update the server plan and its quote. Checkout returns to the same application and refreshes the paid plan.

The assistant uses `/api/conjure/*` for conversational search and evidence. Its labelled demo catalog is separate from marketplace offers. Review and website workbenches are available at `/api/conjure/reviews/workbench` and `/api/conjure/websites/workbench`.

Voice uses `/ws-live` and the same planner routes as the board. An initial checklist can appear while offers load; subsequent updates hydrate the complete plan. Missing voice configuration leaves text and pointer controls available.

The [gesture module](gesture_pipeline/README.md) supplies pointer, pinch, drag, swipe, split, and recombine interactions. `/gesture-lab` retains camera-free replays, live assessments, and JSON export. See [two-hand gestures](docs/two-hand-gestures.md) for tuning and tests.

## Data and checkout

Checklist generation uses explicit templates. Marketplace search combines the Python marketplace service and configured store adapters, with labelled fixture fallback. Selenium is optional (`SELENIUM_ENABLED=true`); store adapters are controlled by `STORES_LIVE` and provider settings in `server/.env.example`.

Prices are validated and calculated in integer cents. Quotes distinguish known merchandise subtotals, missing prices, mixed currencies, shipping, tax, and arrival evidence. The cart uses server-selected offers and server prices. Missing configuration uses an explicitly labelled mock checkout; `STRIPE_SECRET_KEY=sk_test_...` enables Stripe test Checkout. `MOCK_ORDER_SANDBOX=off` keeps sample orders offline.

Accounts and preferences persist under ignored `server/data/`. Planner lists and checkout sessions currently live in server memory; restarting Express expires them. The application restores the current browser or signed-in account’s lists while their server plans remain available.

## API

- `POST /api/plans` — `{prompt, category?, marketplaces?, async?}`; `async:true` returns a checklist while offers load.
- `GET /api/plans/:id` — retrieve the complete plan and pricing status.
- `PATCH /api/plans/:id/items/:itemId` — `{purchased:boolean}`.
- `PUT /api/plans/:id/items/:itemId/listing` — `{listingId}` selects an existing offer.
- `POST /api/compare` and `POST /api/top` — marketplace comparison and ranking.
- `POST /api/checkout` — `{planId,itemIds}`; `GET /api/checkout/:sessionId` confirms the result.
- `POST /api/checkout/:sessionId/cancel` — cancels an open checkout and releases its item reservations.
- `/api/me`, `/api/me/profile`, `/api/auth/*`, `/api/calendar/suggestions` — onboarding and account integration.
- `/api/conjure/*` — bounded gateway for assistant sessions, streamed chat, catalog search, recommendations, trust, reviews, website assessments, and signed demo checkout.

See [backend contracts](BACKEND_HANDOFF.md), [review insights](docs/review-insights.md), and [website safety](docs/website-safety.md) for provider setup and evidence boundaries. Historical branch validation in the handoff describes those branch snapshots.

## Verification

```bash
npm test                   # server, Python, client units, gesture engine
npm run typecheck:gestures
npm run build
npm run smoke:backend      # real local HTTP integration, offline providers
npm run smoke:app          # built app against real local services in Chromium
npm run test:e2e           # browser application and gesture-lab checks
```

Install the test browser once with `npx playwright install chromium` if needed. All default verification uses offline providers or controlled fixtures. Live provider checks are opt-in.

## Integration

`integration/cohesive-esper` includes the latest safety/review backend, store APIs and Stripe checkout, onboarding/calendar, final shopping board, and voice pipeline, plus the existing AI, marketplace, and gesture branches. The useful local voice work was integrated explicitly; original stashes remain available. Superseded branch tips remain in the ancestry through their feature merges.
