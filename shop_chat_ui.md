# Chat shop UI

There are no pre-built widgets. The right panel is chat history. The main frame is the current buy node: either a **group** (an event or kit) or a **sku** (one thing that can be bought). The first answer to a prompt is the best things to buy for that use case, as a group.

## Layout

- **Left panel.** Item history, like a chat. The user prompt is the first bubble. Each thing to buy is a later bubble. Green = purchased, red = still open. Tapping a bubble focuses that node in the center.
- **Center.** The active node. A group shows a concept image. A sku shows relevant store listings.
- **Right panel.** Conversation history, newest at the bottom. Each turn is the user prompt or a short assistant recap of what the list became. Pinch-left / pull opens this panel. Pinch-right closes it or steps back one zoom level if a group is open.
- **Home prompt.** Still the first input. After that, follow-ups type into the chat composer at the bottom of the right panel. They refine the same plan; they do not spawn a second widget.

The dock of Groceries / Electronics / Custom is gone and stays gone.

## Nodes

Every row in the plan is a node.

```
node = {
  id,
  kind: "group" | "sku",
  name,
  reason,
  purchased,          // sku only. Groups derive purchased from children.
  children: node[],   // group only
  products,           // sku: possible relevant listings
  synthesis,          // sku: chosen / best offer
  conceptImage,       // group: simple picture of the idea (tent, cake, laptop bag)
}
```

- **sku.** Something you can actually buy. Opening it lists possible relevant items (color, size, store, price). One of those can become `synthesis`.
- **group.** An event or a bundle that needs several purchases. Camping is a group. The tent inside it can be a group too (rainfly, stakes, footprint) or a sku if it is one product.

The first model pass after the prompt returns a **root group** named after the use case, with children that are the best things to buy. It does not dump a flat checklist of widgets.

## Views

### Root (after prompt)

Show the root group’s concept image, large. Around or on that image, the child nodes are hotspots.

Example: prompt “get ready for camping” → image of a campsite / tent. Hotspots: tent, sleeping gear, stove, light, water.

### Group selected (zoom)

Selecting a group (fist confirm, or click) **zooms into** its concept image. The previous image recedes. Child nodes appear on the zoomed picture.

Example: select the tent → zoom into the tent. Stakes, rainfly, footprint, and the tent body itself are the next nodes.

Back / pinch-right zooms out one level.

### Sku selected

No concept zoom. The frame lists **possible relevant items**: the `products[]` for that sku, with price, store, and stock. Confirming one sets `synthesis`. Marking purchased flips `purchased`.

## Color

Purchased state is the only color language on the concept image and the sku list.

- **Green** — purchased (or a group whose children are all purchased).
- **Red** — not purchased (or a group with anything still open).
- A group that is mixed uses red on the group hotspot until every child is green.

Do not use extra status colors. Green/red have to read on the dark shell and on the concept image.

## Chat history (right panel)

Each plan mutation appends a turn:

1. User: the prompt text.
2. Assistant: one line, e.g. “Camping kit — 8 things to buy. Open the tent to see parts.”
3. Later user follow-up: “make it for two people.”
4. Assistant: what changed.

The panel is history, not a widget picker. Tapping an older assistant turn can restore that zoom target (`focusNodeId`) but does not rebuild a different widget type.

## Gestures (current rules)

Pinch, then swipe. Fist to select.

- Pinch left: open the chat panel, or keep it open.
- Pinch right: close the chat panel, or zoom out if a group is focused.
- Pinch up / down: one listing or one hotspot at a time.
- Fist grab / release: highlight then confirm the hotspot or listing under the index.

A swipe without a pinch is ignored. Same-direction cooldown 0.5s. Opposite-direction ignore 1.1s.

## Backend

`planner.js` should return a **tree**, not a flat `items[]`. Until a model is wired:

- Classify the prompt as **event/group** vs **single sku**.
- Event → root group + child nodes (camping, wedding, groceries-as-a-run, etc.).
- Single sku prompt (“a laptop”) → root is a sku with `products[]` from fetchBot.

### Concept image — TODO

`conceptImage` is a **backend TODO**. Do not block the UI on a generator.

Until then:

- `server/services/conceptImage.js` (new) returns a placeholder: `{ status: "todo", prompt, alt }`.
- The UI draws a labeled silhouette / simple SVG stand-in from `alt` (tent, cake, …) so zoom and hotspots can be built.
- Later that service generates a simple image that encompasses the concept (one tent, not a collage of SKUs) and stores a URL on the group node.

Hotspot positions (`x, y, r` in image space) can be stubbed per template until the image model also returns regions.

## Where it goes

- `shop_chat_ui.md` — this file.
- `client/src/ui/PlannerUI.jsx` — shell: left item history + main stage + right chat panel. No widget dock.
- `client/src/ui/ItemHistory.jsx` — left chat-style list of items to buy.
- `client/src/ui/ConceptStage.jsx` — (new) group image, zoom, hotspots, green/red.
- `client/src/ui/SkuList.jsx` — (new) possible relevant items for a sku.
- `client/src/ui/ChatRail.jsx` — (new) conversation history + follow-up composer.
- `server/services/planner.js` — emit `kind`, `children`, `conceptImage`.
- `server/services/conceptImage.js` — TODO stub.
- `server/services/fetchBot.js` / `synthesizeBot.js` — unchanged contract for sku `products` / `synthesis`.
- Gestures stay in `gesture_pipeline`; mapping stays pinch-swipe + fist.

## Done when

A prompt produces a root group of the best things to buy, shown as one concept picture with red/green hotspots. Selecting a group zooms into that concept and shows the next nodes. Selecting a sku shows possible relevant listings. The right panel is only chat history. There is no widget picker. Concept photos are still a backend TODO with a silhouette stand-in.
