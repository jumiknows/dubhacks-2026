# Gesture pipeline

Reusable React gesture controls integrated into the application's existing Vite frontend. The two-hand demonstration is at `/gesture-lab` in `client/`; this module has no separate Vite app or server.

## Install and connect

From the repository root:

```powershell
npm.cmd --prefix gesture_pipeline ci
```

In the real frontend folder, install this local package, adjusting the relative path if necessary:

```powershell
npm.cmd install ../gesture_pipeline
```

Prepare the model and runtime in that app's public folder. This example assumes `client/`; use the actual frontend path:

```powershell
# Run from the repository root. npm runs the assets script inside gesture_pipeline/.
npm.cmd --prefix gesture_pipeline run assets -- --public-dir ../client/public
```

The host must serve `/models/hand_landmarker.task`, `/mediapipe/vision_bundle.js` and `/mediapipe/wasm/*`. The model is committed here; the loader/WASM files are generated from the locked npm dependency. Generated assets in this module's `public/mediapipe/` are ignored; the current `client/public/mediapipe/` copies are tracked by the host repository. Rerun the assets command after dependency updates. A deployment under a URL subpath needs matching asset URL changes in `recognizer.ts` and `tracker.worker.ts`.

For a linked source package, add these options to the host's existing Vite configuration:

```ts
resolve: { dedupe: ['react', 'react-dom'] },
optimizeDeps: { exclude: ['conjure-gestures'] },
```

Keep the host's existing React plugin. Deduplication makes the package use the same React instance as the app; excluding prebundling preserves Vite's worker URL transformation. React 18 is tested; the declared peer range also permits React 19.

Wrap the application once:

```tsx
import { GestureProvider, useGestureStatus } from 'conjure-gestures';

function HandControls() {
  const { camera, start, stop } = useGestureStatus();
  return <button onClick={camera === 'on' ? stop : start} disabled={camera === 'starting'}>
    {camera === 'on' ? 'Stop hand tracking' : 'Start hand tracking'}
  </button>;
}

// In the existing app entry point:
<GestureProvider>
  <HandControls />
  <App />
</GestureProvider>
```

The provider owns the camera, independent left/right cursors, native fist activation, scrolling and mouse/keyboard alternatives. Its stylesheet is imported automatically. Use `?gdebug=1` on the host app for tuning, timings and recording, or pass `debug` explicitly. Webcam access needs localhost or HTTPS.

## Connect UI actions

Native buttons, links and inputs accept the existing fist grab/release activation. Pinch selection emits `select`; cards and custom behavior need host handlers:

```tsx
import { useGestureEvents } from 'conjure-gestures';

useGestureEvents('reveal', () => showNextCard());
useGestureEvents('dismiss', event => dismissCard(event.target_id));
useGestureEvents('select', event => openItem(event.target_id));
```

Use `data-product-id="p1"` on cards, `data-gesture-id` on custom controls, `data-gesture-draggable` on draggable components, `data-drop-zone="tray"` on drop zones and `data-gesture-ignore` on developer controls. Select handlers should filter product IDs so a nested button does not also open its card.

Drag handlers must implement `drag_start`, `drag_move`, `drop` and `cancel` in the host UI. Events carry normalized viewport `x/y`, captured `target_id`, original `start_x/start_y` and optional `drop_target_id`. Apply transforms while dragging, commit on drop, and restore the original position on cancel. Pointer movement does not automatically implement application drag/drop behavior.

Put `data-gesture-scroll` on a catalogue with a bounded height and `overflow-y: auto`; the provider scrolls it automatically. It captures the starting surface so crossing an edge does not scroll a different pane. Scroll events carry `delta_y` in viewport heights; positive means toward later content.

The current live pose detector maps right-to-left to reveal, left-to-right to dismiss and up/down to catalogue scroll events. Existing fist/swipe navigation is preserved outside the new object grips. Thumb/index pinch emits press, select and drag events. The older pure engine and fixtures also exercise three-finger swipe rules; the live controller uses `pose.ts` for navigation.

## Two-hand object gestures

Both hands have independent filters, cursors, engines and pose detectors. One MediaPipe inference returns up to two hands; anatomical labels, not array order or screen position, assign their identities. Single-hand events include `hand_id`. Ambiguous labels cannot complete a two-hand action. Use the lab's label-swap checkbox if its L/R cursors do not match your anatomical hands.

- **Expand:** thumb/index pinch the same original with both hands, then pull left and right apart.
- **Collapse:** pinch components of the same group from left/right, then bring both hands horizontally toward the middle. Either hand can start on either side. The captured targets distinguish collapse from comparison of two originals.
- **Compare:** pinch two different original objects and bring both hands horizontally together. Either hand can start on either side.

Start with open hands; keep the middle finger out of the pinch. Release between gestures. Both hands must move, and each pair commits once. Brief losses pause recognition; a loss over `hands.handLostMs` cancels and requires reopening.

Objects opt in with `data-gesture-object`, `data-gesture-group` and `data-gesture-kind="original|component|group"`. Their object pinches reserve the participating hands from ordinary click/drag/swipe/fist handling. Other controls and the other hand remain independent. The host receives `expand`, `collapse`, `compare` plus `bimanual_start/progress/end/cancel`; it owns the underlying data and resulting UI.

See [the integration and test guide](../docs/two-hand-gestures.md) for markup, event payloads, group identity and running the lab. The example renders four components without changing or deleting the original product and compares supplied mock values according to a selected priority. It does not fetch real product specifications.

The normal app has a **Test gestures · spawn test objects** entry. The lab now loads primary targets automatically and offers 14 feature scenes, live trials, synthetic replay checks, pointer/tracking/timing evidence, subjective smoothness ratings and JSON export. Live accuracy remains unmeasured until camera trials are performed. `gestures.subscribeFrames` supplies diagnostic observations without React updates on every detection; native fist actions also emit `grab`/`release` events. Captured drags suppress navigation swipes, and navigation retains the starting card or scroll surface.

## Files

| Path | Purpose |
| --- | --- |
| `src/gestures/index.ts` | Public React hooks, provider, bus and types |
| `camera.ts`, `recognizer.ts`, `tracker.worker.ts` | Camera and MediaPipe model, off the UI thread when supported |
| `features.ts`, `tracks.ts` | Landmark measurements and independent left/right identity tracking |
| `bimanual.ts` | Pure captured-pinch coordination for expand, collapse and compare |
| `hands.ts`, `replay.ts` | Primary-hand compatibility for older fixture assessments |
| `engine.ts`, `config.ts` | Gesture state machine and validated thresholds |
| `mapping.ts`, `oneEuro.ts`, `presentation.ts` | Index pointer mapping, smoothing and display-rate presentation |
| `hitTest.ts` | UI targeting, native activation and scroll surfaces |
| `bus.ts`, `types.ts`, `useGestures.tsx` | Events and React integration |
| `adapters/`, `ui/` | Input alternatives, camera preview, cursor, hints and debug controls |
| `__tests__/`, `__fixtures__/`, `replay.ts` | Unit tests, synthetic recordings and deterministic replay |
| `scripts/` | Asset preparation, fixture generation and assessments |
| `public/models/hand_landmarker.task` | Pretrained hand model; keep this file |

Source entries in the table are under `src/gestures/` unless a longer path is shown.

## Tune and assess

Adjust `config.ts` or the debug sliders. Browser overrides persist under `conjure.gesture.config.v3`; Reset restores defaults and stops tracking. Restart after camera/model changes. The debug overlay separates detection FPS, drawing-loop FPS, model mean/p95 timing and processing round-trip time. None measures physical motion-to-screen latency.

Defaults: camera 640×480 at 30 FPS; index-pointer smoothing `minCutoff: 1`, `beta: 0.015`; display following time 18 ms. Pinch closes below 0.25 palm lengths and opens above 0.4, with 35 ms confirmation and 50 ms release debounce. Three fingers arm after 70 ms, need 0.09 camera-dimension travel and a 1.5 direction ratio, and tolerate 120 ms pose dropout. Looser swipe thresholds caused accidental actions in the seeded assessment. Compare camera resolution and smoothing on real hands before changing defaults.

```powershell
# Run inside gesture_pipeline/
npm.cmd run typecheck
npm.cmd test
npm.cmd run gestures:metrics
npm.cmd run gestures:assess -- --sweep
```

Vitest runs unit/replay regressions, identity tracking and two-hand transaction tests. The seeded assessment checks 950 older engine scenarios at 15–60 detection updates per second; it does not assess the live pose detector or two-hand interactions. Synthetic success does not establish physical accuracy. Frontend integration tests live in `client/tests/gesture-lab.spec.js`; run `npm.cmd run test:gestures -w client` from the repository root.

In the host's debug mode, press R, point steadily for 300 ms, perform one gesture, release, and press R again. Label expected actions: `select`, `drag_start,drop`, `reveal`, `dismiss`, `scroll_forward` (hand up), `scroll_backward` (hand down), or empty for no action. Move the downloaded JSON to `src/gestures/__fixtures__/`. Recordings store landmarks, handedness, starting configuration, processing timings and hit-test results, not video. Keep settings unchanged during a recording.

`gestures:metrics` checks exact actions, duplicates, targets and labelled scrolling. Add `-- --recorded-config` to reproduce recorded settings, or `-- --config overrides.json` to assess a candidate. Recorded hit tests preserve targeting and cannot establish cursor accuracy under a changed mapping; verify that live.

`npm.cmd run gestures:metrics -- --require-real` requires at least 20 camera trials each for click, drag, reveal, dismiss and both scroll directions, plus 120 seconds of no-action movement. This starting evidence gate still needs diverse users/conditions, target devices and physical latency measurements. Bundled fixtures are synthetic and do not satisfy it.

The live controller supports independent two-hand controls and the three object transactions. Two-hand zoom and speech capture remain future work. Older recording/metrics tools replay the primary-hand engine only; use the lab's two-hand landmark replays and browser suite for these transactions. Voice integration can eventually emit events through the same bus.

Last implementation verification: **201 gesture tests + 14 assessment tests + 15 browser tests passed**, along with type checking and the production build. The browser suite verified all 14 feature replays against their UI effects. These results establish automated software behavior; real camera accuracy and physical latency still require live measurements. See [the current framework overview](../gesture_plan.md) and [lab file map](../docs/two-hand-gestures.md#lab-file-map).
