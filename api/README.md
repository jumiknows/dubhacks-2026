# Conjure API

FastAPI backend for Conjure. Runs fully on mock data with an empty `.env`.

```bash
python3 -m venv api/.venv
api/.venv/bin/pip install -r api/requirements.txt
cp api/.env.example api/.env          # optional, every key is optional
api/.venv/bin/uvicorn api.main:app --reload   # run from the repo root
api/.venv/bin/python -m pytest api/tests      # tests
api/.venv/bin/python -m api.trust.make_mock   # regenerate mock catalog + trust reports
```

Interactive docs: http://localhost:8000/docs · Status: http://localhost:8000/health

All brands in the mock catalog are fictional.
