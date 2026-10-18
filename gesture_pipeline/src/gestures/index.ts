// Public API imported by the host application's UI.
export { GestureProvider, useGestureEvents, useGestureStatus } from './useGestures';
export { scrollElement } from './hitTest';
export { gestureBus, makeEvent } from './bus';
export { gestures } from './loop';
export { Hints } from './ui/Hints';
export { config, defaults, setPath } from './config';
export { DEFAULT_GESTURE_MAP, actionForEvent, actionForGesture, getGestureMap, resetGestureMap, setGestureBinding, setGestureMap, subscribeGestureMap } from './gestureMap';
export type { GestureEvent, GestureStatus, GestureType, GestureSource, GestureId, GestureAction, GestureMap, HandId, BimanualKind, ObjectTarget, FrameObservation } from './types';
