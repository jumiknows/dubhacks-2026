# EmberReady product brief

Parent: [implementation epic #10](https://github.com/jumiknows/spacex2026Hacks/issues/10)

## Product

EmberReady turns satellite observations into a briefing a community can understand, hear, and share.

The first user is a community coordinator, such as a librarian or volunteer organizer, who wants to understand what has changed near a town without interpreting a technical GIS dashboard.

Working pitch: "EmberReady shows nearby NASA thermal observations, explains their age and source, and provides a readable or spoken community briefing."

## One complete user flow

1. Select a Washington community from a searchable list.
2. See nearby NASA thermal observations on a map and in a keyboard-accessible list.
3. Move the observation timeline and inspect changes at each time.
4. Ask Grok Voice, "What changed near this community, and how old is the evidence?"
5. Read or hear a briefing that cites the selected observations, timestamps, limitations, and official information links.
6. Copy or print the same briefing for another person.

## Why this is worth building

Wildfire maps and alerts already exist. Watch Duty is an established example, so another map with an AI chat box is a weak differentiator.

Our product hypothesis is that a source-grounded, accessible briefing and historical observation replay can help community organizers understand and communicate what the data actually says. Validate that with a few observed user tasks. Do not claim this need or advantage is already proven.

The memorable demo moment is hearing Grok explain the exact place and time selected on the map, then moving the timeline and seeing the evidence and briefing change together.

## Scope

| Priority | Deliverable |
| --- | --- |
| P0 | One runnable app with real NASA observations and a verified replay dataset |
| P0 | Reproducible data job, raw-source lineage, quality report and immutable snapshot interface |
| P0 | Map, accessible place list, source inspector, and explicit freshness states |
| P0 | Deterministic proximity context and observation change summary |
| P0 | Actual Grok Voice integration with readable transcript and speech fallback |
| P0 | A reliable deployed demo, regression checks, and Cursor build evidence |
| P0 | Human-reviewed cases proving the briefing matches its selected evidence |
| P1 | NWS weather context, shareable briefing, and a second reviewed language |
| P2 | NASA dated imagery comparison and a terrain or contour layer |

Build one complete P0 flow before adding layers. Mining, mineral prospecting, ignition prediction, evacuation routing, social media feeds, account systems, and mobile apps are outside this MVP.

## Geography and time

Use Washington state for the initial live scope. Start with a small catalog of public communities. A satellite observation near a representative town coordinate does not establish exposure for every resident.

Select the historical demo date only after obtaining and inspecting real observations. Record the dataset source, retrieval time, date range, row count, and checksum. If Washington replay data cannot be obtained quickly, explicitly change the replay region and source manifest. Do not manufacture a local fire event.

Replay reconstructs satellite observation timestamps. It does not establish when an emergency agency or the public first knew about a fire.

## Trust in the interface

- Call points thermal observations or hotspots, not confirmed incidents.
- A density heatmap shows observations, not the probability of a fire or a fire perimeter.
- Explain the attention band with distance, observation time, and its rule version.
- Show retrieval time separately from observation time.
- Keep stale, missing, empty, and historical data visibly distinct.
- Provide text labels and symbols as well as color. Never use green to mean safe.
- Keep official information links visible. The product does not issue evacuation instructions.

## Visual direction

Use a light map, a compact place list, a right-side evidence panel and a timeline along the bottom. Use dark text and distinct observation and selection markers. Pair every status color with a text label. Use Segoe UI with Arial and sans-serif fallbacks. Set spacing in multiples of 4 pixels and use flat surfaces with neutral dividers.

The initial screen should answer three questions: where am I looking, when was this observed, and what can I inspect next? Use direct labels and concise explanations. Keep the wordmark as text and icons limited to map controls that need them.

Do not add gradient fills or text, glass effects, decorative card borders, headline badges, emoji headings, star logos, ornamental icon rows, grain textures or serif accents. Avoid Inter, Space Grotesk and Instrument Serif. Do not add scroll reveals, pointer-following effects or fading buttons. A component library must be styled to these rules before use. Keep hover and keyboard-focus states clear without lowering opacity.

Use plain prose without semicolons, long dashes or promotional filler. Preserve punctuation required by code and data formats. Keep technical detail in the evidence panel or implementation docs unless it helps the user interpret the data.

Use the [interactive design reference](prototype/README.md) for layout and interaction direction. Its fictional terrain, places and observations are visibly synthetic. Replace them with real data and an actual Grok integration in Cursor. The backend and later model research follow [data architecture](DATA_BACKEND.md) and [labeling/evaluation](LABELING_AND_ML.md).

## Acceptance targets

These are targets to measure, not completed results:

- A new user can select a community and find the latest observation time within 45 seconds.
- In three short usability sessions, record task completion, confusion, and time without inventing success rates.
- The full demo can be repeated three times from a clean browser session.
- No replay response includes an observation later than the selected time.
- Map, list, and voice use the same snapshot and selected place.
- Every displayed observation is traceable to its provider row or dataset manifest.
- The demo remains understandable if a map tile, NASA fetch, or voice request fails.

## Sponsor fit

The challenge text supplied by the team requires implementation with Cursor and use of Grok Imagine or Voice. This plan chooses Voice because it serves accessibility and comprehension directly.

Use Grok Bot for real planning or coordination if available and record the actual interaction. Creating these issues does not itself prove Grok Bot use. Confirm submission timing and category details from the organizer's current rules before submission.
