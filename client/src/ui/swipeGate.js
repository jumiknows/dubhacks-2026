const GAP_MS = 500;
let readyAt = 0;

/** One swipe action per half second. Call only when this handler is about to act. */
export function takeSwipe() {
  const now = performance.now();
  if (now < readyAt) return false;
  readyAt = now + GAP_MS;
  return true;
}
