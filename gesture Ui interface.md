# Gesture UI

Hands control the whole screen. Camping and wedding are not in the dock. Groceries and electronics stay, and they do not share a layout. A swipe is ignored for 0.5 seconds after one is recorded, so a bounce or a second twitch does not fire twice. That pause applies to the sidebar, the grocery boxes, and the electronics rows.

This page describes the planner mapping at `/`. Live navigation requires a thumb/index pinch. Pinch click/drag and independent left/right tracking are also supported by the pipeline; host handlers apply their UI effects. The separate [gesture lab](docs/two-hand-gestures.md) supplies ready-made targets and assessment for all current controls.

## Sidebar and main frame

The dock starts tucked on the right, with a thin edge showing.

1. Swipe left. The sidebar slides out.
2. The selected widget, starting with the top one, sits farther left than the others. That offset is the selection.
3. Swipe up or down while the sidebar is out and nothing is open. The selection moves one widget and that icon sticks out.
4. Swipe left again. The selected widget is pulled into the main frame.
5. Swipe right. Step back one level: an open item closes, then the main frame closes, then the sidebar tucks away.

A second left swipe does nothing once the widget is already in the main frame. Swipe right is the way back.

## Lists

Each submitted query is appended to one permanent vertical list. One-finger pan, or a pinched swipe up/down, moves through every group the user still needs.

Grab the same group with both hands and pull apart to split it into pieces. Those pieces scroll horizontally. Grab one piece and hold to lift it to the center with buyable listings. Hold a listing for two seconds to mark it in the cart (yellow). Swipe up, or bring both fists together, to cancel. Swipe up/down while split to recombine and keep moving; both fists together to recombine in place.

Black = owned, green = purchased, yellow = cart, red = still needs buying.

## Grab and release

Close every finger, thumb included, to grab. Open the hand to release.

- Grab highlights the control under the index finger.
- Holding a piece lifts it. Holding a product for two seconds adds it to the cart.
- A fist with one finger still out is not a grab.
- Fingers pointed at the camera are not a grab. The gesture panel says to rotate the wrist.

## Edge cases

- A swipe in the same direction inside 0.5 seconds is dropped. The hand moving back the other way is dropped for 1.1 seconds, so a left swipe is not undone by the return to the right.
- Live navigation uses thumb/index pinching. Older three-finger rules exist in the pure engine but are not the current live navigation path.
- A diagonal move is not a swipe. The hand has to commit to one axis.
- Pinching can emit selection and dragging events. A captured draggable owns its motion and suppresses navigation swipes. Fist activation remains available for native controls.
- Swipe left while a grocery item or the electronics board is already open does not open a second copy.
- Swipe right on the home screen, with the sidebar already hidden, does nothing.
- Swipe up or down on the home screen, before the sidebar is out, does not change selection.
- Swipe up or down while a grocery box is open does not skip to another day. Close it first.
- Selection stops at the first and last widget, and at the first and last grocery box or device. It does not wrap.
- Pointing at the camera cancels an in-progress swipe and shows "Rotate your wrist".
- Tracking that drops mid-swipe does not finish the swipe from the old fingertip.
- Wrist rotation is the primary swipe signal; deliberate pinched palm translation is also supported as a fallback.
- The gesture panel and the hand-tracking button ignore grabs, so a fist cannot turn the camera off.

## Two-hand objects and assessment

Explicitly annotated objects support three paired thumb/index pinch actions: pull one original apart to expand its grouped components, bring components of the same group together horizontally to restore the original, and bring two distinct originals together horizontally to compare values. Each hand retains its own cursor and interaction state; a paired object grip reserves only its participating hands. Both hands must move, targets remain captured, and each hold commits once.

The planner's normal page does not automatically create test products. Use **Test gestures · spawn test objects** on `/` to open `/gesture-lab`, which loads a primary and comparison object automatically. Spawn/reset controls and the feature selector prepare each test without a backend. The lab's catalogue demonstrates scrolling; the planner retains the one-item mappings above.

**Run all feature replays** checks all 14 current tasks through the controller and UI. For real accuracy, select a feature and hand, start the camera and begin a live trial. Reports separate live and synthetic results, measure task errors, tracking/pointer behavior and software timing, and support perceived-smoothness ratings and JSON export. See [the testing guide](docs/two-hand-gestures.md) for the workflow and measurement limits. Physical hand accuracy and motion-to-screen latency are not established by synthetic tests.
