// Open-hand swipes and a fist closing or opening. Pure: no camera, no DOM.

import type { Pt, Vec2 } from './types';

export type NamedGesture = 'swipe-up' | 'swipe-down' | 'swipe-left' | 'swipe-right' | 'grab' | 'release';
export type Fist = 'open' | 'closed' | 'unknown';

export type PoseView = {
  fist: Fist;
  curl: number;
  angle: number | null;
  arc: number;
  source: 'wrist' | 'palm' | null;
  hint: string | null;
  last: NamedGesture | null;
  history: { name: NamedGesture; t: number }[];
};

const DIGITS = [
  { mcp: 2, tip: 4 },
  { mcp: 5, tip: 8 },
  { mcp: 9, tip: 12 },
  { mcp: 13, tip: 16 },
  { mcp: 17, tip: 20 },
];

const dist = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.y - b.y);

function isPinch(lm: Pt[]): boolean {
  const palm = Math.max(1e-4, dist(lm[5], lm[0]));
  return dist(lm[4], lm[8]) / palm < 0.45;
}

/** Each digit's tip-to-wrist distance divided by its knuckle-to-wrist distance. Extended digits are larger. */
export function digitCurls(lm: Pt[]): number[] {
  const wrist = lm[0];
  return DIGITS.map((digit) => {
    const knuckle = Math.max(1e-4, dist(lm[digit.mcp], wrist));
    return dist(lm[digit.tip], wrist) / knuckle;
  });
}

/** Mean curl. A closed fist uses `allCurled` so one straight finger cannot grab. */
export function fingerCurl(lm: Pt[]): number {
  const curls = digitCurls(lm);
  return curls.reduce((sum, value) => sum + value, 0) / curls.length;
}

export function allCurled(lm: Pt[]): boolean {
  return digitCurls(lm).every((curl) => curl < 1.2);
}

/** Fingertips closer to the lens than their knuckles. The 2D pose then looks curled even when the hand is open. */
export function aimedAtCamera(lm: Pt[]): boolean {
  return DIGITS.every((digit) => lm[digit.tip].z < lm[digit.mcp].z - 0.03);
}

function palmOf(lm: Pt[]): Vec2 {
  const ids = [0, 5, 9, 13, 17];
  return {
    x: ids.reduce((sum, id) => sum + lm[id].x, 0) / ids.length,
    y: ids.reduce((sum, id) => sum + lm[id].y, 0) / ids.length,
  };
}

let view: PoseView = {
  fist: 'unknown', curl: 0, angle: null, arc: 0, source: null, hint: null, last: null, history: [],
};
const listeners = new Set<() => void>();

export function getPoseView(): PoseView {
  return view;
}

export function subscribePose(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function publish(next: PoseView) {
  view = next;
  listeners.forEach((listener) => listener());
}

type WristSample = { t: number; angle: number; tip: Vec2; wrist: Vec2; palm: number };
type FrameSize = { width: number; height: number };

const POINTING = 1.5;
const ARC_DEG = 25 * Math.PI / 180;
const WINDOW_MS = 220;

function unwrap(delta: number) {
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  return delta;
}

function px(p: Pt, width: number, height: number): Vec2 {
  return { x: p.x * width, y: p.y * height };
}

export class PoseDetector {
  private closed: boolean | null = null;
  private pending: 'closed' | 'open' | null = null;
  private pendingSince = 0;
  private trail: { t: number; x: number; y: number }[] = [];
  private wristTrail: WristSample[] = [];
  private coolUntil = 0;
  private lastDir: 'left' | 'right' | 'up' | 'down' | null = null;
  private lastAt = 0;

  reset() {
    this.closed = null;
    this.pending = null;
    this.pendingSince = 0;
    this.trail = [];
    this.wristTrail = [];
    this.coolUntil = 0;
    this.lastDir = null;
    this.lastAt = 0;
  }

  update(lm: Pt[], t: number, mirror: boolean, frame: FrameSize = { width: 640, height: 480 }): NamedGesture | null {
    const curl = fingerCurl(lm);
    const aimed = aimedAtCamera(lm);
    const curled = !aimed && allCurled(lm);
    const indexReach = dist(lm[8], lm[0]) / Math.max(1e-4, dist(lm[5], lm[0]));
    const pointing = indexReach > POINTING;
    const next = curled ? 'closed' : pointing || this.closed ? 'open' : null;
    let gesture: NamedGesture | null = null;
    let source: PoseView['source'] = null;
    let angle: number | null = null;
    let arc = 0;

    const current = this.closed === null ? null : this.closed ? 'closed' : 'open';
    if (!aimed && next && next !== current) {
      if (this.pending !== next) {
        this.pending = next;
        this.pendingSince = t;
      } else if (t - this.pendingSince >= 60) {
        if (this.closed !== null) {
          gesture = next === 'closed' ? 'grab' : 'release';
          this.trail = [];
          this.wristTrail = [];
          this.coolUntil = t + 500;
        }
        this.closed = next === 'closed';
        this.pending = null;
      }
    } else {
      this.pending = null;
    }

    if (aimed) {
      this.trail = [];
      this.wristTrail = [];
    } else if (!gesture && !this.closed && pointing && isPinch(lm)) {
      const read = this.wristSwipe(lm, t, mirror, frame);
      gesture = read.gesture;
      angle = read.angle;
      arc = read.arc;
      if (gesture) source = 'wrist';
    } else {
      this.wristTrail = [];
    }

    if (!gesture && !this.closed && !aimed && isPinch(lm)) {
      const palm = palmOf(lm);
      this.trail.push({ t, x: palm.x, y: palm.y });
      this.trail = this.trail.filter((sample) => sample.t >= t - WINDOW_MS);
      const palmSwipe = this.palmSwipe(t, mirror);
      if (palmSwipe) {
        gesture = palmSwipe;
        source = 'palm';
      }
    } else if (!isPinch(lm)) {
      this.trail = [];
    }

    const fist: Fist = this.closed === null ? 'unknown' : this.closed ? 'closed' : 'open';
    const hint = aimed ? 'Rotate your wrist' : null;
    if (gesture || fist !== view.fist || hint !== view.hint || Math.abs(curl - view.curl) > 0.05 || angle !== view.angle) {
      publish({
        fist,
        curl,
        angle,
        arc,
        source: gesture ? source : view.source,
        hint,
        last: gesture ?? view.last,
        history: gesture ? [{ name: gesture, t }, ...view.history].slice(0, 8) : view.history,
      });
    }
    return gesture;
  }

  private wristSwipe(lm: Pt[], t: number, mirror: boolean, frame: FrameSize) {
    const wrist = px(lm[0], frame.width, frame.height);
    const knuckle = px(lm[5], frame.width, frame.height);
    const tip = px(lm[8], frame.width, frame.height);
    const thumb = px(lm[4], frame.width, frame.height);
    const palm = Math.max(1, dist(knuckle, wrist));
    const angle = Math.atan2(tip.y - wrist.y, tip.x - wrist.x);
    const pinching = dist(thumb, tip) / palm < 0.45;
    if (!pinching) {
      this.wristTrail = [];
      return { gesture: null as NamedGesture | null, angle, arc: 0 };
    }
    const previous = this.wristTrail[this.wristTrail.length - 1];
    if (previous && (t - previous.t > WINDOW_MS || dist(tip, previous.tip) > palm * 2.5)) this.wristTrail = [];
    this.wristTrail.push({ t, angle, tip, wrist, palm });
    this.wristTrail = this.wristTrail.filter((sample) => sample.t >= t - WINDOW_MS);
    if (t < this.coolUntil || this.wristTrail.length < 3) return { gesture: null, angle, arc: 0 };
    const from = this.wristTrail[0];
    const turned = Math.abs(unwrap(angle - from.angle));
    let dx = (tip.x - wrist.x) - (from.tip.x - from.wrist.x);
    const dy = (tip.y - wrist.y) - (from.tip.y - from.wrist.y);
    if (mirror) dx = -dx;
    const across = Math.abs(dx);
    const along = Math.abs(dy);
    const travel = Math.hypot(across, along);
    if (turned < ARC_DEG || travel < palm * 0.45) return { gesture: null, angle, arc: turned };
    if (Math.max(across, along) < 1.4 * Math.min(across, along)) return { gesture: null, angle, arc: turned };
    const gesture = this.keep(across > along
      ? (dx < 0 ? 'swipe-left' : 'swipe-right')
      : (dy < 0 ? 'swipe-up' : 'swipe-down'), t);
    return { gesture, angle, arc: turned };
  }

  private palmSwipe(t: number, mirror: boolean): NamedGesture | null {
    if (t < this.coolUntil || this.trail.length < 3) return null;
    const from = this.trail[0];
    const to = this.trail[this.trail.length - 1];
    let dx = to.x - from.x;
    const dy = to.y - from.y;
    if (mirror) dx = -dx;
    const across = Math.abs(dx);
    const along = Math.abs(dy);
    if (Math.hypot(across, along) < 0.12) return null;
    if (Math.max(across, along) < 1.4 * Math.min(across, along)) return null;
    return this.keep(across > along
      ? (dx < 0 ? 'swipe-left' : 'swipe-right')
      : (dy < 0 ? 'swipe-up' : 'swipe-down'), t);
  }

  /** Same direction waits 0.5s. The opposite way is the hand traveling back, so it waits longer. */
  private keep(gesture: NamedGesture, t: number): NamedGesture | null {
    const dir = gesture.slice(6) as 'left' | 'right' | 'up' | 'down';
    const opposite = { left: 'right', right: 'left', up: 'down', down: 'up' } as const;
    const returning = this.lastDir !== null && dir === opposite[this.lastDir] && t - this.lastAt < 1100;
    this.trail = [];
    this.wristTrail = [];
    if (t < this.coolUntil || returning) return null;
    this.lastDir = dir;
    this.lastAt = t;
    this.coolUntil = t + 500;
    return gesture;
  }
}
