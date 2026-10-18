// Pure feature extraction from one hand's 21 landmarks. No DOM, no clock.
// Landmarks: 0 wrist; 4 thumb tip; 5,9,13,17 knuckles; 6,10,14,18 middle joints; 8,12,16,20 fingertips.

import type { Features, HandFrame, Pt, Vec2 } from './types';

const toPx = (p: Pt, W: number, H: number): Vec2 => ({ x: p.x * W, y: p.y * H });
const dist = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.y - b.y);

export function extract(hand: HandFrame, W: number, H: number): Features {
  const lm = hand.landmarks;
  // Aspect correction: compare distances in pixels, not normalized units.
  const L = lm.map(p => toPx(p, W, H));
  const palmSize = Math.max(1, dist(L[0], L[9]));
  const pinchRatio = dist(L[4], L[8]) / palmSize;
  const threeFingerPinchRatio = Math.max(dist(L[4], L[8]), dist(L[4], L[12])) / palmSize;
  const middleExtension = dist(L[12], L[0]) / Math.max(1, dist(L[10], L[0]));
  const palmIds = [0, 5, 9, 13, 17];
  const palmCenter = {
    x: palmIds.reduce((s, i) => s + lm[i].x, 0) / palmIds.length,
    y: palmIds.reduce((s, i) => s + lm[i].y, 0) / palmIds.length,
  };
  let minX = 1, maxX = 0, minY = 1, maxY = 0;
  for (const p of lm) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  return {
    palmSize,
    pinchRatio,
    threeFingerPinchRatio,
    middleExtension,
    palmCenter,
    indexTip: { x: lm[8].x, y: lm[8].y },
    thumbTip: { x: lm[4].x, y: lm[4].y },
    bboxArea: Math.max(0, maxX - minX) * Math.max(0, maxY - minY),
  };
}

/**
 * The index fingertip always drives the pointer. PointerMapper preserves the press
 * position when the finger closes, so closing does not pull a click away from its target.
 */
export function pointerFor(f: Features): Vec2 {
  return f.indexTip;
}
