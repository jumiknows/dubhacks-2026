// Pointer input emits the same press/drag/release events as the hand engine.
import { gestureBus, makeEvent } from '../bus';
import { config } from '../config';
import { dropTargetAt, targetAt } from '../hitTest';

export function installPointer(): () => void {
  let hover: string | null = null;
  let down: { id: string; element: HTMLElement; x: number; y: number; pointerId: number; draggable: boolean; moved: boolean; dragging: boolean } | null = null;
  const position = (e: PointerEvent) => ({ x: e.clientX / innerWidth, y: e.clientY / innerHeight });
  const cancel = () => {
    if (!down) return;
    const id = down.id;
    down = null;
    gestureBus.emit(makeEvent('pointer_up', 'mouse', { target_id: id }));
    gestureBus.emit(makeEvent('cancel', 'mouse', { target_id: id }));
  };
  const onMove = (e: PointerEvent) => {
    if (!down) {
      const id = targetAt(e.clientX, e.clientY)?.id ?? null;
      if (id !== hover) {
        hover = id;
        gestureBus.emit(makeEvent('hover', 'mouse', { ...position(e), target_id: id }));
      }
      return;
    }
    if (e.pointerId !== down.pointerId) return;
    down.moved ||= Math.hypot(e.clientX - down.x, e.clientY - down.y) >= config.drag.pointerMinPx;
    const origin = { start_x: down.x / innerWidth, start_y: down.y / innerHeight };
    if (down.draggable && down.moved) {
      e.preventDefault();
      if (!down.dragging) {
        down.dragging = true;
        gestureBus.emit(makeEvent('drag_start', 'mouse', { ...position(e), ...origin, target_id: down.id }));
      }
      gestureBus.emit(makeEvent('drag_move', 'mouse', { ...position(e), ...origin, target_id: down.id }));
    }
  };
  const onDown = (e: PointerEvent) => {
    if (e.button !== 0 || (e.target as Element)?.closest('button, a, input, textarea, select, [data-gesture-ignore]')) return;
    const target = targetAt(e.clientX, e.clientY);
    if (!target) return;
    down = { id: target.id, element: target.element, x: e.clientX, y: e.clientY,
      pointerId: e.pointerId, draggable: target.draggable, moved: false, dragging: false };
    target.element.setPointerCapture?.(e.pointerId);
    gestureBus.emit(makeEvent('pointer_down', 'mouse', { ...position(e), target_id: target.id }));
  };
  const onUp = (e: PointerEvent) => {
    if (!down || e.pointerId !== down.pointerId) return;
    const press = down;
    down = null;
    gestureBus.emit(makeEvent('pointer_up', 'mouse', { ...position(e), target_id: press.id }));
    if (press.dragging) {
      gestureBus.emit(makeEvent('drop', 'mouse', { ...position(e), target_id: press.id,
        drop_target_id: dropTargetAt(e.clientX, e.clientY, press.id) }));
    } else if (!press.moved && targetAt(e.clientX, e.clientY)?.id === press.id) {
      gestureBus.emit(makeEvent('select', 'mouse', { ...position(e), target_id: press.id }));
    }
  };
  const offCancel = gestureBus.on('cancel', () => {
    if (down) gestureBus.emit(makeEvent('pointer_up', 'mouse', { target_id: down.id }));
    down = null;
  });
  window.addEventListener('pointerdown', onDown);
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', cancel);
  window.addEventListener('blur', cancel);
  return () => {
    offCancel(); cancel();
    window.removeEventListener('pointerdown', onDown);
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', cancel);
    window.removeEventListener('blur', cancel);
  };
}
