# Planboard

A planner for groceries and events. A prompt such as “I need to prepare for camping.” becomes a checklist. Checked items drop out of the buy list. What is left is priced from store data: image, dimensions, ship date, and total.

React (Vite) frontend + Express backend. The list, the store lookup, and the offer summary are separate stubs so they can be built in parallel.

## Setup

```bash
npm install
npm run api:setup   # once: creates api/.venv and installs the Python API (needs Python 3.11+)
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
2. `server/services/fetchBot.js` returns a **Promise** of products for one query. **Stub** — mock catalog. Replace `searchCatalog()` with trusted-store APIs.
3. `server/services/synthesizeBot.js` returns a **Promise** of one offer: image, dimensions, ship date, total price. **Stub** — cheapest in-stock listing.
4. `server/services/pipeline.js` awaits those two promises and attaches them to the plan.
5. `client/src/ui/` renders the plan. **UI stub** — replace the layout. Keep the props on `PlannerUI`. HTTP stays in `client/src/App.jsx`.

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

`category` is `groceries`, `wedding`, `camping`, or `custom`. If the prompt mentions one of those occasions, that list wins over the selected tab.

Camping tab ideas — what that widget should surface for a trip — are in [docs/camping-widget.md](docs/camping-widget.md).

The home shell — side dock, pull bar, and the sheet that slides in — is described in [docs/ui-shell.md](docs/ui-shell.md).

## Team workflow

- Branch off `main` for each feature: `git checkout -b feature/thing`
- Open a PR and merge often to avoid big conflicts
- Never commit `.env` (it's gitignored)
