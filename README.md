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

1. `server/services/planner.js` uses deterministic checklist templates; it is separate from the Python conversational agent.
2. `server/services/fetchBot.js` returns labelled mock listings. Live retailer retrieval still requires a source integration.
3. `server/services/synthesizeBot.js` validates offers, compares matching explicit currencies, and calculates merchandise subtotals with integer cents. It does not convert currencies or invent delivery dates.
4. `server/services/pipeline.js` attaches the offers and reports incomplete totals honestly. `fullTotal` stays unknown without agreed shipping/tax charge scope.
5. `client/src/ui/` renders the existing plan contract. The frontend team still needs to display demo/warning metadata and connect the separate Conjure chat interface.

## First-run setup (onboarding)

New users see a short setup before the planner: **Continue with Google** (calendar access), three questions answered by hand gesture, key or tap, then suggested lists for upcoming calendar events such as "Camping at Rainier". Answers set how offers are picked (lowest price, fast shipping or major retailers) and the plan budget. Add `?onboarding` to the URL to replay it.

Google sign-in needs a one-time setup. Without it, setup skips the Google step and still runs the questions.

1. In Google Cloud Console, create an OAuth client of type **Web application**.
2. Add the redirect URI `http://localhost:5173/api/auth/google/callback`.
3. On the OAuth consent screen, add the scope `calendar.readonly` and, while the app is in testing, each tester's Google account as a test user.
4. Put `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in `server/.env` and restart.

Signing in with Google creates the user's Planboard account; there are no passwords. Only event titles and dates are read. Accounts and sessions are saved in `server/data/accounts.json` (gitignored), with session ids hashed and Google tokens encrypted. Users can sign out, redo setup, or delete their account from the account button in the top-left corner.

## API

- `POST /api/plans` `{ prompt, category }` → plan, including `items[].products`, `items[].synthesis`, and `quote`
- `GET /api/plans/:id`
- `GET /api/me` → signed-in user, saved setup answers, Google status
- `PUT /api/me/profile` `{ focus, priority, budget }` → saves setup answers
- `GET /api/auth/google/start` → Google consent screen; returns to `/?google=connected`
- `GET /api/calendar/suggestions` → upcoming events that need a list
- `POST /api/auth/logout` `{ revoke?: boolean }`
- `DELETE /api/me` → deletes the account and revokes Google access
- `PATCH /api/plans/:id/items/:itemId` `{ purchased: boolean }` → plan with the buy list recomputed
- `/api/conjure/*` → allowed Python assistant endpoints, including streamed `/chat`, `/session`, `/products/search`, `/products/recommend`, `/trust/:id`, and signed mock checkout

`category` accepts `groceries`, `wedding`, `camping`, `custom`, and the teammate frontend's `electronics` tab. Electronics currently uses custom checklist parsing; there is no dedicated electronics inventory. If the prompt mentions a supported template occasion, that list wins over the selected tab.

`npm run dev` starts all three services. `npm start` starts Express only; it does not serve a built frontend or start Python. Gateway configuration: `CONJURE_API_URL=http://127.0.0.1:8000` and `CONJURE_API_TIMEOUT_MS=125000` (maximum 180000). The URL must be a credential-free HTTP(S) origin. Keep the Python turn budget below the gateway timeout.

## Team workflow

- Review the local changes on your existing feature branch before committing and pushing manually.
- Coordinate integration with the backend and frontend owners; preserve both the AI lifecycle and recommendation route when resolving overlapping changes.
- Never commit `.env` (it's gitignored)
