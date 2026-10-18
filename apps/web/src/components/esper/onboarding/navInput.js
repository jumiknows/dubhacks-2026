import { useEffect, useRef } from "react";

/**
 * One input vocabulary for onboarding, so keys, taps and hand gestures all
 * drive the same screens:
 *   up / down   move between choices        (swipe up / down)
 *   select      choose the highlighted one  (close the fist, open to confirm)
 *   next        continue                    (swipe left)
 *   back        previous step               (swipe right)
 *
 * Gestures arrive as a window event, so this file does not depend on the
 * gesture branch. When it lands, forward its bus once:
 *   gestureBus.on("*", (e) => { const action = navFromGesture(e); if (action) sendNav(action, "hand"); });
 */
export const NAV_EVENT = "conjure:nav";

export function sendNav(action, source = "pointer") {
  window.dispatchEvent(new CustomEvent(NAV_EVENT, { detail: { action, source } }));
}

/** Map a conjure-gestures event to a nav action (see gesture_plan.md). */
export function navFromGesture(event) {
  if (event.type === "scroll") return event.delta_y > 0 ? "down" : event.delta_y < 0 ? "up" : null;
  if (event.type === "pointer_up") return "select";
  if (event.type === "reveal") return "next";
  if (event.type === "dismiss") return "back";
  return null;
}

const KEYS = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowRight: "next",
  ArrowLeft: "back",
  Enter: "select",
  " ": "select",
};

/** Call handler(action, source) for keys and forwarded gestures while mounted. */
export function useNav(handler) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    const onKey = (event) => {
      const action = KEYS[event.key];
      if (!action || event.altKey || event.metaKey || event.ctrlKey) return;
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      // Let Enter and Space press a focused link or button normally; it has its own handler.
      const control = event.target instanceof Element ? event.target.closest("a, button") : null;
      if (action === "select" && control && !control.hasAttribute("data-nav-option")) return;
      event.preventDefault();
      ref.current(action, "key");
    };
    const onNav = (event) => ref.current(event.detail.action, event.detail.source);
    window.addEventListener("keydown", onKey);
    window.addEventListener(NAV_EVENT, onNav);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(NAV_EVENT, onNav);
    };
  }, []);
}
