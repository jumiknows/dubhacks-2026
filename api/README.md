# Conjure API

FastAPI backend for Conjure. Runs fully on mock data with an empty `.env`.

```bash
npm run api:setup                     # once: creates api/.venv and installs requirements
cp api/.env.example api/.env          # optional, every key is optional
npm run dev                           # API on :8000 plus the rest of the app
npm run api                           # or: just the API
api/.venv/bin/python -m pytest api/tests      # tests
api/.venv/bin/python -m api.trust.make_mock   # regenerate mock catalog + trust reports
```

Interactive docs: http://localhost:8000/docs · Status: http://localhost:8000/health

All brands in the mock catalog are fictional.
