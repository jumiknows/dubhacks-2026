import { describe, expect, it } from 'vitest';
import { extract, pointerFor } from '../features';
import { hand } from './synthetic';

const toFrame = (pts: number[][]) => ({
  landmarks: pts.map(([x, y, z]) => ({ x, y, z })),
});

describe('features', () => {
  it('an open hand has a large pinch ratio', () => {
    const f = extract(toFrame(hand('open')), 640, 480);
    expect(f.pinchRatio).toBeGreaterThan(0.5);
  });

  it('a closed hand is not automatically a click pinch', () => {
    const f = extract(toFrame(hand('fist')), 640, 480);
    expect(f.pinchRatio).toBeGreaterThan(0.25);
  });

  it('pinch has a small pinch ratio', () => {
    const f = extract(toFrame(hand('pinch')), 640, 480);
    expect(f.pinchRatio).toBeLessThan(0.15);
    expect(f.threeFingerPinchRatio).toBeGreaterThan(0.3);
    expect(f.middleExtension).toBeGreaterThan(1.25);
  });

  it('distinguishes three fingertips together from the ordinary click pinch at different scales', () => {
    for (const scale of [0.05, 0.12, 0.2]) {
      const f = extract(toFrame(hand('swipe', 0.5, 0.5, scale)), 640, 480);
      expect(f.pinchRatio).toBeLessThan(0.25);
      expect(f.threeFingerPinchRatio).toBeLessThan(0.3);
      expect(f.middleExtension).toBeLessThan(1.25);
    }
  });

  it('an unpinched hand uses its index fingertip as the pointer', () => {
    const f = extract(toFrame(hand('point')), 640, 480);
    expect(pointerFor(f)).toEqual(f.indexTip);
  });

  it('pinch ratio is scale invariant (near and far hands)', () => {
    const near = extract(toFrame(hand('open', 0.5, 0.5, 0.15)), 640, 480);
    const far = extract(toFrame(hand('open', 0.5, 0.5, 0.06)), 640, 480);
    expect(Math.abs(near.pinchRatio - far.pinchRatio)).toBeLessThan(0.02);
  });

  it('pointer stays on the index fingertip while pinched', () => {
    const f = extract(toFrame(hand('pinch')), 640, 480);
    expect(pointerFor(f)).toEqual(f.indexTip);
  });
});
