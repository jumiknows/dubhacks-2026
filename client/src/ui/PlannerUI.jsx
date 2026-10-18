import { Hints, useGestureEvents, useGestureStatus } from "conjure-gestures";
import { useCallback, useEffect, useRef, useState } from "react";
import { formatDate, money, quantityLabel } from "./format.js";
import ItemHistory from "./ItemHistory.jsx";
import SnapStage from "./SnapStage.jsx";
import { takeSwipe } from "./swipeGate.js";

export default function PlannerUI({
  prompt,
  plan,
  status,
  error,
  onPromptChange,
  onPlan,
  onToggle,
}) {
  const loading = status === "loading";
  const [open, setOpen] = useState(false);
  const [drag, setDrag] = useState(null);
  const shownRef = useRef(0);
  const shellRef = useRef(null);
  const closers = useRef([]);
  const skipPop = useRef(0);
  const [layers, setLayers] = useState(0);
  const [selectedId, setSelectedId] = useState(null);
  const shown = drag ?? (open ? 1 : 0);

  useEffect(() => {
    if (plan) setOpen(true);
    setSelectedId(null);
  }, [plan]);

  const bindBack = useCallback((close) => {
    closers.current.push(close);
    setLayers(closers.current.length);
    history.pushState({ pb: "layer" }, "");
    return () => {
      const index = closers.current.lastIndexOf(close);
      if (index < 0) return;
      closers.current.splice(index, 1);
      setLayers(closers.current.length);
      if (history.state?.pb === "layer") {
        skipPop.current += 1;
        history.back();
      }
    };
  }, []);

  function requestBack() {
    if (closers.current.length) {
      history.back();
      return;
    }
    if (history.state?.pb === "widget") history.back();
    else setOpen(false);
  }

  useEffect(() => {
    function onKey(event) {
      if (event.key === "Escape" || event.key === "BrowserBack") requestBack();
    }
    function onPop() {
      if (skipPop.current) {
        skipPop.current -= 1;
        return;
      }
      const close = closers.current.pop();
      setLayers(closers.current.length);
      if (close) close();
      else setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("popstate", onPop);
    };
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    if (history.state?.pb === "widget" || history.state?.pb === "layer") return undefined;
    history.pushState({ pb: "widget" }, "");
    return undefined;
  }, [open]);

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

  useGestureEvents("reveal", () => {
    if (open || !takeSwipe()) return;
    setOpen(true);
  });

  useGestureEvents("dismiss", () => {
    if (!open) return;
    if (closers.current.length) return;
    if (!takeSwipe()) return;
    setOpen(false);
  });

  function onPull(value) {
    if (value == null) {
      setOpen(shownRef.current > 0.4);
      setDrag(null);
      return;
    }
    shownRef.current = value;
    setDrag(value);
  }

  return (
    <main ref={shellRef} className="shell" data-hue={open ? plan?.category || "custom" : "home"}>
      <div className="glow" aria-hidden="true">
        <span className="glow-core" />
        <span className="glow-ring" />
        <span className="glow-ring" />
        <span className="glow-ring" />
        <span className="glow-ring" />
        <span className="glow-ring" />
      </div>
      <section className={shown > 0.05 ? "home is-dim" : "home"}>
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
        <p className="home-hint">Fist to select. Pinch, then swipe left, right, up, or down — one item at a time.</p>
        <HandToggle />
      </section>
      <Hints />

      <EdgePull open={open} onPull={onPull} onToggle={() => setOpen((value) => !value)} />

      <section
        className={drag == null ? "sheet" : "sheet is-dragging"}
        style={{
          transform: `translateX(${(1 - shown) * 100}%)`,
          clipPath: `inset(0 0 ${(1 - shown) * 100}% 0)`,
        }}
        aria-hidden={shown < 0.05}
        inert={shown < 0.05}
        aria-label={plan?.title || "Shopping list"}
      >
        <header className="sheet-bar">
          <span>{plan?.title || "List"}</span>
          <button className="transition duration-200 ease-snap active:scale-[0.98]" type="button" onClick={requestBack}>
            {layers > 0 ? "Back" : "Close"}
          </button>
        </header>
        <div className="sheet-body animate-sheet" key={plan?.id || "empty"}>
          {error ? (
            <p className="banner" role="alert">
              {error}
            </p>
          ) : null}
          <div className="sheet-stage">
            <ItemHistory plan={plan} selectedId={selectedId} onSelect={setSelectedId} />
            {plan ? (
              <PlanBody
                plan={plan}
                onToggle={onToggle}
                bindBack={bindBack}
                onBack={requestBack}
                selectedId={selectedId}
                onSelect={setSelectedId}
              />
            ) : (
              <p className="empty">
                {loading
                  ? "Looking up items and store offers…"
                  : "Type a prompt on the home screen, then build the list."}
              </p>
            )}
          </div>
        </div>
      </section>
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

function EdgePull({ open, onPull, onToggle }) {
  const start = useRef(null);

  function pointerDown(event) {
    start.current = {
      x: event.clientX,
      y: event.clientY,
      open,
      moved: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function pointerMove(event) {
    if (!start.current) return;
    const dx = start.current.x - event.clientX;
    if (Math.abs(dx) > 6 || Math.abs(event.clientY - start.current.y) > 6) start.current.moved = true;
    if (!start.current.moved) return;
    const travel = 140;
    const progress = start.current.open
      ? Math.min(1, Math.max(0, 1 - (event.clientX - start.current.x) / travel))
      : Math.min(1, Math.max(0, dx / travel));
    onPull(progress);
  }

  function pointerUp() {
    if (!start.current) return;
    const moved = start.current.moved;
    start.current = null;
    if (!moved) onToggle();
    else onPull(null);
  }

  return (
    <nav className={open ? "dock is-out" : "dock"} aria-label="Shopping list">
      <button
        type="button"
        className="pull"
        aria-label={open ? "Pull to close the list" : "Pull to open the list"}
        onPointerDown={pointerDown}
        onPointerMove={pointerMove}
        onPointerUp={pointerUp}
        onPointerCancel={pointerUp}
      >
        <span className="pull-grip" />
      </button>
    </nav>
  );
}

function PlanBody({ plan, onToggle, bindBack, onBack, selectedId, onSelect }) {
  useEffect(() => {
    if (!selectedId || !bindBack) return undefined;
    return bindBack(() => onSelect(null));
  }, [selectedId, bindBack, onSelect]);

  return (
    <section className="week" aria-label="Shopping list">
      <div className="plan-head">
        <h2>{plan.title}</h2>
        <p>{plan.prompt}</p>
      </div>
      <SnapStage
        items={plan.items}
        getId={(item) => item.id}
        selectedId={selectedId}
        onSelect={onSelect}
        onBack={onBack}
        renderCard={(item, { selected, onChoose }) => (
          <ShopCard item={item} selected={selected} onChoose={onChoose} />
        )}
        renderDetail={(item) => (
          <ShopDetail item={item} onToggle={onToggle} />
        )}
      />
      <Quote quote={plan.quote} />
    </section>
  );
}

function ShopCard({ item, selected, onChoose }) {
  const qty = quantityLabel(item);
  const price = item.synthesis?.totalPrice;
  return (
    <article className={selected ? "meal is-open" : "meal"}>
      <button
        type="button"
        className="meal-hit transition duration-200 ease-snap active:scale-[0.98]"
        aria-pressed={selected}
        onClick={onChoose}
      >
        <p className="meal-day">{item.purchased ? "Got it" : "To buy"}</p>
        <p className="meal-name">{item.name}</p>
        <p className="meal-meta">
          <span>{qty || item.reason}</span>
          <span>{price != null ? money(price, item.synthesis?.currency) : "Shop"}</span>
        </p>
      </button>
    </article>
  );
}

function ShopDetail({ item, onToggle }) {
  const offer = item.synthesis;
  const best = offer?.best;
  const qty = quantityLabel(item);

  return (
    <>
      <p className="modal-kicker">{item.purchased ? "Already have it" : "Shopping"}</p>
      <h3 className="detail-title">{item.name}</h3>
      <p className="summary">{item.reason}{qty ? ` · ${qty}` : ""}</p>
      <label className="item-row">
        <input type="checkbox" checked={item.purchased} onChange={() => onToggle(item)} />
        <span>{item.purchased ? "Purchased" : "Mark purchased"}</span>
      </label>
      <div className="card animate-stretch-in transition duration-200">
        <Thumb image={offer?.image} store={best?.store} />
        <div>
          <p className="card-name">{best?.store || "Store listing"}</p>
          <p className="summary">
            {best?.url ? (
              <a href={best.url} target="_blank" rel="noreferrer">
                {offer.summary}
              </a>
            ) : (
              offer?.summary || "Waiting on a product listing."
            )}
          </p>
          <dl className="facts">
            <div>
              <dt>Price</dt>
              <dd>{money(offer?.totalPrice, offer?.currency)}</dd>
            </div>
            <div>
              <dt>Dimensions</dt>
              <dd>{offer?.dimensions?.label || "—"}</dd>
            </div>
            <div>
              <dt>Ships</dt>
              <dd>{formatDate(offer?.shippingDate)}</dd>
            </div>
          </dl>
          {offer?.alternatives?.length ? (
            <ul className="alts">
              {offer.alternatives.map((alt) => (
                <li key={alt.id}>
                  {alt.store} · {money(alt.price, alt.currency)}
                  {alt.inStock ? "" : " · out of stock"}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>
    </>
  );
}

function Thumb({ image, store }) {
  const [failed, setFailed] = useState(false);
  if (!image || failed) {
    return (
      <div className="thumb" aria-hidden="true">
        {store ? store.slice(0, 2).toUpperCase() : "—"}
      </div>
    );
  }
  return <img className="thumb" src={image} alt="" onError={() => setFailed(true)} />;
}

function Quote({ quote }) {
  if (!quote) return null;
  return (
    <footer className="quote">
      <span>
        {quote.toBuyCount} to buy
        {quote.readyBy ? ` · ready ${formatDate(quote.readyBy)}` : ""}
      </span>
      <strong>{money(quote.totalPrice, quote.currency)}</strong>
    </footer>
  );
}
