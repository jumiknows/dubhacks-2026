# Gesture UI

Hands control the whole screen. Camping and wedding are not in the dock. Groceries and electronics stay, and they do not share a layout. A swipe is ignored for 0.5 seconds after one is recorded, so a bounce or a second twitch does not fire twice. That pause applies to the sidebar, the grocery boxes, and the electronics rows.

## Sidebar and main frame

The dock starts tucked on the right, with a thin edge showing.

1. Swipe left. The sidebar slides out.
2. The selected widget, starting with the top one, sits farther left than the others. That offset is the selection.
3. Swipe up or down while the sidebar is out and nothing is open. The selection moves one widget and that icon sticks out.
4. Swipe left again. The selected widget is pulled into the main frame.
5. Swipe right. Step back one level: an open item closes, then the main frame closes, then the sidebar tucks away.

A second left swipe does nothing once the widget is already in the main frame. Swipe right is the way back.

## Lists

Inside groceries, swipe up to move one box later and swipe down to move one box earlier. The same up and down swipes move one row through the electronics fleet. The 0.5 second pause applies between those swipes too.

Groceries stays a week of meal boxes. Electronics is a health board: a fleet table, a battery trend, and a safety-update table. Swiping there changes which device the tables and the graph describe. It does not open a meal-style card.

## Grab and release

Close every finger, thumb included, to grab. Open the hand to release.

- Grab highlights the control under the index finger.
- Release confirms the control that was grabbed, even if the hand drifted. It does not select whatever is under the finger at the end.
- A grocery box opens or closes on release.
- A dock icon becomes the selection and sticks out. It does not open the main frame. Swipe left does that.
- An electronics row becomes the focused device, and the trend and the safety table follow it.
- Grab on empty space, then release, does nothing.
- A fist with one finger still out is not a grab.
- Fingers pointed at the camera are not a grab. The gesture panel says to rotate the wrist.

## Edge cases

- A swipe in the same direction inside 0.5 seconds is dropped. The hand moving back the other way is dropped for 1.1 seconds, so a left swipe is not undone by the return to the right.
- Three fingers together is not a gesture. Swipes use the index finger. Selection uses a closed fist.
- A diagonal move is not a swipe. The hand has to commit to one axis.
- A pinch is ignored. It is not a click, a swipe, or a grab. Selection is a closed fist.
- Swipe left while a grocery item or the electronics board is already open does not open a second copy.
- Swipe right on the home screen, with the sidebar already hidden, does nothing.
- Swipe up or down on the home screen, before the sidebar is out, does not change selection.
- Swipe up or down while a grocery box is open does not skip to another day. Close it first.
- Selection stops at the first and last widget, and at the first and last grocery box or device. It does not wrap.
- Pointing at the camera cancels an in-progress swipe and shows "Rotate your wrist".
- Tracking that drops mid-swipe does not finish the swipe from the old fingertip.
- A whole-hand slide, with the index finger keeping the same angle, is not a wrist swipe.
- The gesture panel and the hand-tracking button ignore grabs, so a fist cannot turn the camera off.
