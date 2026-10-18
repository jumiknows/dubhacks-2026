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

Copy `apps/web/.env.example` to a private environment file. `FIRMS_MAP_KEY` and `XAI_API_KEY` stay on the server. Without them, live observations and spoken briefings return an unavailable state. The replay snapshot still loads.

The basemap defaults to `https://tiles.openfreemap.org/styles/liberty`. The place list and briefing remain usable when tiles do not load.
