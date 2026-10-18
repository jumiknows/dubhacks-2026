import { afterEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_GESTURE_MAP,
  actionForEvent,
  getGestureMap,
  resetGestureMap,
  setGestureBinding,
} from '../gestureMap';
import { makeEvent } from '../bus';

afterEach(() => resetGestureMap());

describe('gesture-to-action bindings', () => {
  it('keeps the documented defaults', () => {
    expect(getGestureMap()).toEqual(DEFAULT_GESTURE_MAP);
    expect(actionForEvent('reveal')).toBe('browse_next');
    expect(actionForEvent('expand')).toBe('break_group');
    expect(actionForEvent('scroll', 0.1)).toBe('scroll_forward');
  });

  it('allows a binding to be customized without changing the event type', () => {
    setGestureBinding('swipe_left', 'select');
    const event = makeEvent('reveal', 'hand');
    expect(event.type).toBe('reveal');
    expect(event.gesture_id).toBe('swipe_left');
    expect(event.action).toBe('select');
  });

  it('restores defaults', () => {
    setGestureBinding('fist_grab', 'break_group');
    resetGestureMap();
    expect(getGestureMap()).toEqual(DEFAULT_GESTURE_MAP);
  });
});
