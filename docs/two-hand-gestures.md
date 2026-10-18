# Two-hand object controls

## Run the demonstration

From the repository root:

```powershell
npm.cmd ci
npm.cmd --prefix gesture_pipeline ci
npm.cmd --prefix gesture_pipeline run assets -- --public-dir ../client/public
npm.cmd run dev -w client
```

Open **http://localhost:5173/** and click **Test gestures · spawn test objects**, or open **http://localhost:5173/gesture-lab** directly. The normal `/` page is the planner, which waits for a plan result; it does not spawn test products itself. The test entry opens a populated scene without a backend, camera or API key. Products and specifications are fictional local data. Both `/gesture-lab` and `/gesture-lab/` work.

The primary Alpine object and comparison Camp object load automatically above the assessment report. **Clear objects**, **Spawn primary object**, **Spawn comparison object** and **Load test scene** make that setup explicit. Collapse loads an expanded group; reveal loads an empty navigation surface; the other tasks load their own controls or catalogue. Starting a live trial resets its scene so results do not depend on the previous task.

Try **Replay expand → Replay collapse → Replay compare**. These generate two sets of 21 labeled landmarks, then pass them through `gestures.processFrame`: identity tracking, feature extraction, pointer mapping, DOM targeting, the coordinator and the UI subscribers. They do not emit action events directly. Replay events have `source: 'replay'`; camera events have `source: 'hand'`.

## Assess accuracy, responsiveness and robustness

Choose **Test feature** to load a task and read its instruction. The 14 tasks cover pointing, pinch selection, pinch drag/drop, horizontal reveal/dismiss, both catalogue scroll directions, fist grab/release, expand, collapse, compare, independent simultaneous drags, one-hand tracking loss while the other continues, and open-hand no-action movement. The live navigation recognizer currently uses thumb/index pinching; the older three-finger navigation rules in the pure engine are not the live navigation path. A captured draggable now owns its motion, so dragging cannot also trigger navigation. Navigation retains its captured starting card or scroll pane when the cursor moves away.

**Run all feature replays** checks every task through the current controller and verifies its resulting UI. **Replay selected feature** repeats one task with the selected hand. An expected event without its actual UI effect does not pass. These are synthetic software regressions; the camera column stays **Not tested**.

For real hand testing:

1. Start the camera. Confirm the L/R cursors match your hands; stop and swap labels if needed.
2. Choose the feature, hand and trial duration. For two-hand tasks the required hands are fixed by the instruction. Add lighting/distance/device notes.
3. Click **Begin live trial**. The scene resets automatically. Start open, perform the instructed task once, and release. For pointing, hold the selected pointer inside the 32 px target for a continuous second. For no-action, move open hands for at least five seconds.
4. Finish the trial or let its timer finish. A timeout with no recognized action fails; stopping/resetting/hiding the page records an incomplete run. Mouse/keyboard inputs cannot satisfy a camera task.
5. Rate perceived smoothness (1–5) for the current or last trial. Repeat each feature with both hands where applicable. Export the session JSON before changing configurations, then compare a second session under the same conditions.

The report keeps camera and replay results separate. Each functional trial requires the expected action, hand, target/drop target and UI change, with no duplicates or unexpected actions. Pointing and no-action trials also require the relevant hands to be identified in at least 80% of observed results. Incomplete runs are excluded from pass rates; untested features remain untested. A pass is functional evidence, not a production-readiness certification.

| Evidence | Meaning and limit |
| --- | --- |
| Misses, duplicates, unexpected actions, missing UI changes | Task accuracy against the selected instruction; the operator must actually attempt the task. |
| Camera results/s and cursor render FPS | Detection throughput and display-loop cadence; neither alone establishes low physical latency. |
| Model / processing p95 in exports | Per-result model time and capture/transfer/inference processing time. |
| Result gaps and required-hand coverage | Responsiveness and tracking continuity during this trial; coverage is a fraction of observed results, not every camera frame. |
| Event → updated UI frame p95 | Time from event emission until the intended DOM state is observed in a rendering callback. It does not measure physical motion-to-photon latency. |
| Cue → first expected action | Includes user reaction and gesture travel/hold time. It must not be interpreted as recognition latency. |
| Target error p95 and stationary pointer RMS | Pointing error relative to the explicit target, and variability of the pointer inside that target. User movement and landmark/filter jitter both contribute. |
| Perceived smoothness 1–5 | Human assessment; no synthetic score replaces it. |

Test bright/dim light, near/far hands, slow/fast movement, small targets, hands crossing, temporary occlusion, a missing hand, long holds, repeated releases and ordinary no-action movement. Repeat enough trials per feature and condition to expose occasional failures; inspect misses and false activations rather than relying on an aggregate pass rate. Physical latency needs a separately recorded timing reference, such as high-frame-rate video of the hand and display.

JSON exports include configuration snapshots, camera/backend/viewport metadata, labeled events, per-result pointer/ratio/hand observations, UI effect checks, timing summaries and notes. They contain no video and stay on your machine unless you share the download. Sessions retain up to 100 trials; the export states any discarded trials. Truncated recordings are incomplete.

For live use, start the camera and show both open hands briefly. L is your anatomical left hand and R your right. If reversed, stop and use **Swap left/right labels**, then start again. This swaps identities independently of pointer mirroring. The lab requests two tracked hands even if a saved camera configuration requested only one.

1. **Expand:** put both index pointers on the same original. Pinch thumb + index with each hand and move left hand left, right hand right. Four detail components appear inside their original group.
2. **Collapse:** point at left and right components of that group. Pinch with thumb and index finger on each hand, then bring both hands horizontally toward the middle. The original is restored with its data intact. Either hand can start on either side. The same inward motion on two distinct originals compares them instead.
3. **Compare:** with both originals visible, pinch a separate original with each hand and bring them horizontally together. Either hand can start on either side. The comparison shows price, weight, temperature, volume and insulation; changing the selected priority changes the preferred product.

Keep the middle finger away from the thumb/index contact. Both hands must move. Release both pinches between transactions. Pinches capture the initial objects, so subsequent movement can leave their boundaries. Keep the initial targets visible; zoom out or use a larger window if the lab says a replay target is outside the viewport. A narrow phone layout cannot support the horizontal demo as comfortably.

## Connect actual objects

An original:

```jsx
<article data-gesture-object="bag-a"
         data-gesture-group="bag-a"
         data-gesture-kind="original">
  ...
</article>
```

When expanded, keep the parent ID and render its components within it:

```jsx
<article data-gesture-object="bag-a"
         data-gesture-group="bag-a"
         data-gesture-kind="group">
  {components.map(component => (
    <div key={component.id}
         data-gesture-object={`bag-a:${component.id}`}
         data-gesture-group="bag-a"
         data-gesture-kind="component">
      ...
    </div>
  ))}
</article>
```

Group identity is explicit and independent of the number of children. Keep source objects in application state and derive their component views; collapsing should hide the derived view, not reconstruct a product from disconnected pieces. IDs must be unique and stable. The demo in `client/src/gesture-lab/GestureLab.jsx` demonstrates this with four children per parent.

Subscribe through `useGestureEvents` or `gestureBus.on`:

| Event | Payload and host action |
| --- | --- |
| `expand` | `group_id` identifies the original. Show its child components. |
| `collapse` | `group_id` identifies the expanded parent. Restore its original view. |
| `compare` | `target_ids` contains two distinct original IDs. Show their values and tradeoffs. |
| `bimanual_start` / `bimanual_progress` | `gesture`, `interaction_id`, `hand_ids`, `target_ids`, `progress` for feedback. |
| `bimanual_end` / `bimanual_cancel` | End feedback; cancel does not undo an already committed action. |

Action events have the same interaction ID as their lifecycle events, plus `gesture`, `hand_ids: ['left','right']`, captured `target_ids` and `group_id` for expand/collapse. Compare target order follows anatomical left/right hand, not price, screen order or preference. The host must validate IDs against its current data before applying changes. Progress reports travel, so it can reach 100% before an inward gesture is close enough to commit. A transaction ends after release or cancellation, after its action may already have committed.

Only explicitly annotated objects participate. Their thumb/index grips reserve those hands from ordinary click, drag, navigation swipe and fist activation from the first captured pinch. A hand acting elsewhere retains its own engine and cursor. Nested buttons are separate controls; `data-gesture-ignore`, disabled and inert regions do not capture objects. Standard one-hand events carry `hand_id: 'left' | 'right'`; host drag reducers should use that key if they need concurrent drags. Existing navigation hosts may still intentionally gate navigation globally.

The lab comparison chooses a product by the selected single priority; it is not an opaque overall score. Insulation is shown without ranking. Real catalogue integration needs actual, comparable data and explicit handling of unknown specifications.

## Tune and diagnose

`gesture_pipeline/src/gestures/config.ts` contains:

| Setting | Default | Effect |
| --- | --- | --- |
| `mp.numHands` | 2 | One inference detects both hands. Restart camera after changing. |
| `hands.minHandednessConfidence` | 0.65 | Below this, a hand remains visible but cannot complete a paired action. |
| `hands.swapHandedness` | false | Swap anatomical labels; independent from `mapping.mirror`. |
| `pinch.on` / `pinch.off` | 0.25 / 0.4 | Close/open distances divided by palm size. Hysteresis avoids chatter. |
| `pinch.confirmMs` / `pinch.releaseMs` | 35 / 50 | Minimum closed time and opening debounce. |
| `bimanual.armMs` | 100 | Minimum pair hold before committing. |
| `bimanual.minStartGap` | 0.12 | Starting separation as a fraction of the viewport axis. |
| `bimanual.minTravel` | 0.07 | Required travel from each hand along the chosen axis. |
| `bimanual.closeGap` | 0.16 | Maximum final separation for inward gestures. |
| `bimanual.dominance` | 1.4 | Axis travel must dominate perpendicular drift. |
| `hands.handLostMs` | 250 | Short gaps pause; longer gaps cancel and require opening. |

Open `/gesture-lab?gdebug=1` for the two-hand knobs, model/processing timings and camera overlay. The source model, mapping, filters and render pacing remain shared; each hand has its own filter and interaction state. Camera inference is never duplicated per hand. Cursor presentation runs at display refresh without submitting extra camera inferences.

Labels determine identities even when hands cross and the detector's result order changes. Duplicate labels and sudden large jumps pause assignment. Low-confidence or missing hands cannot complete paired actions. A brief dropout can resume the same captured pair; prolonged loss requires reopening. No pose recognizer can fully eliminate occlusion or confident handedness errors. Verify against real users and target devices.

## Verification

Last implementation verification, before this documentation-only update:

| Check | Result |
| --- | --- |
| Gesture unit/regression tests | 201 passed |
| Assessment unit tests | 14 passed |
| Browser integration tests | 15 passed |
| Feature replay tasks with verified UI effects | 14 passed |
| Type checking and production Vite build | Passed |

Camera browser tests used a synthetic video stream. Live hand accuracy remains unmeasured until real camera trials are collected.

```powershell
npm.cmd --prefix gesture_pipeline run typecheck
npm.cmd --prefix gesture_pipeline test
npm.cmd run build -w client
npm.cmd run test:gestures -w client
```

The client test command first runs the assessment unit tests, then the browser suite with an installed Google Chrome and a temporary Vite server on port 5187. Set `$env:PLAYWRIGHT_CHANNEL = 'msedge'` to use Edge instead. Its camera checks use Chromium's synthetic camera, never your physical webcam. Tests cover the normal-app launcher and spawning, grouped expansion/restoration, handedness calibration, comparison priorities, three laptop sizes, rejection of one-hand/child comparisons, concurrent ordinary drags, one-hand tracking loss, Escape/reset interruption, worker/model startup, all 14 measured replays, and exclusion of mouse clicks from live accuracy. Playwright is a client development dependency; reports are ignored.

Unit tests cover separation, movement by both hands, diagonal rejection, wrong groups, release debounce, tracking loss, uncertain labels, recapture, duplicate suppression and independent identities. The older `gestures:metrics` and seeded assessment scripts only replay the legacy primary-hand engine; they do not certify the new coordinator or current live pose navigation. Synthetic tests demonstrate the software path, not live hand-detection precision or physical latency.

Two-hand zoom and fist-to-speech are not implemented by these changes.

## Lab file map

All paths below are relative to `client/src/gesture-lab/`.

| File | Purpose |
| --- | --- |
| `GestureLab.jsx` | Scene selection, spawn/reset controls, gesture-driven UI effects and trial orchestration. |
| `FeatureScene.jsx` | Primary/grouped objects, pointer target, click control, draggable tiles, tray and catalogue. |
| `assessment.js` | The 14 task definitions, expected-action checks, timing summaries and bounded report data. |
| `useAssessment.js` | Frame subscriptions, trial lifecycle, UI-effect observations, ratings and JSON downloads. |
| `AssessmentPanel.jsx` | Separate camera/replay results, metrics, failures and session controls. |
| `replay.js`, `featureReplay.js` | Labeled synthetic landmarks and motion sequences through the real controller. |
| `data.js`, `lab.css` | Fictional product values and test-environment layout. |

`client/tests/assessment.test.js` checks scoring and measurement rules. `client/tests/gesture-lab.spec.js` checks the app entry, scene effects, all feature replays and camera-scoring workflow.


Two-hand object actions use thumb/index pinches; closed fists do not expand, collapse or compare. Ordinary draggable controls retain pinch dragging. Annotated object grips are reserved for the paired actions.
