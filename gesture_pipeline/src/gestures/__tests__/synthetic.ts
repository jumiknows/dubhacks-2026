// Synthetic hands for tests. Coordinates are normalized to a 640x480 frame.

import type { Features } from '../types';
import type { FixtureHand } from '../replay';

type P = [number, number, number];

/**
 * Builds 21 landmarks for a hand centred at (cx, cy).
 * pose: 'open' all fingers extended; 'fist' all curled; 'pinch' open but thumb tip on index tip; 'point' index only.
 */
export function hand(pose: 'open' | 'fist' | 'pinch' | 'swipe' | 'point', cx = 0.5, cy = 0.5, s = 0.12): P[] {
  const pts: P[] = new Array(21).fill(0).map(() => [cx, cy, 0] as P);
  const at = (dx: number, dy: number): P => [cx + dx * s, cy + dy * s, 0];
  pts[0] = at(0, 1); // wrist below
  // knuckles (MCP) and middle joints (PIP), tips
  const fingers = [
    { mcp: 5, pip: 6, dip: 7, tip: 8, x: -0.45 },
    { mcp: 9, pip: 10, dip: 11, tip: 12, x: -0.15 },
    { mcp: 13, pip: 14, dip: 15, tip: 16, x: 0.15 },
    { mcp: 17, pip: 18, dip: 19, tip: 20, x: 0.45 },
  ];
  fingers.forEach((fg, i) => {
    const extended = pose === 'open' || pose === 'pinch' || (pose === 'swipe' && i < 2) || (pose === 'point' && i === 0);
    pts[fg.mcp] = at(fg.x, 0);
    pts[fg.pip] = at(fg.x, -0.45);
    pts[fg.dip] = extended ? at(fg.x, -0.75) : at(fg.x, -0.2);
    pts[fg.tip] = extended ? at(fg.x, -1.0) : at(fg.x, 0.25); // curled tip sits near the palm
  });
  // thumb
  pts[1] = at(-0.6, 0.7);
  pts[2] = at(-0.85, 0.4);
  pts[3] = at(-1.0, 0.1);
  pts[4] = pose === 'pinch' || pose === 'swipe' ? [pts[8][0] + 0.005, pts[8][1] + 0.005, 0] : at(-1.1, -0.2);
  if (pose === 'swipe') {
    pts[8] = at(-0.55, -0.25);
    pts[4] = at(-0.58, -0.22);
    pts[12] = at(-0.52, -0.24);
  }
  return pts;
}

export function fixtureHand(pose: Parameters<typeof hand>[0], cx: number, cy: number): FixtureHand {
  return { landmarks: hand(pose, cx, cy) };
}

/** Minimal Features for engine unit tests. */
export function feat(over: Partial<Features> = {}): Features {
  return {
    palmSize: 60,
    pinchRatio: 0.9,
    threeFingerPinchRatio: 0.9,
    middleExtension: 1.4,
    palmCenter: { x: 0.5, y: 0.5 },
    indexTip: { x: 0.5, y: 0.4 },
    thumbTip: { x: 0.4, y: 0.5 },
    bboxArea: 0.05,
    ...over,
  };
}
