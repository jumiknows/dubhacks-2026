import { useState } from 'react';

const KEY = 'conjure.gesture.hintsSeen.shop-board-v2';
const HINTS = [
  { title: 'Point', text: 'Point with your index finger. That is the cursor. The mouse works everywhere too.' },
  { title: 'Split a group', text: 'Grab one group with both fists and pull apart, or click it. Its pieces line up left to right.' },
  { title: 'Inspect a piece', text: 'Grab a piece with one fist and hold, or click it. Its store listings fill the screen.' },
  { title: 'Compare', text: 'Pinch two listings, one in each hand, and bring them together. Or press Compare on two of them.' },
  { title: 'Add to cart', text: 'Hold a listing for 1 second with a fist or the mouse, or drag it onto the cart. It turns yellow.' },
  { title: 'Ask the assistant', text: 'Type or talk in the shopping panel: “compare the suitcases”, “use the winner”, “check out”.' },
  { title: 'Status', text: 'Items are labeled owned, purchased, in cart, or to buy. Checkout always uses the saved offer you chose.' },
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
