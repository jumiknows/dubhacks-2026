// Semantic bindings for recognized gestures. Event types remain stable for compatibility;
// the action field lets hosts customize meaning without rewriting the recognizer.

import type { GestureAction, GestureEvent, GestureId, GestureMap, GestureType } from './types';

export const DEFAULT_GESTURE_MAP: Readonly<GestureMap> = Object.freeze({
  hover: 'highlight_target',
  pinch_select: 'select',
  pinch_drag: 'drag',
  drag_move: 'drag_move',
  drop: 'drop',
  swipe_left: 'browse_next',
  swipe_right: 'browse_previous',
  swipe_up: 'scroll_forward',
  swipe_down: 'scroll_backward',
  fist_grab: 'hold_target',
  fist_release: 'activate_target',
  two_hand_split: 'break_group',
  two_hand_recombine: 'recombine_group',
  two_hand_compare: 'compare',
  cancel: 'cancel',
});

const STORAGE_KEY = 'conjure.gesture.map.v1';
let current: GestureMap = load();
const listeners = new Set<(map: GestureMap) => void>();

function load(): GestureMap {
  const next = { ...DEFAULT_GESTURE_MAP };
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
    if (raw) {
      const saved = JSON.parse(raw) as Partial<GestureMap>;
      for (const id of Object.keys(next) as GestureId[]) {
        if (typeof saved[id] === 'string') next[id] = saved[id] as GestureAction;
      }
    }
  } catch {
    /* storage blocked or malformed: use defaults */
  }
  return next;
}

function save() {
  try {
    const overrides = Object.fromEntries(
      (Object.keys(current) as GestureId[])
        .filter((id) => current[id] !== DEFAULT_GESTURE_MAP[id])
        .map((id) => [id, current[id]]),
    );
    localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides));
  } catch {
    /* ignore storage failures */
  }
}

function notify() {
  const snapshot = getGestureMap();
  listeners.forEach((listener) => listener(snapshot));
}

export function getGestureMap(): GestureMap {
  return { ...current };
}

export function setGestureBinding(gesture: GestureId, action: GestureAction): void {
  if (!DEFAULT_GESTURE_MAP[gesture] || typeof action !== 'string') return;
  current = { ...current, [gesture]: action };
  save();
  notify();
}

export function setGestureMap(bindings: Partial<GestureMap>): void {
  let next = { ...current };
  for (const [gesture, action] of Object.entries(bindings)) {
    if (gesture in DEFAULT_GESTURE_MAP && typeof action === 'string') {
      next[gesture as GestureId] = action as GestureAction;
    }
  }
  current = next;
  save();
  notify();
}

export function resetGestureMap(): void {
  current = { ...DEFAULT_GESTURE_MAP };
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore storage failures */
  }
  notify();
}

export function subscribeGestureMap(listener: (map: GestureMap) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function gestureIdForEvent(type: GestureType, deltaY?: number): GestureId {
  switch (type) {
    case 'hover': return 'hover';
    case 'select': return 'pinch_select';
    case 'pointer_down': return 'pinch_select';
    case 'drag_start': return 'pinch_drag';
    case 'drag_move': return 'drag_move';
    case 'drop': return 'drop';
    case 'reveal': return 'swipe_left';
    case 'dismiss': return 'swipe_right';
    case 'scroll': return (deltaY ?? 0) >= 0 ? 'swipe_up' : 'swipe_down';
    case 'grab': return 'fist_grab';
    case 'release': return 'fist_release';
    case 'expand': return 'two_hand_split';
    case 'collapse': return 'two_hand_recombine';
    case 'compare': return 'two_hand_compare';
    case 'cancel': return 'cancel';
    case 'pointer_up': return 'fist_release';
    case 'bimanual_start': return 'two_hand_split';
    case 'bimanual_progress': return 'two_hand_split';
    case 'bimanual_end': return 'two_hand_split';
    case 'bimanual_cancel': return 'cancel';
    default: return 'cancel';
  }
}

export function actionForEvent(type: GestureType, deltaY?: number): GestureAction {
  return current[gestureIdForEvent(type, deltaY)];
}

export function actionForGesture(gesture: GestureId): GestureAction {
  return current[gesture];
}

export function gestureAction(event: Pick<GestureEvent, 'type' | 'delta_y'>): GestureAction {
  return actionForEvent(event.type, event.delta_y);
}
