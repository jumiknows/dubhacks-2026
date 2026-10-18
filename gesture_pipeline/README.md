# Gesture pipeline

Reusable React gesture controls for the application's existing Vite frontend. This folder has no standalone demo, dev server or browser-test app. Integration into the frontend branch is a separate step.

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

The host must serve `/models/hand_landmarker.task`, `/mediapipe/vision_bundle.js` and `/mediapipe/wasm/*`. The model is committed here; the loader/WASM files are generated from the locked npm dependency and ignored by Git. Rerun the assets command after dependency updates. A deployment under a URL subpath needs matching asset URL changes in `recognizer.ts` and `tracker.worker.ts`.

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

The provider owns the camera, pointer, native component activation, scrolling and mouse/keyboard alternatives. Its stylesheet is imported automatically. Use `?gdebug=1` on the host app for tuning, timings and recording, or pass `debug` explicitly. Webcam access needs localhost or HTTPS.

## Connect UI actions

Native buttons, links and inputs accept pinch-clicks automatically. Cards and custom behavior need host handlers:

```tsx
import { useGestureEvents } from 'conjure-gestures';

useGestureEvents('reveal', () => showNextCard());
useGestureEvents('dismiss', event => dismissCard(event.target_id));
useGestureEvents('select', event => openItem(event.target_id));
```

Use `data-product-id="p1"` on cards, `data-gesture-id` on custom controls, `data-gesture-draggable` on draggable components, `data-drop-zone="tray"` on drop zones and `data-gesture-ignore` on developer controls. Select handlers should filter product IDs so a nested button does not also open its card.

Drag handlers must implement `drag_start`, `drag_move`, `drop` and `cancel` in the host UI. Events carry normalized viewport `x/y`, captured `target_id`, original `start_x/start_y` and optional `drop_target_id`. Apply transforms while dragging, commit on drop, and restore the original position on cancel. Pointer movement does not automatically implement application drag/drop behavior.

Put `data-gesture-scroll` on a catalogue with a bounded height and `overflow-y: auto`; the provider scrolls it automatically. It captures the starting surface so crossing an edge does not scroll a different pane. Scroll events carry `delta_y` in viewport heights; positive means toward later content.

Gesture directions: right-to-left reveals an item; left-to-right dismisses the starting card. With thumb/index/middle together, moving up scrolls toward lower items and moving down goes back. The direction locks until release. Thumb/index pinch presses; stationary release clicks, while holding and moving can drag.

## Files

| Path | Purpose |
| --- | --- |
| `src/gestures/index.ts` | Public React hooks, provider, bus and types |
| `camera.ts`, `recognizer.ts`, `tracker.worker.ts` | Camera and MediaPipe model, off the UI thread when supported |
| `features.ts`, `hands.ts` | Landmark measurements and primary-hand selection |
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

Vitest runs unit/replay regressions without a standalone Vite UI. The seeded assessment checks 950 held-out rule scenarios at 15–60 detection updates per second. Synthetic success does not establish physical accuracy. Browser/demo tests were removed with the standalone playground; integration tests belong to the real frontend.

In the host's debug mode, press R, point steadily for 300 ms, perform one gesture, release, and press R again. Label expected actions: `select`, `drag_start,drop`, `reveal`, `dismiss`, `scroll_forward` (hand up), `scroll_backward` (hand down), or empty for no action. Move the downloaded JSON to `src/gestures/__fixtures__/`. Recordings store landmarks, handedness, starting configuration, processing timings and hit-test results, not video. Keep settings unchanged during a recording.

`gestures:metrics` checks exact actions, duplicates, targets and labelled scrolling. Add `-- --recorded-config` to reproduce recorded settings, or `-- --config overrides.json` to assess a candidate. Recorded hit tests preserve targeting and cannot establish cursor accuracy under a changed mapping; verify that live.

`npm.cmd run gestures:metrics -- --require-real` requires at least 20 camera trials each for click, drag, reveal, dismiss and both scroll directions, plus 120 seconds of no-action movement. This starting evidence gate still needs diverse users/conditions, target devices and physical latency measurements. Bundled fixtures are synthetic and do not satisfy it.

The model can detect two hands, but interaction currently uses one primary hand. Independent two-hand controls, two-hand zoom and speech capture are future work. Voice integration can eventually emit events through the same bus.
