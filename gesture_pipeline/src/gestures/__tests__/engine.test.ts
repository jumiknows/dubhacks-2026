import { describe, expect, it } from 'vitest';
import { defaults } from '../config';
import { initialState, step, type EngineInput } from '../engine';
import type { Features, Intent } from '../types';
import { feat } from './synthetic';

const point = feat();
const pinch = feat({ pinchRatio: 0.1 });
const grip = (x = 0.5, y = 0.5, ratio = 0.46) => feat({
  pinchRatio: 0.2, threeFingerPinchRatio: ratio, middleExtension: 1.1, palmCenter: { x, y },
});
const movedPinch = (x: number, y = 0.5) => feat({ ...pinch, palmCenter: { x, y } });
const actions = (events: Intent[]) => events.filter(e => !['hover', 'pointer_down', 'pointer_up', 'drag_move'].includes(e.type));
function driver() {
  let state = initialState();
  let t = 0;
  const events: Intent[] = [];
  const send = (hand: Features | null, input: Partial<EngineInput> = {}, dt = 33) => {
    t += dt;
    const out = step(state, { t, hand, hoveredId: 'p1', draggable: true, pointer: { x: 0.2, y: 0.3 }, ...input }, defaults);
    state = out.state;
    events.push(...out.intents);
    return out;
  };
  const hold = (count: number, hand: Features | null, input: Partial<EngineInput> = {}) => {
    for (let i = 0; i < count; i++) send(hand, input);
  };
  const release = (input: Partial<EngineInput> = {}) => hold(6, point, input);
  hold(6, point);
  events.length = 0;
  return { send, hold, release, events, get state() { return state; } };
}

describe('press, click and dragging', () => {
  it('sends down/up and exactly one click for a stationary pinch', () => {
    const d = driver();
    d.hold(10, pinch);
    expect(d.events.map(e => e.type)).toEqual(['pointer_down']);
    d.release();
    expect(d.events.map(e => e.type)).toEqual(['pointer_down', 'pointer_up', 'select']);
    expect(actions(d.events)).toEqual([{ type: 'select', target_id: 'p1' }]);
  });
  it('a long hold alone does not start a drag', () => {
    const d = driver();
    d.hold(60, pinch);
    expect(d.state.mode).toBe('pinchPending');
    d.release();
    expect(actions(d.events)).toEqual([{ type: 'select', target_id: 'p1' }]);
  });
  it('drags as the pinched arm moves, captures its original target and drops without clicking', () => {
    const d = driver();
    d.hold(4, pinch);
    d.send(movedPinch(0.56), { hoveredId: 'p2', pointer: { x: 0.4, y: 0.4 } });
    d.send(movedPinch(0.65), { hoveredId: null });
    expect(d.state.mode).toBe('dragging');
    expect(d.events.find(e => e.type === 'drag_start')).toEqual({ type: 'drag_start', target_id: 'p1', start_x: 0.2, start_y: 0.3 });
    expect(d.events.filter(e => e.type === 'drag_move')).toHaveLength(2);
    d.release({ dropTargetId: 'tray' });
    expect(actions(d.events).map(e => e.type)).toEqual(['drag_start', 'drop']);
    expect(d.events.find(e => e.type === 'drop')).toEqual({ type: 'drop', target_id: 'p1', drop_target_id: 'tray' });
  });
  it('reports a free-space drop and ignores dropping onto the same card', () => {
    for (const dropTargetId of [null, 'p1']) {
      const d = driver();
      d.hold(4, pinch); d.send(movedPinch(0.6));
      d.release({ dropTargetId });
      expect(d.events.find(e => e.type === 'drop')).toEqual({ type: 'drop', target_id: 'p1', drop_target_id: null });
    }
  });
  it('clicks a non-draggable component without treating it as a product', () => {
    const d = driver();
    d.hold(5, pinch, { hoveredId: 'button:next', draggable: false });
    d.release({ hoveredId: 'button:next' });
    expect(actions(d.events)).toEqual([{ type: 'select', target_id: 'button:next' }]);
  });
  it('does not click a button after moving the pinched hand away', () => {
    const d = driver();
    d.hold(4, pinch, { hoveredId: 'button:next', draggable: false });
    d.send(movedPinch(0.6));
    d.release();
    expect(actions(d.events)).toEqual([]);
  });
  it('empty space cannot click a visually sticky previous hover target', () => {
    const d = driver();
    d.hold(5, pinch, { hoveredId: null });
    d.release({ hoveredId: null });
    expect(actions(d.events)).toEqual([]);
  });
  it('release debounce and hysteresis tolerate brief finger-tracking errors', () => {
    const d = driver();
    d.hold(4, pinch);
    d.send(point); d.send(point); // 33 ms of apparent release
    d.hold(4, feat({ pinchRatio: 0.36 }));
    expect(actions(d.events)).toEqual([]);
    d.release();
    expect(actions(d.events)).toEqual([{ type: 'select', target_id: 'p1' }]);
  });
  it('losing the hand during a drag cancels and releases without dropping or clicking', () => {
    const d = driver();
    d.hold(4, pinch); d.send(movedPinch(0.6)); d.hold(10, null);
    expect(actions(d.events).map(e => e.type)).toEqual(['drag_start', 'cancel']);
    expect(d.events.filter(e => e.type === 'pointer_up')).toHaveLength(1);
    expect(d.state.mode).toBe('idle');
  });
  it('a short detection dropout preserves a live drag', () => {
    const d = driver();
    d.hold(4, pinch); d.send(movedPinch(0.6)); d.hold(3, null); d.send(movedPinch(0.62));
    expect(d.state.mode).toBe('dragging');
    expect(d.events.some(e => e.type === 'cancel')).toBe(false);
  });
});

describe('intentional three-finger swipes', () => {
  it('accepts a relaxed three-finger pinch, fires left at travel threshold, and fires once until release', () => {
    const d = driver();
    d.hold(5, grip(), { hoveredId: null });
    expect(d.state.mode).toBe('swiping');
    d.send(grip(0.62), { hoveredId: null });
    d.hold(30, grip(0.8), { hoveredId: null });
    expect(actions(d.events)).toEqual([{ type: 'reveal' }]);
  });
  it('a right swipe dismisses the card captured before moving across other components', () => {
    const d = driver();
    d.hold(5, grip(), { swipeTargetId: 'p1' });
    d.send(grip(0.36), { hoveredId: 'button:next', swipeTargetId: null });
    expect(actions(d.events)).toEqual([{ type: 'dismiss', target_id: 'p1' }]);
  });
  it('right swipes over empty space never dismiss unrelated cards', () => {
    const d = driver();
    d.hold(5, grip(), { hoveredId: null });
    d.send(grip(0.36), { hoveredId: 'p2' });
    expect(actions(d.events)).toEqual([]);
  });
  it('does not interpret an ordinary two-finger pinch near a straight middle finger as a swipe', () => {
    const d = driver();
    const two = feat({ ...pinch, threeFingerPinchRatio: 0.46, middleExtension: 1.4 });
    d.hold(10, two);
    d.send(feat({ ...two, palmCenter: { x: 0.65, y: 0.5 } }));
    expect(d.state.mode).toBe('dragging');
    expect(actions(d.events).map(e => e.type)).toEqual(['drag_start']);
  });
  it('does not turn an active drag into a swipe if the middle finger happens to close', () => {
    const d = driver();
    d.hold(4, pinch); d.send(movedPinch(0.6)); d.hold(10, grip(0.65));
    expect(d.state.mode).toBe('dragging');
    expect(d.events.some(e => e.type === 'reveal' || e.type === 'dismiss')).toBe(false);
  });
  it('upgrades a pending click to a three-finger swipe without also selecting', () => {
    const d = driver();
    d.send(pinch);
    d.hold(5, grip());
    d.send(grip(0.62));
    d.release(); d.hold(10, point);
    expect(actions(d.events)).toEqual([{ type: 'reveal' }]);
  });
  it('tolerates brief loss of the three-finger shape while armed', () => {
    const d = driver();
    d.hold(5, grip()); d.hold(2, point); d.send(grip(0.62));
    expect(actions(d.events)).toEqual([{ type: 'reveal' }]);
  });
  it('a sustained release cancels an unfinished swipe and never falls back to a click', () => {
    const d = driver();
    d.hold(5, grip()); d.release(); d.hold(6, point);
    expect(actions(d.events)).toEqual([]);
    expect(d.state.mode).toBe('tracking');
  });
  it('requires arming, sufficient travel and horizontal direction', () => {
    const d = driver();
    d.send(grip()); d.release();
    expect(actions(d.events)).toEqual([]);
    const diagonal = driver();
    diagonal.hold(5, grip()); diagonal.send(grip(0.65, 0.7)); diagonal.release();
    expect(actions(diagonal.events)).toEqual([]);
    const jitter = driver();
    jitter.hold(5, grip()); jitter.send(grip(0.52)); jitter.release();
    expect(actions(jitter.events)).toEqual([]);
  });
  it('ordinary fast open-hand motion does nothing', () => {
    const d = driver();
    for (let i = 0; i < 12; i++) d.send(feat({ palmCenter: { x: 0.2 + i * 0.05, y: 0.5 } }));
    expect(actions(d.events)).toEqual([]);
  });
  it('tracking loss cancels a swipe without manufacturing an action', () => {
    const d = driver();
    d.hold(5, grip()); d.hold(10, null);
    expect(actions(d.events).map(e => e.type)).toEqual(['cancel']);
    expect(d.state.mode).toBe('idle');
  });
  it('pulling up scrolls down, keeps scrolling while held, and stays on the initial pane', () => {
    const d = driver();
    d.hold(5, grip(), { scrollTargetId: 'catalogue' });
    d.send(grip(0.5, 0.38), { scrollTargetId: 'other-pane' });
    d.send(grip(0.5, 0.32), { scrollTargetId: null });
    const scrolls = d.events.filter(e => e.type === 'scroll');
    expect(scrolls).toHaveLength(2);
    expect(scrolls.map(e => e.target_id)).toEqual(['catalogue', 'catalogue']);
    expect(scrolls[0].delta_y).toBeCloseTo(0.24);
    expect(scrolls[1].delta_y).toBeCloseTo(0.12);
    expect(actions(d.events).every(e => e.type === 'scroll')).toBe(true);
  });
  it('scrolling can reverse while held, ignores small jitter, and never reveals or dismisses', () => {
    const d = driver();
    d.hold(5, grip());
    d.send(grip(0.5, 0.38));
    d.send(grip(0.5, 0.379));
    d.send(grip(0.75, 0.44)); // horizontal drift after locking vertical
    const scrolls = d.events.filter(e => e.type === 'scroll');
    expect(scrolls).toHaveLength(2);
    expect(scrolls[1].delta_y).toBeCloseTo(-0.12);
    expect(d.state.swipeAxis).toBe('vertical');
    expect(d.events.some(e => ['select', 'reveal', 'dismiss', 'drag_start'].includes(e.type))).toBe(false);
  });
  it('pulling down scrolls up regardless of camera mirroring', () => {
    for (const mirror of [true, false]) {
      let state = initialState();
      const events: Intent[] = [];
      for (let i = 0; i < 15; i++) {
        const out = step(state, { t: i * 33, hand: i < 6 ? point : grip(0.5, i < 12 ? 0.5 : 0.65), hoveredId: 'p1' },
          { ...defaults, mapping: { ...defaults.mapping, mirror } });
        state = out.state; events.push(...out.intents);
      }
      expect(events.find(e => e.type === 'scroll')).toMatchObject({ delta_y: expect.closeTo(-0.3) });
    }
  });
  it('horizontal swipes cannot turn into scrolling until released', () => {
    const d = driver();
    d.hold(5, grip()); d.send(grip(0.65)); d.send(grip(0.65, 0.3));
    expect(actions(d.events)).toEqual([{ type: 'reveal' }]);
  });
  it('scrolling stops on release and a fresh pinch can choose a different direction', () => {
    const d = driver();
    d.hold(5, grip()); d.send(grip(0.5, 0.35)); d.release(); d.hold(10, point);
    const count = d.events.filter(e => e.type === 'scroll').length;
    d.hold(5, grip()); d.send(grip(0.65));
    expect(d.events.filter(e => e.type === 'scroll')).toHaveLength(count);
    expect(actions(d.events).map(e => e.type)).toEqual(['scroll', 'reveal']);
  });
  it('a pose blip pauses scrolling, and sustained hand loss cancels it', () => {
    const d = driver();
    d.hold(5, grip()); d.send(grip(0.5, 0.35));
    d.hold(2, point); d.hold(2, null);
    expect(actions(d.events).map(e => e.type)).toEqual(['scroll']);
    d.send(grip(0.5, 0.3)); d.hold(10, null);
    expect(actions(d.events).map(e => e.type)).toEqual(['scroll', 'scroll', 'cancel']);
  });
});
