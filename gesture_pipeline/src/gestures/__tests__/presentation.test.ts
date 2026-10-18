import { describe, expect, it } from 'vitest';
import { CursorPresentation } from '../presentation';

describe('display refresh follows measured index positions', () => {
  it('fills the gap between 30fps detections without predicting past the fingertip', () => {
    const display = new CursorPresentation();
    display.update({ x: 0, y: 100 }, 0, 18);
    let previous = 0, changes = 0;
    for (let frame = 1; frame <= 60; frame++) {
      const t = frame * 1000 / 60;
      const target = Math.floor(frame / 2) * 10;
      if (frame % 2 === 0) display.update({ x: target, y: 100 }, t, 18);
      const point = display.sample(t, 18)!;
      expect(point.x).toBeGreaterThanOrEqual(previous);
      expect(point.x).toBeLessThanOrEqual(target);
      expect(target - point.x).toBeLessThan(16);
      if (point.x > previous) changes++;
      previous = point.x;
    }
    expect(changes).toBeGreaterThan(50);
  });
  it('stays still at rest, converges without overshooting, and resets on a hand change', () => {
    const display = new CursorPresentation();
    display.update({ x: 100, y: 100 }, 0, 18);
    display.update({ x: 300, y: 200 }, 33, 18);
    expect(display.sample(49, 18)!.x).toBeGreaterThan(100);
    const settled = display.sample(1000, 18)!;
    expect(settled.x).toBeCloseTo(300);
    expect(display.sample(1100, 18)).toEqual(settled);
    display.reset(); expect(display.sample(1200, 18)).toBeNull();
    display.update({ x: 40, y: 50 }, 1300, 18);
    expect(display.sample(1300, 18)).toEqual({ x: 40, y: 50 });
  });
});
