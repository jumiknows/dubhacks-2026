# Gesture framework and testing

This document describes the current implementation. [Gesture UI](gesture%20Ui%20interface.md) covers the planner's screen mapping; [the test and integration guide](docs/two-hand-gestures.md) covers the lab, event payloads and measurement limits.

## Current controls

| Input | Behavior |
| --- | --- |
| Index fingertip | Controls that hand's cursor. |
| Thumb + index pinch, then release | Emits a captured selection; the host applies its click/select behavior. |
| Hold thumb + index on a draggable and move | Drag the captured item; release drops it. Drag motion cannot also trigger navigation. |
| Pinched swipe right to left | Reveal an item or advance the planner's sidebar/widget flow. |
| Pinched swipe left to right | Dismiss the captured card or step back in the planner. |
| Pinched swipe up/down | Browse forward/backward in the captured catalogue; the planner can map this to one item per swipe. |
| Full fist, then open | Highlight the captured native control, then activate it. Also emits `grab` / `release`. |
| Both hands pinch one original and pull outward | `expand`: show its grouped components. The lab renders four. |
| Pinch components of one group from left/right and bring hands horizontally together | `collapse`: restore the original, retaining its data and group identity. |
| Pinch two different originals and bring hands horizontally together | `compare`: show values and priority-based tradeoffs. |

The live navigation path currently uses thumb/index pinching. Three-finger navigation rules remain in the older pure engine and fixtures; they are not the controller's live navigation path. Two-hand zoom and fist-to-speech remain future work.

## Tracking and recognition

One MediaPipe inference returns up to two hands. `tracks.ts` assigns independent left/right states by anatomical labels rather than result order or screen position. Each hand has its own engine, pose detector, pointer filter and cursor presentation. Single-hand events include `hand_id`; paired events include both hand IDs and captured object IDs.

The index tip drives the pointer. Mapping mirrors once, the One Euro filters reduce jitter, and display-rate presentation interpolates camera results without starting extra inferences. The default camera request is 640 × 480 at 30 FPS.

`pose.ts` reads wrist arcs in aspect-corrected pixel space, with a pinched palm-motion fallback. Its trail is about 220 ms; the wrist arc threshold is about 25 degrees and the direction dominance ratio is 1.4. Same-direction navigation waits 500 ms; the opposite direction is suppressed for 1100 ms to avoid undoing a swipe on the return movement. The planner also applies its existing 500 ms screen gate.

`bimanual.ts` coordinates two captured thumb/index grips. Annotated object grips reserve those hands from ordinary click, drag, fist and navigation actions. Both hands must move, each hold commits once, and release is required before another transaction. Brief missing or uncertain hands pause the pair; loss over the default 250 ms cancels it and requires reopening. A hand lost during an ordinary drag cancels its own interaction while the other hand can continue.

## Test environment

From the repository root, run `npm.cmd run dev -w client`. Open `/` and click **Test gestures · spawn test objects**, or visit **http://localhost:5173/gesture-lab**. The planner at `/` waits for plan data; the lab loads its own primary and comparison objects without a backend or camera.

The lab provides explicit spawn/reset controls and 14 task scenes: expand, collapse, compare, pointing, pinch click, drag/drop, reveal, dismiss, scroll up, scroll down, fist activation, simultaneous drags, tracking-loss recovery and no-action movement.

- **Run all feature replays** verifies synthetic landmarks through the actual controller and resulting UI.
- **Begin live trial** resets the selected scene and scores camera attempts against the expected hand, target, action and UI effect.
- Reports separate camera and replay evidence, flag misses/duplicates/unexpected actions, and expose hand coverage, result gaps, pointer error/jitter and software timing.
- Rate perceived smoothness and export configuration, observations, events and outcomes as JSON. Mouse/keyboard actions cannot pass a camera trial. Incomplete and untested runs are not counted as successes.

Synthetic passes establish the software path. Live accuracy, physical latency and perceived seamlessness still require camera trials on intended devices and conditions.

## Files

| Location | Purpose |
| --- | --- |
| `gesture_pipeline/src/gestures/loop.ts` | Camera lifecycle, independent hand states, DOM targeting, events and frame observations. |
| `tracks.ts`, `features.ts` | Left/right identity and landmark measurements. |
| `engine.ts`, `pose.ts`, `bimanual.ts` | Press/drag rules, live navigation/fist recognition and paired object transactions. |
| `mapping.ts`, `oneEuro.ts`, `presentation.ts` | Index pointer mapping, filtering and rendering. |
| `config.ts` | Validated tracking, mapping, pinch, drag and bimanual tuning. Live pose swipe constants are in `pose.ts`. |
| `hitTest.ts`, `bus.ts`, `types.ts`, `useGestures.tsx` | Targeting, public events/types and React integration. |
| `client/src/gesture-lab/` | Ready-made targets, synthetic replays, live trial scoring and reports. |
| `client/src/ui/swipeGate.js` | Planner-level navigation gate. |
| `gesture_pipeline/src/gestures/__tests__/`, `__fixtures__/` | Gesture regressions and older engine recordings. |
| `client/tests/` | Assessment unit tests and Chrome integration tests. |

Bare gesture filenames in the table are under `gesture_pipeline/src/gestures/`. Older `hands.ts` / `replay.ts` tooling remains for primary-hand fixture compatibility.

## Verification

```powershell
npm.cmd --prefix gesture_pipeline test
npm.cmd --prefix gesture_pipeline run typecheck
npm.cmd run test:gestures -w client
npm.cmd run build -w client
```

The last implementation verification passed 201 gesture unit/regression tests, 14 assessment unit tests and 15 browser tests, plus type checking and the production build. All 14 feature replays passed their UI-effect checks. Browser camera checks used a synthetic video device; they do not establish physical hand accuracy. The older seeded assessment only exercises the legacy engine.
