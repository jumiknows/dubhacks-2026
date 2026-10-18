# Gemini Live instead of the plan chat box

Replace the Planboard prompt form (`Build list`) with a live voice session on `/ws-live`. The backend relay is already in `api/live.py`. Gemini talks, calls Planboard tools, and the UI updates from those tools — not from a typed chat transcript.

Keep `POST /chat` for the Conjure skincare demo. Do not route Planboard shopping through SSE chat.

## What already exists

- Browser connects to `ws://localhost:5173/ws-live` (Vite proxies to FastAPI `:8000`).
- FastAPI opens Gemini BidiGenerateContent, sends audio setup + Planboard function declarations.
- Tools hit Express: `create_plan`, `get_plan`, `mark_purchased`, `compare_listings`, `set_trust_floor`, `list_shortlist`.
- After each tool, the browser also gets a `UI_UPDATE` JSON message (`PLAN`, `COMPARE`, `TRUST_FLOOR`, `SHORTLIST`) so the checklist can move while Gemini is still speaking.

## Session shape

1. User taps **Talk** (or the page auto-starts after a gesture). Browser asks for the mic.
2. Open WebSocket `/ws-live`. First client message is session metadata only (not Gemini):

```json
{ "type": "session", "plan_id": null, "trust_floor": 0.5 }
```

3. Stream 16 kHz PCM16 mono as either:
   - binary frames (relay wraps them as `realtimeInput.mediaChunks`), or
   - JSON `{ "realtimeInput": { "mediaChunks": [{ "mimeType": "audio/pcm;rate=16000", "data": "<base64>" }] } }`
4. Optional barge-in: `{ "realtimeInput": { "activityEnd": {} } }` when the user stops talking.
5. Play Gemini audio from `serverContent.modelTurn.parts[].inlineData` (typically 24 kHz PCM). Do not TTS the text yourself.
6. Apply `UI_UPDATE` immediately. Do not wait for the spoken turn to finish.

If the socket sends `{ "type": "error" }` or closes `4001`, show “voice is off” and fall back to the existing prompt form.

## UI contract (wire in `App.jsx` / `PlannerUI.jsx`)

| `action` | What to do |
|---|---|
| `PLAN` | `setPlan` from `payload` (id, items, quote). Hide the loading prompt. |
| `COMPARE` | `setCompare(payload)` for `item_id`. Highlight the two listings. |
| `TRUST_FLOOR` | `setTrustFloor(payload.trust_floor)` — no refetch. |
| `SHORTLIST` | scroll that item’s listing buttons into view. |

Spoken copy stays in Gemini’s audio. Do not add a chat log unless a judge asks for captions; if you do, render `serverContent` transcripts as captions only, not as the control surface.

Remove or demote: the category tabs as the only way to start, and the `Build list` submit. Tabs can still seed a spoken hint (“camping”) by sending a `clientContent` turn:

```json
{
  "clientContent": {
    "turns": [{ "role": "user", "parts": [{ "text": "I need to prepare for camping." }] }],
    "turnComplete": true
  }
}
```

That is a conversation turn, not a chat box.

## Frontend work (order)

1. **`client/src/live.js`** — `connectLive({ onUi, onAudio, onError })`: open socket, decode PCM, call `onUi`. Pause mic while the model is speaking unless you implement barge-in.
2. **`App.jsx`** — hold `liveStatus` (`idle` / `listening` / `speaking` / `error`). Apply `UI_UPDATE` with the same state you already use for plans and compare.
3. **`PlannerUI.jsx`** — replace the prompt form with a hold-to-talk or always-on orb. Keep the checklist, to-buy cards, trust slider, and compare sheet. Slider still calls `set_trust_floor` locally and can send `{ "type": "session", "trust_floor": n }` so the next compare uses it.
4. **Captions (optional)** — one live line under the orb from Gemini `outputTranscription` if the model is configured for it later. Not a message thread.
5. **Fallback** — if `/health.integrations.gemini_live !== "live"`, keep today’s form so the demo still builds a camping list without a key.

## Audio details

- Capture: `AudioContext` + `ScriptProcessor` or `AudioWorklet`, downsample to 16 kHz, Int16, little-endian, base64.
- Playback: queue Gemini chunks on a 24 kHz context; clear the queue on interrupt.
- Do not send the Gemini API key to the browser. Only `/ws-live`.

## Backend follow-ups (only if the first demo needs them)

- Add `pick_listing(item_id, product_id)` if “use this one” should persist `synthesis.best` without a click.
- Stream `create_plan` progress (`PLAN_PARTIAL`) so the checklist appears before all eight offers finish.
- Confirm the live model id in `GEMINI_LIVE_MODEL` against current Gemini Live docs (`gemini-2.0-flash-exp` is the default in config).

## What not to do

- Do not reimplement ElevenLabs STT/TTS for this path. Live audio is Gemini’s.
- Do not send full 50-per-site catalogs in tool replies; the relay already briefs the plan.
- Do not block the UI on Gemini finishing a sentence after `UI_UPDATE`.
- Do not delete Express `/api/plans`. Live tools depend on it.
