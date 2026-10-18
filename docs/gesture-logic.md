# Gesture logic and edge-case playbook

This file explains the gesture state machine behind the planner. It is intentionally separate from the screen-level contract in `gesture_plan.md`: this document describes how landmarks become stable actions and what should happen when tracking is imperfect.

## Design goals

- Keep the index fingertip as the pointer while the hand is open.
- Treat a fist as a deliberate state transition, not a single-frame pose.
- Capture the target before the index finger moves inward.
- Never let a closing fist jump from one target to another.
- Prefer cancellation over an accidental click, cart addition, split, or recombine.
- Make every threshold tunable in `gesture_pipeline/src/gestures/config.ts` and version persisted tuning values when semantics change.

## Current state machine

```text
unknown ── stable open ──> open/tracking
   │                         │
   │ index closing + other   │ closed pose for closeMs
   │ fingers curled           ▼
   └──────────────────────> closed/grabbed
                              │
                              │ open evidence for openMs
                              ▼
                         open/released
```

The classifier uses hysteresis:

- `curlOn` is the stricter threshold used to enter a fist.
- `curlOff` is looser and is used to leave a fist, preventing one noisy frame from releasing it.
- `closeMs` and `openMs` require temporal stability.
- `aimedZGap` rejects fingers pointed into the camera, where 2D curl ratios are unreliable.

## Index-finger movement during fist formation

The common failure is: the user points at a product, curls the other fingers, and moves the index inward. The fingertip crosses the product boundary before the fist event is emitted. If hit testing uses the final fingertip location, the grab may target a neighboring product or nothing.

The solution has two layers:

1. **Pose grace window** — when the other four digits are curled and the index reach is moving inward, the detector arms a closed transition. It keeps that transition alive only for `indexMotionGraceMs`; a partly curled index that stops moving does not become a fist.
2. **Target anchoring** — when `grab` is emitted, the loop prefers the last stable hover target stored by the engine over the current `input.hoveredId`. The current fingertip may be inside the palm or over a different element, but the original target remains captured.

The one-finger safety rule remains intact: an index that stays extended does not satisfy the closing-motion rule, and `allCurled` must still be true before the grab commits.

## Edge-case decisions

| Situation | Detection / response |
| --- | --- |
| Index moves inward across a card boundary | Use the last stable hover target at `grab`; ignore the later hit target |
| Index stops half-curled | Expire the grace window; no grab |
| One finger stays extended | Reject `allCurled`; no grab |
| Fingertips point at camera | Reject fist/swipe classification and show “Rotate your wrist” |
| One noisy open frame during a fist | Keep the closed state until `curlOff` and `openMs` are satisfied |
| One noisy closed frame during opening | Keep the pending transition; do not emit grab again without a full open |
| Hand disappears while holding | Cancel the capture; never replay it on reappearance |
| Hand reappears already closed | Require a fresh open-to-closed transition before grabbing |
| Two hands cross | Preserve anatomical left/right identity; do not use screen x-order |
| Two-hand pair loses one hand briefly | Pause within the configured loss window; cancel after the timeout |
| Pair starts on different groups | Reject the paired action; never merge unrelated groups |
| Diagonal swipe | Require one dominant axis; otherwise remain in tracking |
| Swipe bounces back | Apply same-direction and reverse-direction cooldowns |
| Pinch and fist overlap | Pinch/drag owns its capture; fist actions do not start while a pinch interaction is active |
| Target disappears during hold | Cancel the hold and clear pressed styling |
| Lighting or scale makes the hand too small | Do not switch to a new hand immediately; wait for the hand tracking timeout |

## Candidate solutions considered

### A. Freeze the pointer as soon as curl starts

Pros: simple and visually stable. Cons: needs a reliable curl-start signal and can freeze over empty space if the user begins away from a target. This is useful as a visual presentation rule, but it is not sufficient by itself.

### B. Use a dwell before recognizing a fist

Pros: reduces accidental fist activations. Cons: makes the UI feel slow and still does not solve target retargeting if the fingertip moves during the dwell. Keep the dwell short and use it only as part of hysteresis.

### C. Capture the last stable hover target

Pros: directly solves the target-crossing failure and works with existing DOM hit testing. Cons: the user must keep the hand over a target long enough for the hover state to settle. This is the selected approach, with the pose grace window as a companion.

### D. Require a fist plus a second confirmation gesture

Pros: very low accidental activation. Cons: poor discoverability and too much effort for frequent shopping actions. Reserve this for destructive actions, not selection.

### E. Add a confidence score to every pose

Pros: gives the UI a measurable way to show uncertainty and lets tests tune false positives versus false negatives. Cons: more data and calibration work. The current implementation uses explicit evidence and timers; confidence scoring is the next extension if camera trials show unstable results.

## Configuration

Fist-related thresholds live under `defaults.fist` in `config.ts`:

- `closeMs`, `openMs`: temporal hysteresis.
- `curlOn`, `curlOff`: entry and exit curl thresholds.
- `pointingReach`: index reach above which the hand is treated as pointing/open.
- `indexTransitionMaxReach`: furthest index reach accepted during an inward closing motion.
- `indexClosingDelta`: minimum frame-to-frame inward movement.
- `indexMotionGraceMs`: maximum time the partial close can remain armed.
- `aimedZGap`: depth separation used by the camera-facing rejection rule.

Changing gesture semantics increments the local-storage config key so stale tuning values do not silently override the new behavior.

## Test matrix

At minimum, every classifier change should cover:

1. Stable open hand.
2. Stable fist emits one `grab`.
3. Stable open after a fist emits one `release`.
4. One extended finger never emits `grab`.
5. Index moves inward while the other fingers curl and still emits `grab`.
6. Index stops partly curled and does not emit `grab`.
7. Fingers aimed at camera produce the wrist-turn hint.
8. Brief tracking loss cancels the interaction and does not re-arm it.
9. Two-hand pair actions preserve hand identity and require a fresh release.
10. Pinch drag, swipe, and fist actions remain mutually exclusive when captures overlap.

Run:

```powershell
npm.cmd --prefix gesture_pipeline test
npm.cmd --prefix gesture_pipeline run typecheck
```

Live camera trials are still required for physical accuracy, lighting, distance, and motion-to-screen latency. Synthetic tests verify the state machine and UI event contract, not real-world hand performance.
