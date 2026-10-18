// Pure replay of recorded landmark fixtures through the full pipeline (minus camera and DOM).
// Used by tests and by `npm run gestures:metrics`.

import { defaults, type Config } from './config';
import { initialState, interactionActive, step } from './engine';
import { extract } from './features';
import { initialPrimary, selectPrimary } from './hands';
import { PointerMapper } from './mapping';
import type { FrameInput, HandFrame } from './types';

export type FixtureHand = { landmarks: number[][]; handedness?: string };
export type FixtureFrame = { t: number; hands: FixtureHand[];
  timing?: { inferenceMs: number; processingMs: number };
  hit?: { targetId: string | null; draggable: boolean; swipeTargetId: string | null; dropTargetId: string | null; scrollTargetId?: string | null } };
export type HitRegion = { x0: number; x1: number; y0?: number; y1?: number; id: string; draggable?: boolean };
export type Fixture = {
  name: string;
  recordedAt?: string;
  notes?: string;
  source?: 'camera' | 'synthetic';
  recordingConfig?: Config;
  videoW: number;
  videoH: number;
  viewportW?: number;
  viewportH?: number;
  frames: FixtureFrame[];
  hitTest?: { default?: string | null; regions?: HitRegion[] };
  dropZones?: HitRegion[];
  expected: string[]; // event types in order; [] means nothing may fire
  expectedTargets?: Array<string | null>;
  expectedDropTargets?: Array<string | null>;
  expectedScroll?: { direction: 'forward' | 'backward' | 'either'; target?: string; minTravel?: number; maxTravel?: number };
};

export function toFrameInput(fr: FixtureFrame, W: number, H: number): FrameInput {
  const hands: HandFrame[] = fr.hands.map(h => ({
    landmarks: h.landmarks.map(([x, y, z]) => ({ x, y, z: z ?? 0 })),
    handedness: h.handedness,
  }));
  return { t: fr.t, hands, videoW: W, videoH: H };
}

const inRegion = (r: HitRegion, x: number, y: number) =>
  x >= r.x0 && x < r.x1 && y >= (r.y0 ?? 0) && y < (r.y1 ?? 1);

export function fakeHitTest(fx: Fixture, x: number, y: number): string | null {
  const r = fx.hitTest?.regions?.find(reg => inRegion(reg, x, y));
  if (r) return r.id;
  return fx.hitTest?.default ?? null;
}

export type ReplayResult = { events: string[]; detail: { t: number; type: string; target?: string | null; dropTarget?: string | null; deltaY?: number }[] };

export function replay(fx: Fixture, cfg: Config = defaults): ReplayResult {
  // Match the live filter's pixel units before converting back for fixture hit-testing.
  const vw = fx.viewportW ?? 1280;
  const vh = fx.viewportH ?? 720;
  let state = initialState();
  let primary = initialPrimary();
  const mapper = new PointerMapper();
  const events: string[] = [];
  const detail: ReplayResult['detail'] = [];

  for (const fr of fx.frames) {
    const frame = toFrameInput(fr, fx.videoW, fx.videoH);
    const sel = selectPrimary(frame, primary, cfg.hands);
    primary = sel.state;
    if (sel.switched) {
      mapper.reset();
      if (interactionActive(state)) {
        events.push('cancel'); detail.push({ t: fr.t, type: 'cancel', target: state.pinchTarget });
        state = { ...initialState(), blockedUntilOpen: true };
      }
    }
    const f = sel.hand ? extract(sel.hand, fx.videoW, fx.videoH) : null;
    let hovered: string | null = null;
    let pointer;
    let draggable = true;
    let dropTargetId: string | null = null;
    if (f) {
      const freeze = ['pinchPending', 'dragging'].includes(state.mode) && f.pinchRatio >= cfg.pinch.off;
      const p = mapper.update(f, fr.t, vw, vh, cfg, freeze);
      const x = p.x / vw, y = p.y / vh;
      pointer = { x, y };
      hovered = fakeHitTest(fx, x, y);
      draggable = fx.hitTest?.regions?.find(region => inRegion(region, x, y))?.draggable ?? true;
      dropTargetId = fx.dropZones?.find(region => inRegion(region, x, y))?.id ?? hovered;
    }
    const hit = fr.hit;
    const out = step(state, { t: fr.t, hand: f, hoveredId: hit ? hit.targetId : hovered, pointer,
      draggable: hit?.draggable ?? draggable, swipeTargetId: hit ? hit.swipeTargetId : hovered,
      dropTargetId: hit ? hit.dropTargetId : dropTargetId,
      scrollTargetId: hit?.scrollTargetId,
    }, cfg);
    state = out.state;
    for (const i of out.intents) {
      events.push(i.type);
      detail.push({ t: fr.t, type: i.type, target: 'target_id' in i ? i.target_id : undefined,
        dropTarget: 'drop_target_id' in i ? i.drop_target_id : undefined,
        deltaY: 'delta_y' in i ? i.delta_y : undefined });
    }
  }
  return { events, detail };
}

/** Discrete events only (hover changes are not counted as fires). */
export const DISCRETE = new Set(['reveal', 'select', 'drag_start', 'drop', 'dismiss', 'cancel']);

/** Exact expectations: duplicate/wrong-target actions and unintended continuous scrolling must fail too. */
export function assessFixture(fixture: Fixture, result: ReplayResult): string[] {
  const errors: string[] = [];
  const actions = result.detail.filter(event => DISCRETE.has(event.type));
  const expected = fixture.expected.filter(type => DISCRETE.has(type));
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  if (!same(actions.map(event => event.type), expected)) errors.push(`expected ${expected.join(', ') || 'no actions'}, got ${actions.map(event => event.type).join(', ') || 'none'}`);
  if (fixture.expectedTargets && !same(actions.map(event => event.target ?? null), fixture.expectedTargets)) errors.push('wrong action target');
  if (fixture.expectedDropTargets && !same(actions.map(event => event.dropTarget ?? null), fixture.expectedDropTargets)) errors.push('wrong drop target');
  for (const type of fixture.expected) if (!DISCRETE.has(type) && type !== 'scroll') errors.push(`unknown expected action: ${type}`);
  const scrolls = result.detail.filter(event => event.type === 'scroll');
  const scroll = fixture.expectedScroll ?? (fixture.expected.includes('scroll') ? { direction: 'either' as const } : null);
  if (!scroll && scrolls.length) errors.push('unexpected scrolling');
  if (scroll) {
    const amount = scrolls.reduce((sum, event) => sum + (event.deltaY ?? 0), 0);
    const travel = scrolls.reduce((sum, event) => sum + Math.abs(event.deltaY ?? 0), 0);
    if (!scrolls.length || travel < (scroll.minTravel ?? 0.05)) errors.push('missing or insufficient scrolling');
    if (scroll.maxTravel !== undefined && travel > scroll.maxTravel) errors.push('excessive scroll travel');
    if ((scroll.direction === 'forward' && amount <= 0) || (scroll.direction === 'backward' && amount >= 0)) errors.push('wrong scroll direction');
    if (scroll.target !== undefined && scrolls.some(event => event.target !== scroll.target)) errors.push('wrong scroll container');
    if (scrolls.some(event => !Number.isFinite(event.deltaY))) errors.push('invalid scroll distance');
  }
  return errors;
}
