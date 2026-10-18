import { useState } from "react";
import { formatDate, money, quantityLabel } from "./format.js";

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

  return (
    <main className="app">
      <header className="top">
        <div>
          <p className="eyebrow">Planboard</p>
          <h1>What do you need to get ready?</h1>
          <p className="lede">
            Search ~50 listings per store, score bang-per-buck × relevancy × trust, then compare the top ten.
          </p>
        </div>
      </header>

      <div className="tabs" role="tablist" aria-label="Plan type">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={tab.id === category}
            onClick={() => onSelectCategory(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

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
        <button type="submit" disabled={loading || !prompt.trim()}>
          {loading ? "Planning…" : "Build list"}
        </button>
      </form>

      {error ? (
        <p className="banner" role="alert">
          {error}
        </p>
      ) : null}

      {plan ? (
        <PlanBody
          plan={plan}
          trustFloor={trustFloor}
          compare={compare}
          selected={selected}
          onToggle={onToggle}
          onTrustFloor={onTrustFloor}
          onToggleListing={onToggleListing}
          onConfirmPick={onConfirmPick}
        />
      ) : (
        <p className="empty">
          {loading
            ? "Looking up items and store offers…"
            : "Pick a tab or describe the occasion, then build the list."}
        </p>
      )}
    </main>
  );
}

function PlanBody({
  plan,
  onToggle,
  trustFloor,
  compare,
  selected,
  onTrustFloor,
  onToggleListing,
  onConfirmPick,
}) {
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
            {plan.items.map((item) => {
              const qty = quantityLabel(item);
              return (
                <li key={item.id} className={item.purchased ? "is-purchased" : ""}>
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
    <li className="card">
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
