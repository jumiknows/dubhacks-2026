import { Hints, useGestureStatus } from "conjure-gestures";
import { useEffect, useRef } from "react";
import ShopBoard from "./ShopBoard.jsx";

export default function PlannerUI({
  prompt,
  plans,
  marks,
  status,
  error,
  focusId,
  onPromptChange,
  onPlan,
  onToggle,
  onMark,
  onInspect,
}) {
  const loading = status === "loading";
  const shellRef = useRef(null);
  const latest = plans?.at(-1) || null;

  useEffect(() => {
    const root = shellRef.current;
    if (!root) return undefined;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) return undefined;
    function onDown(event) {
      if (event.button != null && event.button !== 0) return;
      const pulse = document.createElement("span");
      pulse.className = "click-pulse animate-click";
      pulse.style.left = `${event.clientX}px`;
      pulse.style.top = `${event.clientY}px`;
      root.appendChild(pulse);
      pulse.addEventListener("animationend", () => pulse.remove(), { once: true });
    }
    root.addEventListener("pointerdown", onDown);
    return () => root.removeEventListener("pointerdown", onDown);
  }, []);

  return (
    <main ref={shellRef} className="shell" data-hue={latest?.category || "home"}>
      <div className="glow" aria-hidden="true">
        <span className="glow-core" />
        <span className="glow-ring" />
        <span className="glow-ring" />
        <span className="glow-ring" />
        <span className="glow-ring" />
        <span className="glow-ring" />
      </div>
      <section className="home">
        <p className="eyebrow">Planboard</p>
        <h1>What do you need to get ready?</h1>
        <p className="lede">
          Describe what you are shopping for. The list is built from that prompt, not from a widget picker.
        </p>
        <form className="prompt" onSubmit={onPlan}>
          <label className="sr-only" htmlFor="plan-prompt">
            Plan prompt
          </label>
          <input
            id="plan-prompt"
            value={prompt}
            onChange={(event) => onPromptChange(event.target.value)}
            placeholder="Camping trip, weekly groceries, new laptop…"
          />
          <button className="transition duration-200 ease-snap active:scale-[0.98]" type="submit" disabled={loading || !prompt.trim()}>
            {loading ? "Planning…" : "Build list"}
          </button>
        </form>
        {error ? (
          <p className="banner" role="alert">
            {error}
          </p>
        ) : null}
        <ShopBoard
          plans={plans}
          marks={marks}
          focusId={focusId}
          onMark={onMark}
          onToggle={onToggle}
          onInspect={onInspect}
        />
        <HandToggle />
      </section>
      <p className="home-hint">Each query stays on the list. One finger scrolls. Both hands split a group. Hold a product two seconds to put it in the cart.</p>
      <Hints />
    </main>
  );
}

function HandToggle() {
  const { camera, start, stop } = useGestureStatus();
  const starting = camera === "starting";
  const on = camera === "on";
  return (
    <button
      type="button"
      className="hand-toggle transition duration-200 ease-snap active:scale-[0.98]"
      data-gesture-ignore
      disabled={starting}
      onClick={() => (on ? stop() : start())}
    >
      {on ? "Hands on" : starting ? "Starting camera…" : "Use hands"}
    </button>
  );
}
