import type { Config } from './config';
import type { FrameInput, HandFrame, HandId, Vec2 } from './types';

export const HAND_IDS: HandId[] = ['left', 'right'];
export type HandSlot = { hand: HandFrame | null; identified: boolean };
type Previous = { center: Vec2; t: number; identified: boolean };

/** Labels identify anatomical hands; array order and screen position never assign identity. */
export class HandTracks {
  private previous: Partial<Record<HandId, Previous>> = {};
  reset() { this.previous = {}; }
  update(frame: FrameInput, c: Config['hands']): Record<HandId, HandSlot> {
    const out: Record<HandId, HandSlot> = { left: { hand: null, identified: false }, right: { hand: null, identified: false } };
    const valid = frame.hands.filter(h => h.landmarks.length === 21
      && h.landmarks.every(p => [p.x, p.y, p.z].every(Number.isFinite))
      && (Math.max(...h.landmarks.map(p => p.x)) - Math.min(...h.landmarks.map(p => p.x)))
        * (Math.max(...h.landmarks.map(p => p.y)) - Math.min(...h.landmarks.map(p => p.y))) >= c.minArea);
    const label = (h: HandFrame): HandId | null => {
      const name = h.handedness?.toLowerCase();
      if (name !== 'left' && name !== 'right') return null;
      return c.swapHandedness ? (name === 'left' ? 'right' : 'left') : name;
    };
    for (const id of HAND_IDS) {
      const matches = valid.filter(h => label(h) === id);
      // Duplicate labels are ambiguous: pause instead of silently exchanging two captured objects.
      const fallback = valid.length === 1 && !label(valid[0]) && id === 'right'
        && !HAND_IDS.some(key => this.previous[key]?.identified && frame.t - this.previous[key]!.t < c.handLostMs);
      const hand = matches.length === 1 ? matches[0] : fallback ? valid[0] : null;
      if (!hand) continue;
      const center = hand.landmarks[9];
      const prev = this.previous[id];
      if (prev && frame.t - prev.t < c.handLostMs
        && Math.hypot(center.x - prev.center.x, center.y - prev.center.y) > c.sameHandDist) continue;
      out[id] = { hand, identified: label(hand) !== null
        && (hand.handednessScore === undefined || (Number.isFinite(hand.handednessScore) && hand.handednessScore >= c.minHandednessConfidence)) };
      this.previous[id] = { center, t: frame.t, identified: out[id].identified };
    }
    return out;
  }
}
