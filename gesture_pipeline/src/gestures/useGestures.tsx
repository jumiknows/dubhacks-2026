import { useEffect, useRef, useSyncExternalStore, type ReactNode } from 'react';
import { installKeyboard } from './adapters/keyboard';
import { installPointer } from './adapters/pointer';
import { gestureBus } from './bus';
import { gestures } from './loop';
import { markPressed, scrollTarget } from './hitTest';
import type { GestureEvent, GestureStatus, GestureType } from './types';
import { CameraPreview } from './ui/CameraPreview';
import { GestureDebug } from './ui/GestureDebug';
import { Cursor } from './ui/Cursor';
import { DebugOverlay } from './ui/DebugOverlay';
import { TuningPanel } from './ui/TuningPanel';
import './ui/gestures.css';

const debugFromUrl = () => typeof location !== 'undefined' && new URLSearchParams(location.search).has('gdebug');

/** Mount once in the host app. Owns camera, cursor and optional debug tools. */
export function GestureProvider({ children, debug = debugFromUrl(), poseDebug = true }: { children: ReactNode; debug?: boolean; poseDebug?: boolean }) {
  const lastHover = useRef<string | null>(null);

  useEffect(() => {
    const offHover = gestureBus.on('hover', e => {
      lastHover.current = e.target_id ?? null;
    });
    const offPointer = installPointer();
    const offKeys = installKeyboard(() => lastHover.current);
    const owner = (e: GestureEvent) => `${e.source}:${e.hand_id ?? 'default'}`;
    const offDown = gestureBus.on('pointer_down', e => markPressed(e.target_id, true, owner(e)));
    const offUp = gestureBus.on('pointer_up', e => markPressed(e.target_id, false, owner(e)));
    const offScroll = gestureBus.on('scroll', e => scrollTarget(e.target_id, e.delta_y ?? 0));
    const offCancel = gestureBus.on('cancel', e => {
      markPressed(e.target_id, false, owner(e));
      if (e.source !== 'hand' && e.source !== 'replay') gestures.cancelInteraction(false);
    });
    return () => {
      offHover();
      offPointer();
      offKeys();
      offDown(); offUp(); offCancel(); offScroll();
      gestures.stop();
    };
  }, []);

  return (
    <>
      {children}
      <CameraPreview />
      {poseDebug && <GestureDebug />}
      <Cursor />
      {debug && <DebugOverlay />}
      {debug && <TuningPanel />}
    </>
  );
}

export function useGestureStatus(): GestureStatus & { start: () => Promise<void>; stop: () => void } {
  const s = useSyncExternalStore(gestures.subscribe, gestures.getStatus, gestures.getStatus);
  return { ...s, start: () => gestures.start(), stop: () => gestures.stop() };
}

/** Subscribe to gesture events for the component's lifetime. */
export function useGestureEvents(type: GestureType | '*', handler: (e: GestureEvent) => void) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => gestureBus.on(type, e => ref.current(e)), [type]);
}
