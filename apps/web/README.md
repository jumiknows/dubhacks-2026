# EmberReady web

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

`npm run dev` serves the Washington replay workspace at `http://127.0.0.1:3000`.

Copy `apps/web/.env.example` to a private environment file. `FIRMS_MAP_KEY` and `XAI_API_KEY` stay on the server. Without a FIRMS key, live observations use the fixed public NOAA-20 24-hour CSV and filter it to Washington. A key enables the bounded SNPP Area API. No xAI key means spoken briefings and conversation return an unavailable state. The replay snapshot still loads.

Voice is fail-closed. Use `VOICE_ACCESS_MODE=private-site` only behind the owner-private Sites boundary. This mode requires site identity and rejects code-only access even if an old access code remains in the runtime. For another host, set `VOICE_ACCESS_TOKEN` and enter that demo access code in the Voice panel. The per-process ten-minute quotas are 20 speech requests and five sessions. The browser ends conversation after two minutes. These are demo controls, not a global provider spending cap. Set a provider account budget before wider access.

`npm ci` validates and bundles the checked-in replay. The web server reads that immutable bundle without runtime filesystem access. Live snapshots are retained in process memory, up to 32 IDs. Restart and another server instance can make a live ID unavailable. Replay IDs survive restart.

The basemap defaults to `https://tiles.openfreemap.org/styles/liberty`. The place list and briefing remain usable when tiles do not load.

Grok may stream an answer much faster than playback. The client accepts up to 120 seconds of queued audio, including each incoming chunk, within the two-minute session. Stop and context changes release scheduled sources. An 80-second burst and over-limit cleanup are covered by tests.

An Earthdata bearer token is not a `FIRMS_MAP_KEY`. Obtain the separate key through the [official FIRMS map-key page](https://firms.modaps.eosdis.nasa.gov/api/map_key/). The public NOAA-20 fallback needs neither credential.
