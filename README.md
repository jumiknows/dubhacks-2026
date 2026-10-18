# OrbiCart and EmberReady with DubHacks services

The primary application uses the SpaceX 2026 frontend and features, integrated with the DubHacks shopping backend and gesture system. Original SpaceX commits are preserved, with their original IDs, in the history of `integration/spacex-frontend`.

## Start

Use Node.js 24 (see `.nvmrc`) and Python 3.12.

```bash
npm ci
npm run api:setup
npm run dev
```

Open **http://localhost:3001**. The public Express server serves the Next application and both sets of APIs on the same origin. Next runs internally on port 3000 and the preserved Python API on port 8000. Stop the development command to stop all three processes.

For a production build:

```bash
npm run build
npm start
```

`NEXT_PORT`, `PORT`, and `API_PORT` can change the process ports. When changing them, set `ORBICART_WEB_URL`, `CONJURE_API_URL`, `PYTHON_API_URL`, `CLIENT_URL`, `APP_ORIGIN`, and `PLANBOARD_URL` to the matching origins. `PLANBOARD_URL` points Python's shopping tools back to the public Express origin. The web launcher keeps Next's port separate from Express's `PORT`.

## Application

| Route | Features |
| --- | --- |
| `/` | DubHacks gesture-controlled shopping board with Grok alongside it, OrbiCart camping trips, NASA and weather evidence, condition-based kits, budget planning, and integrated checkout |
| `/fires` | EmberReady wildfire observations, live/replay modes, accessible community list, timeline, research danger zones, provenance, briefing, printing, and Grok Voice |
| `/shop` | DubHacks generic shopping plans, saved lists, account onboarding, calendar suggestions, comparisons, assistant, review evidence, website checks, and checkout |
| `/gesture-lab` | Preserved gesture replay, camera trials, tuning, and assessment export |

The shared hand-control layer operates the new frontend. Point and pinch to select controls and use gestures on registered shopping targets. Mouse and keyboard controls remain available. Gesture diagnostics are available with `?gdebug`.

OrbiCart product retrieval uses `POST /api/orbicart/plans`. The server fetches and stores source catalog offers, then uses the DubHacks selection, quote, and checkout contracts. The browser submits item and listing IDs. Prices come from server-owned offers. Checkout captures the reviewed offer, reserves its items, and supports cancellation and return recovery. The original SpaceX `/api/recommend` route remains available.

NASA thermal observations, research rankings, weather evidence, sample catalog offers, and provider failures retain their source labels. Research rankings preserve their documented limitations and do not replace observation-based attention bands. See [research](research/README.md), [data contracts](docs/CONTRACTS.md), and [release evidence](docs/RELEASE_READINESS.md) for the original SpaceX feature boundaries.

## Configuration

Keep provider credentials in ignored files:

- `apps/web/.env.local` for the SpaceX Next application, based on `apps/web/.env.example`.
- `server/.env` for DubHacks Express, based on `server/.env.example`.
- `api/.env` for the Python assistant, based on `api/.env.example`.

Express configuration precedence is process environment, then `server/.env`, then private web defaults. Credentials stay on the server. Existing private configuration was copied locally without adding it to Git.

Grok Voice uses the original access controls. Local or public hosts need the configured voice access code. Authenticated private hosting may use the owner header only when the upstream host overwrites it and `TRUST_PRIVATE_SITE_HEADERS=true` is explicitly configured.

Without a Stripe test key, checkout uses an explicitly labelled mock order. `MOCK_ORDER_SANDBOX=off` disables sample-store network submission. Account preferences persist in ignored `server/data/`. Plan and checkout state currently live in Express memory and expire on restart.

The checked-in replay and seven days of research rankings are bundled by `npm ci` and `npm run build`. Gesture model and runtime assets are copied from the tracked gesture module into both web hosts during installation. Research downloads and trained runtime artifacts remain local as documented in [research setup](research/README.md).

## Vercel deployment

Deploy from the repository root. `vercel.json` defines the Next frontend, Express shopping service, and Python assistant as Vercel Services behind one public origin. Service bindings connect the backends. The existing shopping, gesture, and fire routes remain available.

Set `XAI_API_KEY`, `VOICE_ACCESS_TOKEN`, `EARTHDATA_TOKEN`, and `XAI_VOICE_MODEL=grok-voice-latest` in the Vercel project's environment variables. Set `APP_ORIGIN` and `CLIENT_URL` to the public HTTPS origin, and supply a stable `SESSION_SECRET`. Keep credentials out of Git. Add optional provider credentials from the service environment examples for the integrations you use.

Set `ACCOUNTS_FILE=/tmp/dubhacks/accounts.json` so account writes use Vercel's writable temporary directory. Accounts, sessions, shopping plans, and checkout state are currently local to a service instance and can reset when it restarts or traffic reaches another instance. A shared persistent store is required for durable accounts and carts across instances. Deployment configuration does not imply that deployment or live provider verification has completed.

## Verification

```bash
python3 tools/check_repo.py
python3 tools/check_imported_history.py
python3 -m unittest discover -s tests -v
npm run typecheck
npm run typecheck:gestures
npm run lint
npm test
npm run build
npm run smoke:backend
npm run test:browser
npm run smoke:app
```

The browser suite uses isolated ports 3081, 3080, and 8080 and disables paid providers. Install its browser with `npx playwright install chromium` when needed. Tests distinguish controlled fixtures from live provider checks. The research tests use their separate environment, described in [research](research/README.md).

## History and layout

[The import record](docs/integration/spacex-history.md) and [source manifest](docs/integration/source-history.json) record every original SpaceX commit and explain equivalent historical branches. `tools/check_imported_history.py` verifies that every original commit object remains an ancestor without replacement objects. CI fetches full history for that check.

- `apps/web`, `apps/pipeline`, `packages/domain`, `packages/data`, `research`, and `data` preserve the SpaceX application and research tooling.
- `server`, `api`, and `gesture_pipeline` preserve the integrated DubHacks services and hand controls.
- `client` retains the earlier ESPER frontend for reference and optional standalone development with `npm run dev:legacy`. The public application uses Next.

Both repositories' authorship and commit history are retained. The original SpaceX working tree is unchanged. No deployment or live provider verification is implied by this local integration.
