// Keyboard alternatives: Enter selects, left reveals, right/Delete dismisses, Esc closes or undoes.
import { gestureBus, makeEvent } from '../bus';

export function installKeyboard(getHovered: () => string | null): () => void {
  const onKey = (event: KeyboardEvent) => {
    const active = document.activeElement;
    if (event.repeat || active?.matches('input, textarea, select') || (active as HTMLElement | null)?.isContentEditable) return;
    const target = active?.closest('[data-product-id]')?.getAttribute('data-product-id') ?? getHovered();
    switch (event.key) {
      case 'ArrowLeft':
        event.preventDefault();
        gestureBus.emit(makeEvent('reveal', 'keyboard'));
        break;
      case 'ArrowRight':
      case 'Delete':
      case 'Backspace':
        if (target) {
          event.preventDefault();
          gestureBus.emit(makeEvent('dismiss', 'keyboard', { target_id: target }));
        }
        break;
      case 'Enter':
        if (target && !active?.matches('button, a')) gestureBus.emit(makeEvent('select', 'keyboard', { target_id: target }));
        break;
      case 'Escape':
        gestureBus.emit(makeEvent('cancel', 'keyboard'));
        break;
    }
  };
  window.addEventListener('keydown', onKey);
  return () => window.removeEventListener('keydown', onKey);
}
