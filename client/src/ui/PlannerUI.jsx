import { Hints, useGestureEvents, useGestureStatus } from "conjure-gestures";
import { useEffect, useRef, useState } from "react";
import CartSheet, { CartDock } from "./CartSheet.jsx";
import ChatRail from "./ChatRail.jsx";
import CompareSheet from "./CompareSheet.jsx";
import ShopBoard from "./ShopBoard.jsx";

export default function PlannerUI({
  prompt,
  plans,
  marks,
  status,
  error,
  notice,
  focusId,
  trustFloor,
  compare,
  cart,
  assistant,
  suggestions,
  onPromptChange,
  onPlan,
  onToggle,
  onMark,
  onInspect,
  onAddListing,
  onDropListing,
  onCompare,
  onTrustFloor,
  onChooseFromCompare,
  onCloseCompare,
  onDismissNotice,
}) {
  const loading = status === "loading";
  const shellRef = useRef(null);
  const latest = plans?.at(-1) || null;
  const [chatOpen, setChatOpen] = useState(() => window.matchMedia?.("(min-width: 900px)").matches ?? true);
  const drag = useListingDrag(onDropListing);

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
    <main ref={shellRef} className={`shell${chatOpen ? " has-rail" : ""}`} data-hue={latest?.category || "home"}>
      <div className="glow" aria-hidden="true">
        <span className="glow-core" />
        <span className="glow-ring" />
        <span className="glow-ring" />
        <span className="glow-ring" />
        <span className="glow-ring" />
        <span className="glow-ring" />
      </div>
      <section className="home">
        <p className="eyebrow">ESPER</p>
        <h1>What do you need to get ready?</h1>
        <p className="lede">
          Say it, type it, or pick it up with your hands. ESPER builds the list, compares the listings and keeps the cart.
        </p>
        <form className="prompt" onSubmit={onPlan}>
          <label className="sr-only" htmlFor="plan-prompt">
            Plan prompt
          </label>
          <input
            id="plan-prompt"
            value={prompt}
            onChange={(event) => onPromptChange(event.target.value)}
            placeholder="Camping this weekend, weekly groceries, a new laptop…"
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
        {notice ? (
          <p className="banner is-ok" role="status">
            {notice}
            <button type="button" className="banner-dismiss" onClick={onDismissNotice} aria-label="Dismiss">×</button>
          </p>
        ) : null}
        <ShopBoard
          plans={plans}
          marks={marks}
          focusId={focusId}
          onMark={onMark}
          onToggle={onToggle}
          onInspect={onInspect}
          onAddListing={onAddListing}
          onCompare={onCompare}
        />
        <HandToggle />
      </section>
      <p className="home-hint">
        Pull a group apart with two fists. Open an item, then hold a listing for a second to buy it, pinch two listings
        together to compare, or drag one onto the cart.
      </p>

      <CartDock
        lines={cart.lines}
        total={cart.total}
        currency={cart.currency}
        dragging={Boolean(drag.ghost)}
        onOpen={cart.open}
        onDropListing={onDropListing}
      />
      {drag.ghost ? (
        <div className="drag-ghost" style={{ left: `${drag.ghost.x * 100}vw`, top: `${drag.ghost.y * 100}vh` }} aria-hidden="true">
          {drag.ghost.label}
        </div>
      ) : null}

      <ChatRail open={chatOpen} assistant={assistant} suggestions={suggestions} onToggle={() => setChatOpen((v) => !v)} />

      {compare ? (
        <CompareSheet
          compare={compare}
          trustFloor={trustFloor}
          onTrustFloor={onTrustFloor}
          onChoose={onChooseFromCompare}
          onClose={onCloseCompare}
        />
      ) : null}
      {cart.sheet ? <CartSheet {...cart.sheet} /> : null}
      <Hints />
    </main>
  );
}

/** Pinch-drag a listing card: a ghost follows the hand, and dropping it on the cart adds it. */
function useListingDrag(onDropListing) {
  const [ghost, setGhost] = useState(null);
  const parse = (id) => {
    const match = /^product:([^:]+):(.+)$/.exec(id || "");
    return match ? { itemId: match[1], productId: match[2] } : null;
  };
  useGestureEvents("drag_start", (event) => {
    const listing = parse(event.target_id);
    if (!listing) return;
    const card = document.querySelector(`[data-gesture-id="${CSS.escape(event.target_id)}"] .shop-piece-name`);
    setGhost({ ...listing, x: event.x, y: event.y, label: card?.textContent || "Listing" });
  });
  useGestureEvents("drag_move", (event) => {
    setGhost((current) => (current ? { ...current, x: event.x, y: event.y } : current));
  });
  useGestureEvents("drop", (event) => {
    const listing = parse(event.target_id);
    setGhost(null);
    if (listing && event.drop_target_id === "cart") onDropListing(listing.itemId, listing.productId);
  });
  useGestureEvents("cancel", () => setGhost(null));
  return { ghost };
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
