# DUB HACKS 2026

React (Vite) frontend + Express backend.

## Setup

```bash
npm install                            # installs everything (client + server)
cp server/.env.example server/.env     # add API keys here
npm run dev                            # runs both apps
```

- Frontend: http://localhost:5173
- Backend:  http://localhost:3001 (the frontend proxies `/api/*` to it)

## Structure

```
client/          React app (Vite)
  src/App.jsx    main UI — start here
server/          Express API
  index.js       API routes
```

## Team workflow

- Branch off `main` for each feature: `git checkout -b feature/thing`
- Open a PR and merge often to avoid big conflicts
- Never commit `.env` (it's gitignored)
