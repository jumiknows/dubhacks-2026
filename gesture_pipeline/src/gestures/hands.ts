// Pure primary-hand selection: ignore small background hands, stick with the hand we were tracking.

import type { Config } from './config';
import type { FrameInput, HandFrame, Vec2 } from './types';

export type PrimaryState = { center: Vec2 | null; lastT: number | null; handedness?: string };

export const initialPrimary = (): PrimaryState => ({ center: null, lastT: null });

const center = (h: HandFrame): Vec2 => {
  const ids = [0, 5, 9, 13, 17];
  return {
    x: ids.reduce((s, i) => s + h.landmarks[i].x, 0) / ids.length,
    y: ids.reduce((s, i) => s + h.landmarks[i].y, 0) / ids.length,
  };
};

const area = (h: HandFrame) => {
  const xs = h.landmarks.map(p => p.x);
  const ys = h.landmarks.map(p => p.y);
  return (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys));
};

export function selectPrimary(
  frame: FrameInput,
  prev: PrimaryState,
  c: Config['hands'],
): { hand: HandFrame | null; state: PrimaryState; switched: boolean; reason: 'no_hand' | 'too_small' | 'switching' | null } {
  const candidates = frame.hands.filter(h => h.landmarks.length === 21
    && h.landmarks.every(p => Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z)) && area(h) >= c.minArea);
  if (candidates.length === 0) return { hand: null, state: prev, switched: false, reason: frame.hands.length ? 'too_small' : 'no_hand' };

  if (prev.center) {
    let best: HandFrame | null = null;
    let bestD = Infinity;
    for (const h of candidates) {
      if (prev.handedness && h.handedness && prev.handedness !== h.handedness) continue;
      const p = center(h);
      const d = Math.hypot(p.x - prev.center.x, p.y - prev.center.y);
      if (d < bestD) {
        bestD = d;
        best = h;
      }
    }
    if (best && bestD <= c.sameHandDist) {
      return { hand: best, state: { center: center(best), lastT: frame.t, handedness: best.handedness ?? prev.handedness }, switched: false, reason: null };
    }
    // The tracked hand is missing. Do not jump to another hand until it has been gone long enough.
    if (prev.lastT !== null && frame.t - prev.lastT < c.switchAfterMs) {
      return { hand: null, state: prev, switched: false, reason: 'switching' };
    }
  }

  const largest = candidates.reduce((a, b) => (area(b) > area(a) ? b : a));
  return { hand: largest, state: { center: center(largest), lastT: frame.t, handedness: largest.handedness }, switched: true, reason: null };
}
