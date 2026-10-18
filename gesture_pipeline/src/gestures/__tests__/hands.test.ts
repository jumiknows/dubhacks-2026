import { describe, expect, it } from 'vitest';
import { defaults } from '../config';
import { initialPrimary, selectPrimary } from '../hands';
import { toFrameInput } from '../replay';
import { fixtureHand, hand } from './synthetic';

describe('primary hand filtering', () => {
  it('does not hand an active interaction to the opposite hand merely because it is nearby', () => {
    const first = toFrameInput({ t: 0, hands: [fixtureHand('point', 0.5, 0.5)] }, 640, 480);
    first.hands[0].handedness = 'Right';
    const tracked = selectPrimary(first, initialPrimary(), defaults.hands);
    const other = toFrameInput({ t: 33, hands: [fixtureHand('point', 0.55, 0.5)] }, 640, 480);
    other.hands[0].handedness = 'Left';
    expect(selectPrimary(other, tracked.state, defaults.hands).reason).toBe('switching');
    other.t = 400;
    expect(selectPrimary(other, tracked.state, defaults.hands).switched).toBe(true);
  });
  it('rejects non-finite landmarks before they can move the cursor', () => {
    const frame = toFrameInput({ t: 0, hands: [fixtureHand('point', 0.5, 0.5)] }, 640, 480);
    frame.hands[0].landmarks[8].x = Infinity;
    expect(selectPrimary(frame, initialPrimary(), defaults.hands).hand).toBeNull();
  });
  it('keeps a smaller but valid hand that the old area threshold rejected', () => {
    const frame = toFrameInput({ t: 0, hands: [{ landmarks: hand('point', 0.5, 0.5, 0.05) }] }, 640, 480);
    const result = selectPrimary(frame, initialPrimary(), defaults.hands);
    expect(result.hand).toBe(frame.hands[0]);
    expect(selectPrimary(frame, initialPrimary(), { ...defaults.hands, minArea: 0.015 }).reason).toBe('too_small');
  });

  it('keeps the same hand through a fast swipe rather than dropping it for 300 ms', () => {
    const first = toFrameInput({ t: 0, hands: [fixtureHand('open', 0.35, 0.5)] }, 640, 480);
    const tracked = selectPrimary(first, initialPrimary(), defaults.hands);
    const next = toFrameInput({ t: 33, hands: [fixtureHand('open', 0.55, 0.5)] }, 640, 480);
    const result = selectPrimary(next, tracked.state, defaults.hands);
    expect(result.hand).toBe(next.hands[0]);
    expect(result.switched).toBe(false);
  });

  it('distinguishes no model detection from an unrelated hand waiting to take over', () => {
    const missing = toFrameInput({ t: 33, hands: [] }, 640, 480);
    expect(selectPrimary(missing, initialPrimary(), defaults.hands).reason).toBe('no_hand');
    const other = toFrameInput({ t: 33, hands: [fixtureHand('open', 0.8, 0.5)] }, 640, 480);
    expect(selectPrimary(other, { center: { x: 0.2, y: 0.5 }, lastT: 0 }, defaults.hands).reason).toBe('switching');
  });
});
