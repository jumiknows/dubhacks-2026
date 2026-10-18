import type { ObjectTarget } from './types';
// Resolve cards and normal interactive components, without letting nested buttons select their card.
const CONTROLS = 'button, a[href], input, textarea, select, [role="button"], [data-gesture-id]';
const targets = new Map<string, HTMLElement>();
const generated = new WeakMap<HTMLElement, string>();
let nextId = 0;
export type HitTarget = { id: string; element: HTMLElement; draggable: boolean; cardId: string | null };

function available(element: HTMLElement): boolean {
  return !element.closest('[inert], [data-gesture-ignore], [aria-disabled="true"]')
    && !(element as HTMLButtonElement).disabled;
}
export function targetAt(x: number, y: number): HitTarget | null {
  const point = document.elementFromPoint(x, y);
  if (!point || point.closest('[inert], [data-gesture-ignore]')) return null;
  const element = (point.closest(CONTROLS) ?? point.closest('[data-product-id], [data-gesture-draggable]')) as HTMLElement | null;
  if (!element || !available(element)) return null;
  const control = element.matches(CONTROLS);
  let id = element.dataset.gestureId ?? (!control ? element.dataset.productId : undefined);
  if (!id) {
    id = generated.get(element) ?? 'control:' + ++nextId;
    generated.set(element, id);
  }
  // Prune removed cards/controls instead of retaining DOM nodes indefinitely.
  for (const [key, target] of targets) if (!target.isConnected) targets.delete(key);
  targets.set(id, element);
  return { id, element, draggable: element.hasAttribute('data-gesture-draggable'),
    cardId: element.closest('[data-product-id]')?.getAttribute('data-product-id') ?? null };
}
export const hitTest = (x: number, y: number): string | null => targetAt(x, y)?.id ?? null;

/** Explicit opt-in: the host owns object data and applies expand/collapse/compare events. */
export function objectAt(x: number, y: number): ObjectTarget | null {
  const point = document.elementFromPoint(x, y);
  if (point?.closest('[inert], [data-gesture-ignore], [aria-disabled="true"]')) return null;
  const element = point?.closest<HTMLElement>('[data-gesture-object]');
  if (!point || !element || !available(element)) return null;
  const control = point.closest(CONTROLS);
  if (control && control !== element && element.contains(control)) return null;
  const kind = element.dataset.gestureKind;
  if (kind !== 'original' && kind !== 'component' && kind !== 'group') return null;
  const id = element.dataset.gestureObject;
  const groupId = element.dataset.gestureGroup;
  return id && groupId ? { id, groupId, kind } : null;
}

const scrollTargets = new Map<string, HTMLElement>();
const scrollIds = new WeakMap<HTMLElement, string>();
let nextScrollId = 0;

/** Capture the nearest scrolling surface once, so a moving cursor cannot switch panes. */
export function scrollTargetAt(x: number, y: number): string | null {
  let element = document.elementFromPoint(x, y) as HTMLElement | null;
  if (!element || element.closest('[inert], [data-gesture-ignore]')) return null;
  for (const [id, target] of scrollTargets) if (!target.isConnected) scrollTargets.delete(id);
  for (; element && element !== document.body && element !== document.documentElement; element = element.parentElement) {
    const overflow = getComputedStyle(element).overflowY;
    if (element.hasAttribute('data-gesture-scroll') || (['auto', 'scroll', 'overlay'].includes(overflow) && element.scrollHeight > element.clientHeight)) {
      const id = scrollIds.get(element) ?? `scroll:${++nextScrollId}`;
      scrollIds.set(element, id);
      scrollTargets.set(id, element);
      return id;
    }
    // A dialog owns its interaction, even when it has no scrollable content.
    if (element.matches('[role="dialog"], dialog')) return null;
  }
  return 'scroll:page';
}

export function scrollElement(id: string | null | undefined): HTMLElement | null {
  if (id === 'scroll:page') return (document.scrollingElement as HTMLElement | null) ?? null;
  return id ? scrollTargets.get(id) ?? null : null;
}

export function scrollTarget(id: string | null | undefined, delta: number) {
  const element = scrollElement(id);
  if (!element?.isConnected || !Number.isFinite(delta)) return;
  // The host steps these surfaces one box at a time instead of pixel-scrolling.
  if (element.hasAttribute('data-gesture-step')) return;
  // Immediate frame-sized updates avoid stacking smooth-scroll animations or leaking to the page at an edge.
  element.scrollBy({ top: delta * innerHeight, behavior: 'instant' });
}

export function dropTargetAt(x: number, y: number, draggedId?: string | null): string | null {
  const dragged = draggedId ? targets.get(draggedId) : undefined;
  const previous = dragged?.style.pointerEvents;
  if (dragged) dragged.style.pointerEvents = 'none';
  try {
    const element = document.elementFromPoint(x, y)?.closest('[data-drop-zone], [data-product-id]');
    return element?.getAttribute('data-drop-zone') ?? element?.getAttribute('data-product-id') ?? null;
  } finally {
    if (dragged) dragged.style.pointerEvents = previous ?? '';
  }
}
export function activateTarget(id: string): boolean {
  const element = targets.get(id);
  if (!element?.isConnected || !available(element) || !element.matches(CONTROLS)) return false;
  element.focus({ preventScroll: true });
  element.click();
  return true;
}
const pressOwners = new WeakMap<HTMLElement, Set<string>>();
export function markPressed(id: string | null | undefined, pressed: boolean, owner = 'default') {
  const element = id ? targets.get(id) : undefined;
  if (!element) return;
  const owners = pressOwners.get(element) ?? new Set<string>();
  if (pressed) owners.add(owner); else owners.delete(owner);
  pressOwners.set(element, owners);
  element.toggleAttribute('data-gesture-pressed', owners.size > 0);
}
