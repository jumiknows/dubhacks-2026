import { useState } from 'react';

const KEY = 'conjure.gesture.hintsSeen.shop-board-v1';
const HINTS = [
  { title: 'Point', text: 'Point with your index finger. That is the cursor.' },
  { title: 'Scroll the list', text: 'One finger: pan up or down through every query you have sent. Pinch and swipe up or down does the same.' },
  { title: 'Split a group', text: 'Grab the same item group with both hands and pull them apart. Its pieces line up so you can pan them left and right.' },
  { title: 'Inspect a piece', text: 'Grab one piece with one fist and hold. It lifts to the middle with products you can buy.' },
  { title: 'Add to cart', text: 'Grab a product and hold for two seconds. It turns yellow (in the cart). Swipe up, or bring both fists together, to cancel.' },
  { title: 'Recombine', text: 'Swipe up or down to close the split and keep moving through the list. Bring both fists together to close the split without moving.' },
  { title: 'Status', text: 'Each item is labeled owned, purchased, in cart, or to buy. The cart always uses the offer you chose.' },
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
