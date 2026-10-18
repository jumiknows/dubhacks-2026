import type { Config } from './config';
import { HAND_IDS } from './tracks';
import type { BimanualKind, GestureEvent, GestureType, HandId, ObjectTarget, Vec2 } from './types';

export type PairHand = { point: Vec2; ratio: number; eligible: boolean; identified: boolean; target: ObjectTarget | null };
export type PairInput = Record<HandId, PairHand | null>;
export type PairEvent = Partial<GestureEvent> & { type: GestureType };
type Grip = { open: boolean; down: boolean; since: number; release: number | null; lastSeen: number; target: ObjectTarget | null };
type Pair = { kind: BimanualKind; id: string; targets: [ObjectTarget, ObjectTarget]; origins: [Vec2, Vec2]; since: number; committed: boolean; first: number };
const grip = (): Grip => ({ open: false, down: false, since: 0, release: null, lastSeen: -Infinity, target: null });
let serial = 0;

/** Two captured pinches, one transaction. No DOM, camera, timers or UI state. */
export class BimanualCoordinator {
  private grips = { left: grip(), right: grip() };
  private pair: Pair | null = null;
  reset(): PairEvent[] {
    const events = this.pair ? [this.event(this.pair.committed ? 'bimanual_end' : 'bimanual_cancel')] : [];
    this.pair = null;
    this.grips = { left: grip(), right: grip() };
    return events;
  }
  isPinched(id: HandId) { return this.grips[id].down; }
  private event(type: GestureType, progress = 0): PairEvent {
    const p = this.pair!;
    return { type, gesture: p.kind, hand_ids: [...HAND_IDS], interaction_id: p.id,
      target_ids: p.targets.map(t => t.id), target_id: p.targets[0].groupId,
      group_id: p.kind !== 'compare' ? p.targets[0].groupId : undefined, progress };
  }
  update(t: number, input: PairInput, c: Config) {
    const events: PairEvent[] = [];
    for (const id of HAND_IDS) {
      const s = this.grips[id], h = input[id]?.identified ? input[id] : null;
      if (!h) {
        if (t - s.lastSeen > c.hands.handLostMs) { s.down = false; s.target = null; s.open = false; }
        continue;
      }
      const reappeared = t - s.lastSeen > c.hands.handLostMs;
      s.lastSeen = t;
      if (reappeared) { s.down = false; s.target = null; s.open = false; }
      const released = h.ratio >= c.pinch.off || !h.eligible;
      if (released) {
        s.release ??= t;
        if (t - s.release >= c.pinch.releaseMs) {
          s.down = false; s.target = null;
          // A fist/three-finger pose cannot re-arm a closed index pinch.
          s.open = h.ratio >= c.pinch.off;
        }
      } else {
        s.release = null;
        if (!s.down && s.open && h.ratio <= c.pinch.on) {
          s.down = true; s.open = false; s.since = t;
          s.target = h.identified ? h.target : null;
        }
      }
    }
    const a = this.grips.left, b = this.grips.right;
    if (this.pair && (!a.down || !b.down)) {
      events.push(this.event(this.pair.committed ? 'bimanual_end' : 'bimanual_cancel'));
      this.pair = null;
      // The still-closed hand must open before another object can be captured.
      for (const id of HAND_IDS) { this.grips[id].target = null; }
    }
    if (!this.pair && a.down && b.down && a.target && b.target && input.left && input.right) {
      const origins: [Vec2, Vec2] = [{ ...input.left.point }, { ...input.right.point }];
      const dx = Math.abs(origins[1].x - origins[0].x), dy = Math.abs(origins[1].y - origins[0].y);
      const horizontal = dx >= c.bimanual.minStartGap && dx >= dy * c.bimanual.dominance;
      let kind: BimanualKind | null = null;
      if (a.target.kind === 'original' && b.target.kind === 'original' && horizontal) {
        if (a.target.id === b.target.id && origins[0].x < origins[1].x) kind = 'expand';
        else if (a.target.id !== b.target.id) kind = 'compare';
      } else if (a.target.groupId === b.target.groupId && a.target.kind !== 'original' && b.target.kind !== 'original' && horizontal) kind = 'collapse';
      if (kind) {
        this.pair = { kind, id: `pair-${++serial}`, targets: [a.target, b.target], origins, since: t, committed: false,
          first: Number(origins[0].x > origins[1].x) };
        events.push(this.event('bimanual_start'));
      }
    }
    const p = this.pair;
    const active = input.left && input.right && input.left.identified && input.right.identified
      && input.left.eligible && input.right.eligible && a.release === null && b.release === null;
    if (p && active && !p.committed) {
      const points = [input.left!.point, input.right!.point];
      const axis = 'x';
      const cross = 'y';
      const i = p.first, j = 1 - i;
      const sign = p.kind === 'expand' ? -1 : 1;
      const d1 = (points[i][axis] - p.origins[i][axis]) * sign;
      const d2 = (p.origins[j][axis] - points[j][axis]) * sign;
      const straight = d1 >= Math.abs(points[i][cross] - p.origins[i][cross]) * c.bimanual.dominance
        && d2 >= Math.abs(points[j][cross] - p.origins[j][cross]) * c.bimanual.dominance;
      const near = p.kind === 'expand' || Math.abs(points[i][axis] - points[j][axis]) <= c.bimanual.closeGap;
      const progress = Math.max(0, Math.min(1, Math.min(d1, d2) / c.bimanual.minTravel));
      events.push(this.event('bimanual_progress', progress));
      if (straight && near && progress >= 1 && t - p.since >= c.bimanual.armMs
        && t - a.since >= c.pinch.confirmMs && t - b.since >= c.pinch.confirmMs) {
        p.committed = true;
        events.push(this.event(p.kind, 1));
      }
    }
    // Reserve annotated object grips even before the second hand joins.
    const reserved = new Set(HAND_IDS.filter(id => this.grips[id].down && (!!this.grips[id].target || !!this.pair)));
    return { events, reserved };
  }
}
