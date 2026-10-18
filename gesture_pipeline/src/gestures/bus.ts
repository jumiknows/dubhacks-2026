// Tiny typed event bus. Every input source (hand, mouse, keyboard, voice) emits GestureEvents here.

import type { GestureEvent, GestureSource, GestureType } from './types';

type Handler = (e: GestureEvent) => void;
const handlers = new Map<GestureType | '*', Set<Handler>>();
const seen: string[] = [];

export const gestureBus = {
  on(type: GestureType | '*', fn: Handler): () => void {
    if (!handlers.has(type)) handlers.set(type, new Set());
    handlers.get(type)!.add(fn);
    return () => handlers.get(type)?.delete(fn);
  },
  emit(e: GestureEvent) {
    // De-duplicate by event_id so a double emit can never act twice.
    if (seen.includes(e.event_id)) return;
    seen.push(e.event_id);
    if (seen.length > 200) seen.shift();
    for (const key of [e.type, '*'] as const) {
      handlers.get(key)?.forEach(fn => {
        try {
          fn(e);
        } catch (err) {
          console.error('[gestureBus] listener failed', err); // one broken listener must not stop the loop
        }
      });
    }
  },
};

let counter = 0;
const uid = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `g${Date.now()}-${counter++}`;

/** Helper for adapters and UI buttons: fills in ts and event_id. */
export function makeEvent(
  type: GestureType,
  source: GestureSource,
  rest: Partial<Omit<GestureEvent, 'type' | 'source' | 'ts' | 'event_id'>> = {},
): GestureEvent {
  return {
    type,
    source,
    x: rest.x ?? 0.5,
    y: rest.y ?? 0.5,
    confidence: rest.confidence ?? 1,
    target_id: rest.target_id,
    drop_target_id: rest.drop_target_id,
    start_x: rest.start_x,
    start_y: rest.start_y,
    delta_y: rest.delta_y,
    ts: performance.now(),
    event_id: uid(),
  };
}
