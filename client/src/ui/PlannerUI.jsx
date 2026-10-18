import { useCallback, useEffect, useRef, useState } from "react";
import { formatDate, money, quantityLabel } from "./format.js";
import ElectronicsPlan from "./ElectronicsPlan.jsx";
import WeeklyList from "./WeeklyList.jsx";

export default function PlannerUI({
  tabs,
  category,
  prompt,
  plan,
  status,
  error,
  trustFloor,
  compare,
  selected,
  onSelectCategory,
  onPromptChange,
  onPlan,
  onToggle,
  onTrustFloor,
  onToggleListing,
  onConfirmPick,
}) {
  const loading = status === "loading";
  const [open, setOpen] = useState(false);
  const [drag, setDrag] = useState(null);
  const shownRef = useRef(0);
  const shellRef = useRef(null);
  const closers = useRef([]);
  const skipPop = useRef(0);
  const [layers, setLayers] = useState(0);
  const active = tabs.find((tab) => tab.id === category) || tabs[0];
  const shown = drag ?? (open ? 1 : 0);

  useEffect(() => {
    if (plan) setOpen(true);
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

  function choose(id) {
    if (id === category && open && drag == null) {
      requestBack();
      return;
    }
    onSelectCategory(id);
    setOpen(true);
  }

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
    <main ref={shellRef} className="shell" data-hue={open ? category : "home"}>
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
          A prompt becomes a checklist. Anything still unchecked is what to buy.
        </p>
        <form className="prompt" onSubmit={onPlan}>
          <label className="sr-only" htmlFor="plan-prompt">
            Plan prompt
          </label>
          <input
            id="plan-prompt"
            value={prompt}
            onChange={(event) => onPromptChange(event.target.value)}
            placeholder="I need to prepare for camping."
          />
          <button className="transition duration-200 ease-snap active:scale-[0.98]" type="submit" disabled={loading || !prompt.trim()}>
            {loading ? "Planning…" : "Build list"}
          </button>
        </form>
        <p className="home-hint">Pull the bar, or choose a widget.</p>
      </section>

      <Dock
        tabs={tabs}
        category={category}
        open={open}
        onChoose={choose}
        onPull={onPull}
        onToggle={() => setOpen((value) => !value)}
      />

      <section
        className={drag == null ? "sheet" : "sheet is-dragging"}
        style={{
          transform: `translateX(${(1 - shown) * 100}%)`,
          clipPath: `inset(0 0 ${(1 - shown) * 100}% 0)`,
        }}
        aria-hidden={shown < 0.05}
        inert={shown < 0.05}
        aria-label={active ? `${active.label} widget` : "Widget"}
      >
        <header className="sheet-bar">
          <span>{active?.label}</span>
          <button className="transition duration-200 ease-snap active:scale-[0.98]" type="button" onClick={requestBack}>
            {layers > 0 ? "Back" : "Close"}
          </button>
        </header>
        <div
          className={`sheet-body ${
            {
              groceries: "animate-sheet",
              wedding: "animate-bloom",
              camping: "animate-unroll",
              electronics: "animate-scan",
              custom: "animate-lift",
            }[category] || "animate-sheet"
          }`}
          key={category}
        >
          {error ? (
            <p className="banner" role="alert">
              {error}
            </p>
          ) : null}
          {category === "groceries" ? (
            <WeeklyList bindBack={bindBack} onBack={requestBack} />
          ) : null}
          {category === "electronics" ? (
            <ElectronicsPlan bindBack={bindBack} onBack={requestBack} />
          ) : null}
          {plan ? (
            <PlanBody plan={plan} onToggle={onToggle} />
          ) : category === "groceries" || category === "electronics" ? null : (
            <p className="empty">
              {loading
                ? "Looking up items and store offers…"
                : "Describe the occasion on the home screen, then build the list."}
            </p>
          )}
        </div>
      </section>
    </main>
  );
}

function Dock({ tabs, category, open, onChoose, onPull, onToggle }) {
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
    const dy = event.clientY - start.current.y;
    if (Math.abs(dx) > 6 || Math.abs(dy) > 6) start.current.moved = true;
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
    <nav className="dock" aria-label="Widgets">
      <button
        type="button"
        className="pull"
        aria-label={open ? "Pull to close the widget" : "Pull to open the widget"}
        onPointerDown={pointerDown}
        onPointerMove={pointerMove}
        onPointerUp={pointerUp}
        onPointerCancel={pointerUp}
      >
        <span className="pull-grip" />
      </button>
      <div className="dock-icons">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          className="dock-btn transition duration-200 ease-snap active:scale-95"
          aria-pressed={open && tab.id === category}
          title={tab.label}
          onClick={() => onChoose(tab.id)}
        >
          <WidgetIcon id={tab.id} />
          <span>{tab.label}</span>
        </button>
      ))}
      </div>
    </nav>
  );
}

function WidgetIcon({ id }) {
  const pen = {
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.6,
    strokeLinecap: "round",
    strokeLinejoin: "round",
  };
  if (id === "groceries") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path {...pen} d="M6 8h12l-1.2 11H7.2L6 8z" />
        <path {...pen} d="M9 8V6.5a3 3 0 0 1 6 0V8" />
      </svg>
    );
  }
  if (id === "wedding") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle {...pen} cx="8" cy="9" r="2.3" />
        <circle {...pen} cx="16" cy="9" r="2.3" />
        <path {...pen} d="M6.2 15c1.1-2 3.2-2 4.3 0M13.5 15c1.1-2 3.2-2 4.3 0" />
      </svg>
    );
  }
  if (id === "camping") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path {...pen} d="M4 18 12 5l8 13z" />
        <path {...pen} d="M12 18V11" />
      </svg>
    );
  }
  if (id === "electronics") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path {...pen} d="M8 4h8v4H8zM6 8h12v11H6z" />
        <path {...pen} d="M9 13h6M9 16h3" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path {...pen} d="m12 3 1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3z" />
    </svg>
  );
}

function PlanBody({ plan, onToggle }) {
  const toBuy = plan.items.filter((item) => !item.purchased);

  return (
    <>
      <div className="plan-head">
        <h2>{plan.title}</h2>
        <p>{plan.prompt}</p>
        <label className="trust-floor">
          Trust floor {Math.round((trustFloor ?? 0.5) * 100)}%
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={trustFloor ?? 0.5}
            onChange={(event) => onTrustFloor(Number(event.target.value))}
          />
        </label>
      </div>
      <div className="layout">
        <section className="panel" aria-label="Checklist">
          <h3>Checklist</h3>
          <ul className="checklist">
            {plan.items.map((item, index) => {
              const qty = quantityLabel(item);
              return (
                <li
                  key={item.id}
                  className={item.purchased ? "is-purchased animate-stretch-in transition duration-200" : "animate-stretch-in"}
                  style={{ animationDelay: `${index * 50}ms` }}
                >
                  <label>
                    <input
                      type="checkbox"
                      checked={item.purchased}
                      onChange={() => onToggle(item)}
                    />
                    <span>
                      <span className="name">
                        {item.name}
                        {qty ? <span className="qty">{qty}</span> : null}
                      </span>
                      <span className="reason">{item.reason}</span>
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        </section>

        <section className="panel" aria-label="Items to buy">
          <h3>To buy</h3>
          {toBuy.length === 0 ? (
            <p className="quiet">Nothing left to buy.</p>
          ) : (
            <ul className="cards">
              {toBuy.map((item) => (
                <ProductCard
                  key={item.id}
                  item={item}
                  picked={selected?.[item.id] || []}
                  onToggleListing={(product) => onToggleListing(item, product)}
                />
              ))}
            </ul>
          )}
          <Quote quote={plan.quote} />
        </section>
      </div>
      {compare ? <CompareSheet compare={compare} onConfirmPick={onConfirmPick} /> : null}
    </>
  );
}

function ProductCard({ item, picked, onToggleListing }) {
  const offer = item.synthesis;
  const best = offer?.best;
  const listings = (item.products || []).slice(0, 10);

  return (
    <li className="card animate-stretch-in transition duration-200">
      <Thumb image={offer?.image} store={best?.store} />
      <div>
        <p className="card-name">{item.name}</p>
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
          {best?.score != null || best?.scores ? (
            <div>
              <dt>Score</dt>
              <dd>
                {Math.round(((best.score ?? best.scores?.total) || 0) * 100)}
                {best.relevancy != null ? ` · rel ${Math.round(best.relevancy * 100)}` : ""}
              </dd>
            </div>
          ) : null}
        </dl>
        {listings.length ? (
          <ul className="alts">
            {listings.map((alt) => {
              const on = picked.includes(alt.id);
              return (
                <li key={alt.id}>
                  <button
                    type="button"
                    className={on ? "pick is-on" : "pick"}
                    onClick={() => onToggleListing(alt)}
                  >
                    {on ? "Selected" : "Compare"} · {alt.store} · {money(alt.price, alt.currency)}
                    {alt.score != null ? ` · ${Math.round(alt.score * 100)}` : ""}
                    {alt.inStock === false || alt.in_stock === false ? " · out" : ""}
                  </button>
                </li>
              );
            })}
          </ul>
        ) : null}
      </div>
    </li>
  );
}

function CompareSheet({ compare, onConfirmPick }) {
  const left = compare.left;
  const right = compare.right;
  return (
    <section className="panel compare-sheet" aria-label="Item comparison">
      <h3>
        {compare.pick === "left"
          ? `Pick ${left.title}`
          : compare.pick === "right"
            ? `Pick ${right.title}`
            : "Too close to call"}
      </h3>
      <p className="quiet">{compare.reasons?.[0]}</p>
      <div className="compare-grid">
        <ListingPeek side="A" item={left} winner={compare.pick === "left"} />
        <ListingPeek side="B" item={right} winner={compare.pick === "right"} />
      </div>
      <table className="axes">
        <thead>
          <tr>
            <th>Axis</th>
            <th>A</th>
            <th>B</th>
          </tr>
        </thead>
        <tbody>
          {(compare.axes || []).map((axis) => (
            <tr key={axis.name}>
              <td>{axis.name}</td>
              <td className={axis.winner === "left" ? "win" : ""}>{axis.left}</td>
              <td className={axis.winner === "right" ? "win" : ""}>{axis.right}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {compare.pick && onConfirmPick ? (
        <button type="button" className="confirm" onClick={() => onConfirmPick(compare.pick === "left" ? left : right)}>
          Use this listing
        </button>
      ) : null}
    </section>
  );
}

function ListingPeek({ side, item, winner }) {
  return (
    <div className={winner ? "peek is-win" : "peek"}>
      <p className="card-name">
        {side} · {item.store}
      </p>
      <p className="summary">{item.title}</p>
      <p className="summary">{money(item.price, item.currency)}</p>
    </div>
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
