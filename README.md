# ESPER

Say what you're getting ready for: "camping this weekend", "weekly groceries", "a new laptop". ESPER builds the shopping list, finds store listings for every item, and helps you pick the best one by comparing two listings side by side. Then it keeps the cart and checks out.

You can drive all of it four ways, and they share one screen:

| | How |
|---|---|
| **Hands** | Pull a group apart with two fists. Fist-hold a piece to open it. Pinch two listings, one per hand, and bring them together to compare. Hold a listing for 1 second, or pinch-drag it onto the cart, to buy it. |
| **Voice** | Press **Talk** and speak ("compare the tents", "use the winner", "check out"). Gemini Live answers out loud and moves the screen while it talks. |
| **Typing** | The same requests in the assistant panel on the right. |
| **Mouse** | Everything above has a click, hold or drag equivalent. |

The assistant can build, open, compare, pick and add to the cart, but it cannot pay: checkout always stops at a review sheet for you to confirm.

## Run it

```bash
npm ci              # Node 24
npm run api:setup   # once: creates api/.venv with the Python API (Python 3.11+)
npm run dev         # Python API :8000, Express :3001, client :5173
```

Open http://localhost:5173. With no keys at all, everything works on demo data: the typed assistant uses built-in rules, checkout is a mock order, and listings come from labelled fixtures.

To ship one origin instead: `npm run build && npm start`. Express then serves the built client on :3001, proxies the Python API, and tunnels the voice socket.

### Optional keys

| Turns on | Put in | Without it |
|---|---|---|
| Voice (Gemini Live) | `GEMINI_API_KEY` in `api/.env`. `GEMINI_LIVE_MODEL` defaults to `gemini-3.8-live`. | The Talk button says voice needs a key; typing still works. |
| Typed AI (any OpenAI-compatible model, e.g. Gemini) | `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL` in `api/.env` | Rule-based assistant handles plan / open / compare / pick / cart / bought / trust / checkout. |
| Real Stripe test payments | `STRIPE_SECRET_KEY=sk_test_…` (+ `STRIPE_WEBHOOK_SECRET`) in `server/.env` | Mock order with a receipt; live keys are refused. |
| More stores | Store keys in `server/.env` (see `server/.env.example`) | Keyless stores (Open Food Facts, UPCitemdb, Shopify, DummyJSON, Fake Store) plus fixtures. |
| Live marketplace pages | `SELENIUM_ENABLED=true` in `api/.env` (needs Chrome) | Amazon / eBay / Walmart fixtures. |

`/api/health` and `/api/conjure/health` report what is configured. Keys stay in ignored `.env` files and never reach the browser.

## Two-minute demo

1. Type or say **"I need to prepare for camping"**. A red *Camping kit* group appears, and the assistant summarises it.
2. Pull the group apart (two fists, or click). Open **2-person tent**.
3. Pinch two listings together (or press **Compare best two**). The sheet shows the scores, why, and a plain trade-off ("Walmart is $22.31 cheaper; Amazon is better reviewed and ships 2 days sooner"). Drag the **trust floor**: it rescores without refetching.
4. **Choose + add to cart**. The tent turns yellow. Pinch-drag a stove listing onto the cart.
5. Say **"check out"**, then **Place mock order**. The receipt appears, and the items turn green.

## How it fits together

```
client (React + Vite)  ──/api──▶  Express :3001  ──/api/conjure/*──▶  Python API :8000
  shop board, gestures              plans, listing picks,               marketplace search & scoring,
  assistant panel, voice            checkout (Stripe / mock),           planner assistant (/planner/chat),
  compare + cart sheets             store APIs, built client,           Gemini Live relay (/ws-live),
                         ──/ws-live─▶ voice tunnel  ─────────────────▶  review & website safety
```

- **Plans:** `server/services/planner.js` (templates) → `fetchBot.js` (Python marketplace search + store APIs in parallel) → `synthesizeBot.js` (exact-cents validation; the Python weighted scorer picks) → `pipeline.js`.
- **Compare:** `score = bang per buck × relevancy × trust multiplier` (`api/market/compare_service.py`, explained in [pitch.md](pitch.md)). A tie within 0.05 is reported as a tie, with the concrete trade-offs spelled out.
- **Assistant:** one tool set in `api/live_tools.py`, used by voice (`api/live.py`) and typing (`api/planner_chat.py`). Tool results become `UI_UPDATE` events the client applies (`client/src/App.jsx`).
- **Checkout:** `server/services/checkout.js` prices from the server's copy of the plan, never from the browser. One order can span several lists. Mock orders also post to the DummyJSON / Fake Store sandbox carts (`mockOrder.js`).
- **Gestures:** `gesture_pipeline/` (MediaPipe hands). Rules and edge cases: [gesture_plan.md](gesture_plan.md), [docs/gesture-logic.md](docs/gesture-logic.md). The two-hand lab is at `/gesture-lab`. Add `?gdebug` to the URL for the live pose readout.

The skincare shopping agent ("Conjure": `/api/conjure/chat`, signed mandates, review insights, website safety workbenches) is still in the Python API and documented in [api/README.md](api/README.md) and [BACKEND_HANDOFF.md](BACKEND_HANDOFF.md).

## Tests

```bash
npm test                                   # Express + Python API (offline)
npm --prefix gesture_pipeline test         # gesture engine
npm --prefix gesture_pipeline run typecheck
npm run build                              # client
```

## Known limits

- Plans live in server memory. The browser keeps your board across reloads and Stripe redirects, but restarting Express clears it.
- Without keys and Selenium, prices and stock are demo data, and the UI labels them that way.
- Voice depends on Google's Live API. The relay and the browser client are tested against a scripted stand-in, not against Gemini itself.
- Hand tracking is tuned on synthetic replays. Live trials at different distances and lighting are still open (see [gesture_plan.md](gesture_plan.md)).

## Team workflow

- Branch off `main`, open a PR, and merge often.
- Never commit `.env` files (they are gitignored).
