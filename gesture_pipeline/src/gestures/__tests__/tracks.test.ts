import { describe, expect, it } from 'vitest';
import { HandTracks } from '../tracks';
import { defaults } from '../config';
import { hand } from './synthetic';
import type { HandFrame } from '../types';
const h = (handedness: string | undefined, x = .5): HandFrame => ({
  handedness, landmarks: hand('open', x).map(([x, y, z]) => ({ x, y, z })),
});
describe('parallel hand identities', () => {
  const frame = (t: number, hands: HandFrame[]) => ({ t, hands, videoW: 640, videoH: 480 });
  it('ignores result order, retaining both anatomical identities through crossing', () => {
    const tracks = new HandTracks();
    tracks.update(frame(0, [h('Left', .4), h('Right', .6)]), defaults.hands);
    const out = tracks.update(frame(33, [h('Right', .45), h('Left', .55)]), defaults.hands);
    expect(out.left.hand?.landmarks[0].x).toBe(.55); expect(out.right.hand?.landmarks[0].x).toBe(.45);
  });
  it('continues one hand when the other disappears', () => {
    const tracks = new HandTracks(); tracks.update(frame(0, [h('Left'), h('Right')]), defaults.hands);
    const out = tracks.update(frame(33, [h('Right', .6)]), defaults.hands);
    expect(out.left.hand).toBeNull(); expect(out.right.hand).not.toBeNull();
  });
  it('pauses duplicate labels instead of merging hands', () => {
    const out = new HandTracks().update(frame(0, [h('Left', .4), h('Left', .6)]), defaults.hands);
    expect(out.left.hand).toBeNull(); expect(out.right.hand).toBeNull();
  });
  it('rejects invalid and tiny hands independently', () => {
    const bad = h('Left'); bad.landmarks[8].x = NaN;
    expect(new HandTracks().update(frame(0, [bad, h('Right')]), defaults.hands).right.hand).not.toBeNull();
  });
  it('supports explicit label calibration without changing screen mapping', () => {
    const out = new HandTracks().update(frame(0, [h('Left')]), { ...defaults.hands, swapHandedness: true });
    expect(out.right.identified).toBe(true); expect(out.left.hand).toBeNull();
  });
  it('keeps low-confidence hands visible but forbids pairing uncertain identities', () => {
    const out = new HandTracks().update(frame(0, [{ ...h('Left'), handednessScore: .55 }, { ...h('Right'), handednessScore: .99 }]), defaults.hands);
    expect(out.left.hand).not.toBeNull(); expect(out.left.identified).toBe(false); expect(out.right.identified).toBe(true);
  });
  it('keeps unlabelled single-hand fixtures usable but excludes them from pairs', () => {
    const out = new HandTracks().update(frame(0, [h(undefined)]), defaults.hands);
    expect(out.right.hand).not.toBeNull(); expect(out.right.identified).toBe(false);
  });
});
