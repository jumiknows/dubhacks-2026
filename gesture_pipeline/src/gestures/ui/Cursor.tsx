import { useEffect, useRef } from 'react';
import { gestures } from '../loop';
import type { HandId } from '../types';

/** Hand cursor with a hold ring and a gesture chip. Moved by direct DOM writes from loop.ts, never by React state. */
export function Cursor() {
  return <><HandCursor hand="left" /><HandCursor hand="right" /></>;
}
function HandCursor({ hand }: { hand: HandId }) {
  const el = useRef<HTMLDivElement>(null);
  const chip = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    gestures.setCursorElement(el.current, chip.current, hand);
    return () => gestures.setCursorElement(null, null, hand);
  }, [hand]);
  return (
    <div ref={el} className="g-cursor" data-hand={hand} aria-hidden="true">
      <span className="g-hand-label">{hand === 'left' ? 'L' : 'R'}</span>
      <svg className="g-ring" viewBox="0 0 40 40">
        <circle className="g-ring-base" cx="20" cy="20" r="16" />
        <circle className="g-ring-hold" cx="20" cy="20" r="16" pathLength="100" />
      </svg>
      <span className="g-dot" />
      <span ref={chip} className="g-chip" />
    </div>
  );
}
