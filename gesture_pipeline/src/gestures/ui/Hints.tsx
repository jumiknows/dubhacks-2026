import { useState } from 'react';

const KEY = 'conjure.gesture.hintsSeen.swipes-v3';
const HINTS = [
  { title: 'Point', text: 'Point at a card to highlight it.' },
  { title: 'Swipe left', text: 'Bring thumb, index and middle together, then sweep right to left for the next product. Release before the next swipe.' },
  { title: 'Swipe right', text: 'Start on a card, bring those three fingers together and sweep left to right to dismiss it.' },
  { title: 'Scroll', text: 'Point inside a catalogue, bring those three fingers together and move up to see lower items, or down to go back. Hold to continue scrolling; release to reset.' },
  { title: 'Pinch to select', text: 'Touch thumb and index together, then release to open the card.' },
  { title: 'Pinch to drag', text: 'Keep thumb and index together and move your hand. Release to place the card.' },
  { title: 'Keyboard', text: 'Left arrow brings a card in. Right arrow dismisses the focused card. Esc closes details.' },
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
