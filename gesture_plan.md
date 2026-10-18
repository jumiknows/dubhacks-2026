# Gesture plan: stable selection and edge-case handling

This plan defines the gestures for the shopping UI and the rules that make them reliable when the index finger moves while the user forms a fist. The screen-level flow stays minimal: scroll groups vertically, browse components horizontally, then hold a chosen listing to act on it.

The implementation details and alternatives live in [docs/gesture-logic.md](docs/gesture-logic.md). This file is the product contract and rollout plan.

## Core interaction model

1. The open-hand index fingertip controls the pointer.
2. The pointer target becomes stable before a fist action can capture it.
3. A fist requires a short, stable transition; it is never recognized from one frame.
4. During fist formation, the index may move inward. The system keeps the last stable target instead of re-hit-testing from the moving fingertip.
5. A partial close that stops, a hand aimed at the camera, a lost hand, or an ambiguous pose cancels safely.
6. A pinch/drag capture, fist capture, and swipe capture are mutually exclusive.

## Gesture map

| Gesture | Target | Action | Commit condition | Cancel condition |
| --- | --- | --- | --- | --- |
| Open-hand point | Any visible target | Move pointer / highlight target | Stable hover | Target absent or tracking lost |
| Thumb-index pinch and release | Button or component | Activate native control | Pinch stays past `confirmMs`, then releases | Movement, target loss, or hand loss |
| Thumb-index pinch and move | Draggable target | Drag and drop | Travel passes `drag.minDist`; release drops | Hand loss or cancelled pinch |
| Closed fist hold | Component | Open its product stage | Fist closes after `closeMs`; captured hover target stays selected | Index stalls partly curled, target disappears, or hand is lost |
| Closed fist dwell | Group | Select the group and reveal its components | Closed fist remains over the group for 1 second | Fist opens, target changes, tracking is lost, or the dwell is released early |
| Closed fist hold | Store listing | Start listing hold and add item to cart | Closed fist remains over the listing for 1 second | Release, pointer exit, target loss, or tracking loss |
| Pinched swipe up/down | Vertical purchase rail | Move between large purchase groups | One dominant axis and minimum travel | Diagonal motion, cooldown, or tracking loss |
| Pinched swipe left/right | Horizontal component rail | Browse component cards | One dominant axis and minimum travel | Diagonal motion, cooldown, or tracking loss |
| Two-hand pinch apart | Same collapsed group | Break into components | Both hands stay captured and exceed split travel | Different groups, one hand lost, or release before travel |
| Two-hand pinch together | Same broken group | Recombine components | Both captured hands converge within close gap | Different groups, one hand lost, or mismatched release |

## Fist/index closing rules

### Detection sequence

1. While open, update hover from the index fingertip and retain the last stable target for the hover-sticky interval.
2. When the other four digits curl and the index begins moving inward, arm a close candidate.
3. Keep the candidate alive only for `indexMotionGraceMs`. The index must either continue inward or reach the fully curled threshold.
4. Require all digits to satisfy `curlOn` for the committed `grab` event.
5. At commit, use the engine's last stable hover target as the grab target. Do not use the fingertip's new location if it moved during the close.
6. On opening, require `curlOff` plus `openMs` so a noisy frame does not release the grab.

### Safety rules

- A single extended index never counts as a fist.
- A partial index curl that stops past the grace window never counts as a fist.
- Fingers pointing toward the camera are rejected because their 2D geometry is ambiguous.
- A hand that disappears cancels its capture and cannot confirm it when it reappears already closed.
- A target change during the closing motion does not retarget an already-armed grab.
- A new fist cannot start until the prior fist has fully opened.

## UI behavior

### Purchase groups

- Groups remain in one large vertical scroll rail.
- Clicking a collapsed group opens its components; individual plans open directly and do not expose group controls.
- Each broken group shows a horizontal component rail and a mouse **Recombine group** button.
- Mouse wheel, trackpad, touch, and scrollbar scrolling work without camera input.

### Components and products

- Clicking a component opens the product stage.
- A fist hold over a component uses the stable pre-close target and opens the same stage.
- A fist held over a group for 1 second selects that group. The group shows a green progress rail and selection badge, then reveals its components when the dwell completes. Opening the fist or losing the target cancels the indicator.
- The product stage lists store listings vertically.
- A listing exposes the same 1-second hold behavior for mouse and fist input: mouse press-and-hold and closed-fist hold are equivalent; release early cancels; completion marks the item **In cart**.
- Mark owned, Mark purchased, and Close remain native keyboard-accessible buttons.

### Feedback

- Hover: target outline.
- Close candidate: subtle pressed state; do not show a committed action yet.
- Grab committed: captured target highlight and gesture chip.
- Listing hold: progress bar and active border.
- Cancellation: clear progress and pressed styling without changing data.
- Wrist-facing camera: show “Rotate your wrist”.

## Reconfiguration values

Fist thresholds are centralized in `gesture_pipeline/src/gestures/config.ts` under `defaults.fist`:

| Setting | Purpose |
| --- | --- |
| `closeMs` / `openMs` | Time required for close/release hysteresis |
| `curlOn` / `curlOff` | Separate entry and exit thresholds |
| `pointingReach` | Index extension that keeps the hand open |
| `indexTransitionMaxReach` | Maximum index extension allowed during inward close motion |
| `indexClosingDelta` | Minimum inward movement between frames |
| `indexMotionGraceMs` | How long a partial close may remain armed |
| `aimedZGap` | Depth gap used to reject fingers aimed at camera |

The config storage key is versioned whenever these semantics change. Tuning controls must respect the bounds and preserve the ordering relationships between paired thresholds.

## Edge-case ideas and tradeoffs

1. **Stable-target anchoring** — selected because it directly prevents index motion from changing the target. It requires a short hover dwell before closing.
2. **Short close dwell** — selected to filter one-frame pose noise without making the interface feel slow.
3. **Motion-aware grace window** — selected so a moving index can finish curling, while a stopped half-curl expires safely.
4. **Pointer freeze on close** — useful as a visual supplement, but not sufficient alone because the hit target may already be wrong.
5. **Confidence scoring** — a future improvement for live camera trials; would expose “uncertain” instead of guessing.
6. **Second confirmation gesture** — safer for destructive actions, but too slow for ordinary product selection.
7. **Per-user calibration** — useful for hand size, camera distance, and lighting; should tune thresholds within safe bounds rather than replace the safety rules.

## Implementation checklist

- [x] Centralize fist thresholds and version persisted config.
- [x] Add index-inward grace handling to pose recognition.
- [x] Anchor fist grabs to the last stable hover target.
- [x] Keep one-finger-out and camera-facing rejection rules.
- [x] Document edge cases and alternative strategies in `docs/gesture-logic.md`.
- [x] Add synthetic tests for moving-index completion and stalled partial close.
- [ ] Run live trials at multiple distances, lighting levels, hand sizes, and camera angles.
- [ ] Tune thresholds from recorded trials without weakening the safety rules.
- [ ] Add a visible “uncertain gesture” state if live false-positive rate remains high.

## Verification

```powershell
npm.cmd --prefix gesture_pipeline test
npm.cmd --prefix gesture_pipeline run typecheck
npm.cmd run build -w client
```

Synthetic tests establish the event/state contract. Live camera trials are required before claiming physical accuracy or latency improvements.
