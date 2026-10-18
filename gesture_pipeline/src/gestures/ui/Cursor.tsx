import { useEffect, useRef } from 'react';
import { gestures } from '../loop';

/** Hand cursor with a hold ring and a gesture chip. Moved by direct DOM writes from loop.ts, never by React state. */
export function Cursor() {
  const el = useRef<HTMLDivElement>(null);
  const chip = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    gestures.setCursorElement(el.current, chip.current);
    return () => gestures.setCursorElement(null, null);
  }, []);
  return (
    <div ref={el} className="g-cursor" aria-hidden="true">
      <svg className="g-ring" viewBox="0 0 40 40">
        <circle className="g-ring-base" cx="20" cy="20" r="16" />
        <circle className="g-ring-hold" cx="20" cy="20" r="16" pathLength="100" />
      </svg>
      <span className="g-dot" />
      <span ref={chip} className="g-chip" />
    </div>
  );
}
