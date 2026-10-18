// Deterministic rule-level stress inputs, shared by the assessment command and regression tests.
// These exercise timing/noise; they are not camera recordings or evidence of model accuracy.
import { defaults, type Config } from '../config';
import { initialState, step, type EngineInput } from '../engine';
import type { Features } from '../types';
import { feat } from './synthetic';

export type StressCase = {
  name: string; frames: EngineInput[]; expected: string[];
  response?: { type: string; after: number; budgetMs: number };
  scrollSign?: number;
};

export function stressCases(seed: number, fps: number): StressCase[] {
  let randomState = seed >>> 0;
  const random = () => { randomState = (1664525 * randomState + 1013904223) >>> 0; return randomState / 4294967296; };
  const point = (x = 0.5, y = 0.5) => feat({ palmCenter: { x, y } });
  const pinch = (x = 0.5, y = 0.5) => feat({ pinchRatio: 0.19, palmCenter: { x, y } });
  const grip = (x = 0.5, y = 0.5) => feat({ pinchRatio: 0.2, threeFingerPinchRatio: 0.46, middleExtension: 1.1, palmCenter: { x, y } });
  const cases: StressCase[] = [];
  const make = (name: string, expected: string[]) => {
    let t = 0;
    const frames: EngineInput[] = [];
    const add = (f: Features | null) => {
      t += 1000 / fps * (0.95 + random() * 0.1);
      const noise = () => (random() - 0.5) * 0.002;
      const hand = f ? { ...f, palmCenter: { x: f.palmCenter.x + noise(), y: f.palmCenter.y + noise() }, pinchRatio: f.pinchRatio + noise() } : null;
      frames.push({ t, hand, hoveredId: 'p1', draggable: true, swipeTargetId: 'p1', scrollTargetId: 'catalogue',
        pointer: hand?.palmCenter, dropTargetId: 'tray' });
    };
    const hold = (ms: number, hand: Features | null) => { for (let i = 0; i < Math.ceil(ms * fps / 1000); i++) add(hand); };
    const move = (ms: number, pose: typeof point, dx: number, dy = 0) => {
      const count = Math.ceil(ms * fps / 1000);
      for (let i = 1; i <= count; i++) add(pose(0.5 + dx * i / count, 0.5 + dy * i / count));
    };
    hold(300, point());
    const scenario: StressCase = { name: `${name} / ${fps}fps / seed ${seed}`, frames, expected };
    cases.push(scenario);
    return { add, hold, move, scenario, get t() { return t; } };
  };
  const idle = make('ordinary pointing', []); idle.move(1800, point, 0.28, 0.2);
  const click = make('click', ['select']); click.hold(160, pinch());
  click.scenario.response = { type: 'select', after: click.t + 1000 / fps, budgetMs: 145 };
  click.hold(250, point());
  const repeat = make('rapid repeat clicks', ['select', 'select']);
  for (let i = 0; i < 2; i++) { repeat.hold(180, pinch()); repeat.hold(150, point()); }
  const glitch = make('one-frame pinch glitch', []); glitch.add(pinch()); glitch.hold(300, point());
  const held = make('held pinch fires once', ['select']); held.hold(1000, pinch()); held.hold(300, point());
  const hysteresis = make('brief release glitch', ['select']); hysteresis.hold(160, pinch());
  hysteresis.add(point()); hysteresis.hold(150, feat({ pinchRatio: 0.36 })); hysteresis.hold(300, point());
  for (const direction of [-1, 1]) {
    const swipe = make(direction > 0 ? 'left reveal' : 'right dismiss', [direction > 0 ? 'reveal' : 'dismiss']);
    swipe.hold(150, grip());
    swipe.scenario.response = { type: direction > 0 ? 'reveal' : 'dismiss', after: swipe.t, budgetMs: 250 };
    swipe.move(260, grip, direction * 0.2, 0.008); swipe.hold(250, grip(0.5 + direction * 0.2)); swipe.hold(250, point());
    const fast = make(direction > 0 ? 'fast left reveal' : 'fast right dismiss', [direction > 0 ? 'reveal' : 'dismiss']);
    fast.scenario.response = { type: direction > 0 ? 'reveal' : 'dismiss', after: fast.t, budgetMs: 260 };
    fast.move(160, grip, direction * 0.24); fast.hold(300, point());
  }
  const poseGlitch = make('brief three-finger pose glitch', []); poseGlitch.move(60, grip, 0.2); poseGlitch.hold(300, point());
  const repeatedSwipes = make('rapid repeated left swipes', ['reveal', 'reveal']);
  for (let i = 0; i < 2; i++) { repeatedSwipes.move(160, grip, 0.24); repeatedSwipes.hold(180, point()); }
  const small = make('armed small hand reposition', []); small.hold(150, grip()); small.move(260, grip, 0.075); small.hold(250, point());
  const diagonal = make('ambiguous diagonal', []); diagonal.hold(150, grip()); diagonal.move(260, grip, 0.16, 0.16); diagonal.hold(250, point());
  for (const direction of [-1, 1]) {
    const scroll = make(direction < 0 ? 'scroll forward' : 'scroll backward', ['scroll']); scroll.scenario.scrollSign = -direction;
    scroll.hold(150, grip()); scroll.move(360, grip, 0.008, direction * 0.2); scroll.hold(150, grip(0.508, 0.5 + direction * 0.2)); scroll.hold(250, point());
  }
  const drag = make('drag and drop', ['drag_start', 'drop']); drag.hold(160, pinch()); drag.move(300, pinch, 0.2); drag.hold(250, point());
  const loss = make('loss does not reclick held hand', ['drag_start', 'cancel']);
  loss.hold(160, pinch()); loss.move(250, pinch, 0.15); loss.hold(400, null); loss.hold(350, pinch(0.65)); loss.hold(300, point(0.65));
  const blip = make('swipe survives missing frames', ['reveal']); blip.hold(150, grip()); blip.hold(65, null); blip.move(260, grip, 0.2); blip.hold(250, point());
  return cases;
}

export function assessStress(scenario: StressCase, config: Config = defaults) {
  let state = initialState();
  const actions: string[] = [];
  let scrolling = false;
  let responseMs: number | null = null;
  let scrollAmount = 0;
  let scrollWrongWay = false;
  for (const frame of scenario.frames) {
    const out = step(state, frame, config); state = out.state;
    if (state.mode !== 'swiping') scrolling = false;
    for (const intent of out.intents) {
      if (intent.type === 'scroll') {
        if (!scrolling) { actions.push('scroll'); scrolling = true; }
        scrollAmount += intent.delta_y;
        if (scenario.scrollSign && intent.delta_y * scenario.scrollSign < -0.012) scrollWrongWay = true;
      } else if (['select', 'reveal', 'dismiss', 'drag_start', 'drop', 'cancel'].includes(intent.type)) actions.push(intent.type);
      if (scenario.response && intent.type === scenario.response.type && responseMs === null) responseMs = frame.t - scenario.response.after;
    }
  }
  const errors: string[] = [];
  if (JSON.stringify(actions) !== JSON.stringify(scenario.expected)) errors.push(`actions ${actions.join(',') || '(none)'}, expected ${scenario.expected.join(',') || '(none)'}`);
  if (scenario.response && (responseMs === null || responseMs > scenario.response.budgetMs)) errors.push(`response ${responseMs?.toFixed(1) ?? 'missing'}ms exceeds ${scenario.response.budgetMs}ms`);
  if (scenario.scrollSign && (scrollWrongWay || scrollAmount * scenario.scrollSign < 0.3 || scrollAmount * scenario.scrollSign > 0.5)) errors.push(`scroll amount/direction ${scrollAmount.toFixed(3)}`);
  return { errors, responseMs };
}
