import { useState } from 'react';

const KEY = 'conjure.gesture.hintsSeen.pinch-swipe-v1';
const HINTS = [
  { title: 'Point', text: 'Point with your index finger. That is the cursor.' },
  { title: 'Grab', text: 'Close the whole fist, thumb included, to highlight a control. Open the hand to confirm it.' },
  { title: 'Pinch, then swipe', text: 'Touch thumb and index together, then move left, right, up, or down. A swipe without a pinch is ignored.' },
  { title: 'Swipe left', text: 'While pinched, move left to open the shopping list from your prompt.' },
  { title: 'Swipe right', text: 'While pinched, move right to step back. The hand returning after a left swipe is ignored.' },
  { title: 'Scroll', text: 'While pinched, swipe up or down to move one item. Wait half a second before the next swipe.' },
];


/** Optional first-run gesture instructions for the host app. */
export function Hints({ onDone }: { onDone?: () => void }) {
  const [seen, setSeen] = useState(() => {
    try {
      return localStorage.getItem(KEY) === '1';
    } catch {
      return false;
    }
  });
  if (seen) return null;
  const close = () => {
    try {
      localStorage.setItem(KEY, '1');
    } catch {
      /* ignore */
    }
    setSeen(true);
    onDone?.();
  };
  return (
    <div className="g-hints" role="dialog" aria-label="How to use gestures">
      <ul>
        {HINTS.map(h => (
          <li key={h.title}>
            <strong>{h.title}</strong>
            <span>{h.text}</span>
          </li>
        ))}
      </ul>
      <button onClick={close} data-gesture-ignore>Got it</button>
    </div>
  );
}
