# Conjure API

FastAPI backend for Conjure. Runs fully on mock data with an empty `.env`.

```bash
npm run api:setup                     # optional: pip-installs requirements into this Python
cp api/.env.example api/.env          # optional, every key is optional
npm run dev                           # API on :8000 plus the rest of the app
npm run api                           # or: just the API
python -m pytest api/tests            # tests
python -m api.trust.make_mock         # regenerate mock catalog + trust reports
```

Uses the Python on your PATH (or `PYTHON` if set). No virtualenv.

Interactive docs: http://localhost:8000/docs · Status: http://localhost:8000/health

All brands in the mock catalog are fictional.

## Team setup: API keys

Keys live in `api/.env`, which is **never committed** (git ignores it), so they can't leak when
the repo goes public.

1. Ask a teammate for the team's `api/.env` file (sent by DM, never posted in a channel or committed).
2. Save it as `api/.env` in your copy of the repo, next to `.env.example`.
3. Restart `npm run dev`.
4. Check http://localhost:8000/health: `"elevenlabs": "live"` means voice is on.

No file? Everything still runs: the app uses the rule-based agent and the browser's own speech
instead. To make your own: `cp api/.env.example api/.env` and fill in the keys you have.

Never paste keys into Slack/Discord channels, GitHub issues, or code. If one leaks, rotate it in the
provider's dashboard and send the team the new file.

## Turning on the AI and voice

Set these in `api/.env` (copy from `.env.example`), then restart. `/health` shows what's live.

| Feature | Variables | Without them |
|---|---|---|
| LLM agent | `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL` (any OpenAI-compatible provider) | Rule-based fallback agent answers |
| Voice | `ELEVENLABS_API_KEY` (+ optional `ELEVENLABS_VOICE_ID`) | `/stt/token` and `/tts` return 503 with the browser fallback to use |

Example for Gemini:

```
LLM_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai
LLM_API_KEY=your-key
LLM_MODEL=gemini-2.5-flash
```

**Check it works:** `/health` should say `"llm": "live (...)"`. Then run
`python -m api.scripts.smoke --verbose` (with the API running). If the output shows
`source: fallback`, LLM calls are taking longer than 4 s: switch to a faster model or raise `LLM_TIMEOUT_S`.

The LLM never pays and never sees raw review text. Each turn allows at most 4 tool calls and 1 cart
proposal, staging a cart needs an explicit "yes", and any number it says must appear in a tool
result. A call over `LLM_TIMEOUT_S` (4 s) falls back to the rule-based agent. After 3 failures in a
row, the circuit breaker skips the LLM for 60 s. After 2 anomalous turns, that session switches to
the fallback agent for good (kill switch).

## Troubleshooting

- **`localhost:8000` hangs or won't load.** The API's auto-reloader can crash if it reloads while a
  file is half-saved, and it doesn't always recover. Stop `npm run dev` (Ctrl-C) and start it again.
- **"address already in use" on port 8000.** Another copy of the API is still running. Stop the
  other `npm run dev`, or run this one on another port: `python -m uvicorn api.main:app --port 8010`.

## Marketplace fetch (planner)

Express `fetchBot.js` calls these:

- `POST /market/search` `{ query, marketplaces, limit, details }`
- `POST /market/details` `{ urls, query }` (live Selenium only)
- `POST /market/synthesize` `{ item, products, weights? }`
- `POST /market/compare` `{ left, right, trust_floor? }` — pairwise. Each side already has `bang_per_buck`, `relevancy`, `trust`.
- `POST /market/top` `{ items, limit?, trust_floor? }` — about ten best, same fields. Default `limit` 10, `trust_floor` 0.5.

Express proxies those as `POST /api/compare` and `POST /api/top`.

`SELENIUM_ENABLED=false` (default) returns fixture listings. Chrome must be installed for live mode. Comparison ideas live in `docs/product-compare.md`.

## For the frontend

The contract is in [`shared/types.ts`](../shared/types.ts). Try any endpoint in `/docs`.

- **`POST /chat` streams Server-Sent Events**, in this order:
  - `trace`: what the agent and safeguards did (tool calls with timing, products removed by
    filters, policy checks). Use it for the glass-box receipt.
  - `action`: a `UIAction` to apply to the screen (show results, open compare, stage checkout, ...).
  - `say`: one sentence of speech. Start text-to-speech on the first one.
  - `done`: `{ grounded, source }`. `grounded: false` means the AI's own wording was replaced
    with a safe sentence built from catalog data. `source` is `"llm"` or `"fallback"`.
  - `error`: a short message; the stream still finishes normally.
- **Send `ui_context` with every chat message.** `visible_ids` are the cards on screen and
  `focused_id` is the one the user is pointing at, so "this one" works.
- **`POST /tts` `{ text }`** returns MP3 audio for one sentence. **`GET /stt/token`** returns a
  single-use token for ElevenLabs realtime speech-to-text (expires in 15 minutes).
  If either returns 503, use the browser instead: the response's `fallback` field says which
  (`web_speech` for listening, `speech_synthesis` for speaking).
- **TODO(verify):** the ElevenLabs realtime speech-to-text WebSocket URL and model id the browser
  should connect to with that token. Check the ElevenLabs "Speech to Text: Realtime" docs.
- **Checkout sheet:** render it only from the `cart` and `policy` in the `stage_checkout` action,
  never from what the assistant said. The user signs `cart_payload` exactly as received.

## For backend contributors

- **Who owns what:** the agent and voice code live in `api/agent/`, `api/voice.py` and
  `api/guard/grounding.py`; checkout, payments and the other guards live in `api/checkout.py` and
  `api/guard/`. Whoever changes an endpoint updates `api/schemas.py` and `shared/types.ts` in the
  same commit.
- **Circuit breaker state** for `/security`: `breaker.status()` in `api/sessions.py`.
- **Policy checks already stream as `trace` events** whenever a cart is staged (`stage_checkout`
  in `api/agent/tools.py`).
- **Before merging:** `python -m pytest api/tests` passes and the smoke test shows
  ALL PASSED.
