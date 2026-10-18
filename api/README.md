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
`api/.venv/bin/python -m api.scripts.smoke --verbose` (with the API running). If the output shows
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
  other `npm run dev`, or run this one on another port: `api/.venv/bin/uvicorn api.main:app --port 8010`.

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
- **Before merging:** `api/.venv/bin/python -m pytest api/tests` passes and the smoke test shows
  ALL PASSED.
