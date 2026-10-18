# OrbiCart and EmberReady web

Node.js 24. Next.js App Router, TypeScript, and MapLibre. Install from the repository root so the workspace lockfile is used.

```bash
npm ci
npm run dev
npm run typecheck
npm run test
npm run build
npm run start
npm run test:browser
```

Run these commands from the repository root. `npm run dev` starts Next internally on port 3000, the public Express gateway on port 3001, and the preserved Python backend on port 8000. Open `http://localhost:3001` for OrbiCart trip planning. The wildfire workspace is at `/fires`, the DubHacks shopping workspace at `/shop`, and the gesture test lab at `/gesture-lab`. See the [root setup](../../README.md) for Python installation and port configuration.

The Next frontend uses the retained DubHacks services through the same public origin. OrbiCart's server-owned offers flow through `/api/orbicart/plans`, listing selection, and checkout. Shared gesture controls register the shopping cards and preserve the original camera engine. `npm run smoke:app` checks the built frontend, Express, and Python together with local fixture data.

The main shopping view uses the DubHacks board in place of the rain map, with Grok beside it. Open, expand, hold, compare and drag actions share focused items, selected listings, cart contents and remaining budget with an active Grok session. Grok's shopping tools use the same board callbacks and backend APIs. Context updates do not start a spoken turn. Asking Grok to check out opens cart review, and payment still requires the user's confirmation. Trip forecasts and NASA evidence remain beside the board. `/fires` retains its map and voice behavior.

Copy `apps/web/.env.example` to a private environment file. `FIRMS_MAP_KEY` and `XAI_API_KEY` stay on the server. Without a FIRMS key, live observations use the fixed public NOAA-20 24-hour CSV and filter it to Washington. A key enables the bounded SNPP Area API. No xAI key means spoken briefings and conversation return an unavailable state. The replay snapshot still loads.

Voice is fail-closed. Use `VOICE_ACCESS_MODE=private-site` only behind the owner-private Sites boundary. This mode requires site identity and rejects code-only access even if an old access code remains in the runtime. For another host, set `VOICE_ACCESS_TOKEN` and enter that demo access code in the Voice panel. The per-process ten-minute quotas are 20 speech requests and five sessions. The browser ends conversation after two minutes. These are demo controls, not a global provider spending cap. Set a provider account budget before wider access.

`npm ci` validates and bundles the checked-in replay. The web server reads that immutable bundle without runtime filesystem access. Live snapshots are retained in process memory, up to 32 IDs. Restart and another server instance can make a live ID unavailable. Replay IDs survive restart.

The basemap defaults to `https://tiles.openfreemap.org/styles/liberty`. The place list and briefing remain usable when tiles do not load.

Grok may stream an answer much faster than playback. The client accepts up to 120 seconds of queued audio for community briefings and up to 180 seconds for the longer shopping session. Each incoming chunk counts toward the bound. Stop and context changes release scheduled sources. An 80-second burst and over-limit cleanup are covered by tests.

An Earthdata bearer token is not a `FIRMS_MAP_KEY`. Obtain the separate key through the [official FIRMS map-key page](https://firms.modaps.eosdis.nasa.gov/api/map_key/). The public NOAA-20 fallback needs neither credential.
