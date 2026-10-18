# Swipe by wrist rotation

Hands do two things. A swipe moves one item. A closed fist selects. Pinching is not a control.

The swipe direction is the direction the index finger points while the wrist turns. The palm can stay almost still. Scrolling, opening a box, and moving the sidebar are all that same swipe, one step at a time.

## Usage

There is no pinch. Thumb and index touching does not click, drag, or scroll.

Selection is the whole fist. Every finger, thumb included, must be curled. Grab highlights the control under the index finger. Release confirms that same control, even if the hand has drifted. A fist with one finger still out does nothing. Fingers pointed at the camera do nothing except the reminder to rotate the wrist.

Scrolling is a swipe, and each swipe moves exactly one item.

- Swipe up: the next grocery box, the next device row, or the next sidebar icon.
- Swipe down: the previous one.
- Swipe left: pull the sidebar out, or pull the selected widget into the main frame if the sidebar is already out.
- Swipe right: step back one level.

A second swipe inside 0.5 seconds is dropped. The list does not wrap. A swipe does not skip two boxes because the hand kept moving. The screen mapping is written out in `gesture Ui interface.md`.

## Detection

MediaPipe landmarks: wrist `0`, index knuckle `5`, index tip `8`. The pointer follows landmark `8`. The palm-center trail in `pose.ts` is the older signal. A wrist turn swings the index tip on an arc and can miss that trail, so the swipe uses the fingertip.

1. Accept a frame only when the index finger is the pointer. The tip must sit clearly past the knuckle (`dist(8, 0) / dist(5, 0)` above about 1.5). A curled index, a closed fist, or a thumb touching the index tip does not start a swipe.
2. Build the pointing vector from wrist to index tip in pixel space, using the camera width and height. Normalized x and y are not square, and an angle computed on them drifts toward the wider axis.
3. Keep a short trail, about 220 ms, of that angle and of the tip position. Measure how far the tip traveled around the wrist, not how far the palm moved.
4. Fire once when the arc is long enough (about 25 degrees, and at least about half a palm of tip travel) and one screen axis dominates the other by about 1.4 to 1. Apply `mapping.mirror` to horizontal motion so the label matches the mirrored preview.
5. Name the gesture from the tip's sweep: up, down, left, or right. Up is a decreasing camera y. That one event is one item.
6. After a fire, the same direction waits 0.5 seconds, so the next swipe still moves one item. The opposite direction waits 1.1 seconds. That is the hand traveling back to where it started, and it must not undo the swipe.

Grab and release stay on the fist. A grab requires every digit under the curl threshold, not an average. A wrist swipe only runs while the index is extended and the fist is not closed.

## Priority

The classifier and the one-item mapping come before any new widget.

- The debug panel shows the live angle, the arc, the named swipe, and whether it came from the wrist.
- Synthetic cases keep the palm fixed and move only the index tip: up, down, left, and right.
- A fist with the index still out does not grab. A hand aimed at the camera shows "Rotate your wrist" and does not grab or swipe.
- Up and down each move one grocery box or one device row, then wait 0.5 seconds.

## Edge cases

- **Palm still, finger moving.** The trail is the index tip about the wrist. A turn that leaves the palm inside the old 0.12 threshold must still count as one swipe.
- **Whole hand sliding.** If the wrist and the tip move together and the angle barely changes, that is not a wrist swipe. Require a minimum angle change so a translation does not advance the list.
- **One swipe, one item.** The same direction can fire again after 0.5 seconds, and it moves one more item. It does not skip.
- **Hand travels back.** After a swipe left, the hand has to move right to reset. That opposite stroke is ignored for 1.1 seconds. The same rule covers up after down, and down after up, so a scroll is not immediately undone.
- **No three-finger gesture.** Bringing the thumb, index, and middle together does not swipe, scroll, or select. The index fingertip is the only swipe, and a full fist is the only selection.
- **Diagonal.** If neither axis leads by the dominance ratio, emit nothing. A later, clearer turn can still fire after the trail rolls forward.
- **Jitter.** Landmark noise on the tip looks like a small arc. The distance and angle floors, plus the 0.5 second buffer, drop that.
- **Finger curling mid-turn.** If the index curl falls below the pointing gate, drop the trail. Closing the fist during a turn is a grab, not a scroll.
- **Thumb on the index tip.** That used to be a pinch click. It is neither a click nor a swipe. Selection waits for a full fist.
- **Partial fist.** One straight finger means the hand is not closed. Do not highlight or confirm.
- **Lost frames.** A gap longer than the trail window clears the arc. A hand that leaves and returns must not complete a swipe from the old tip position.
- **Too small or too close.** Reject a hand whose palm size is under `hands.minArea`. Scale the tip-travel threshold by palm size so a hand close to the lens does not turn a twitch into a swipe.
- **Left and right hands.** Use the wrist-to-tip vector in the image. Do not assume which side the thumb is on. Mirroring flips left and right only.
- **Two hands.** Keep using the primary hand from `hands.ts`. A second hand does not contribute a second swipe.
- **Wrist at the edge.** If the tip leaves the frame, the landmark jumps. Treat a single-frame tip jump larger than the palm as a dropout and clear the trail.
- **Held pose.** Pointing still, then a slow drift, must not fire. The arc has to happen inside the 220 ms window.
- **Ends of a list.** The first and last box, row, or icon do not wrap. A swipe past the end is still a recorded swipe, so the buffer still applies.
- **Aimed at the camera.** All fingertips closer to the lens than their knuckles. Cancel the swipe, do not grab, and show "Rotate your wrist".

## Where it goes

- `gesture_pipeline/src/gestures/pose.ts` — wrist-arc swipe, all-finger grab, 0.5 second cooldown.
- `gesture_pipeline/src/gestures/loop.ts` — swipe up and down emit one scroll step. Grab highlights. Release confirms. A pinch does not emit select.
- `client/src/ui/swipeGate.js` — the screen also drops a second swipe inside 0.5 seconds.
- `gesture_pipeline/src/gestures/ui/GestureDebug.tsx` — angle, arc, last swipe, and the wrist reminder.
- `gesture_pipeline/src/gestures/__tests__/pose.test.ts` — fixed palm with a moving index tip, a partial fist, and a hand pointed at the camera.

## Done when

A pointed index finger, with the wrist turning and the palm nearly fixed, moves exactly one item in the direction the fingertip traveled, then ignores the next half second. Closing every finger highlights a control. Opening the hand confirms it. A pinch, a partial fist, a diagonal, and a tracking dropout do none of those.
