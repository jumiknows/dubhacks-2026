import { describe, expect, it } from 'vitest';
import { defaults } from '../config';
import { PointerMapper } from '../mapping';
import { feat } from './synthetic';

describe('shared live/replay cursor mapping', () => {
  it('moving only the thumb does not move a pinched index pointer', () => {
    const mapper = new PointerMapper();
    const hand = feat({ pinchRatio: 0.1 });
    const first = mapper.update(hand, 0, 1280, 800, defaults);
    const movedThumb = mapper.update({ ...hand, thumbTip: { x: 0.1, y: 0.9 } }, 33, 1280, 800, defaults);
    expect(movedThumb).toEqual(first);
  });
  it('preserves the press location as the index fingertip closes toward the thumb', () => {
    const mapper = new PointerMapper();
    const point = feat({ indexTip: { x: 0.5, y: 0.4 }, thumbTip: { x: 0.4, y: 0.4 } });
    const before = mapper.update(point, 0, 1280, 800, defaults);
    const closed = mapper.update({ ...point, pinchRatio: 0.1, indexTip: { x: 0.46, y: 0.4 } }, 33, 1280, 800, defaults);
    expect(closed.x).toBeCloseTo(before.x);
    expect(closed.y).toBeCloseTo(before.y);
  });
  it('moves with the hand while pinched and freezes a release while debouncing', () => {
    const mapper = new PointerMapper();
    const point = feat();
    mapper.update(point, 0, 1280, 800, defaults);
    const closed = mapper.update({ ...point, pinchRatio: 0.1 }, 33, 1280, 800, defaults);
    const moving = mapper.update({ ...point, pinchRatio: 0.1, indexTip: { x: 0.6, y: 0.4 }, thumbTip: { x: 0.5, y: 0.5 } }, 66, 1280, 800, defaults);
    expect(moving.x).toBeLessThan(closed.x);
    expect(mapper.update(point, 99, 1280, 800, defaults, true)).toEqual(moving);
    mapper.reset();
    expect(mapper.update(point, 1000, 1280, 800, defaults)).toEqual(closed);
  });
});
