import { useState } from "react";
import { formatDate, money, quantityLabel } from "./format.js";

/**
 * OWNER: UI
 * STATUS: Basic layout. Replace this folder to implement the real interface.
 *
 * Props are the contract. HTTP stays in App.jsx and api.js.
 *   tabs, category, prompt, plan, status, error
 *   onSelectCategory(id), onPromptChange(text), onPlan(event), onToggle(item)
 *
 * plan.items[]: { id, name, quantity, unit, reason, purchased, products, synthesis }
 * synthesis: { summary, image, dimensions, shippingDate, totalPrice, currency, best, alternatives }
 * plan.quote: { toBuyCount, purchasedCount, totalPrice, currency, readyBy }
 */

export default function PlannerUI({
  tabs,
  category,
  prompt,
  plan,
  status,
  error,
  onSelectCategory,
  onPromptChange,
  onPlan,
  onToggle,
}) {
  const loading = status === "loading";

  return (
    <main className="app">
      <header className="top">
        <div>
          <p className="eyebrow">Planboard</p>
          <h1>What do you need to get ready?</h1>
          <p className="lede">
            A prompt becomes a checklist. Anything still unchecked is what to buy.
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
        <PlanBody plan={plan} onToggle={onToggle} />
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

function PlanBody({ plan, onToggle }) {
  const toBuy = plan.items.filter((item) => !item.purchased);

  return (
    <>
      <div className="plan-head">
        <h2>{plan.title}</h2>
        <p>{plan.prompt}</p>
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
                <ProductCard key={item.id} item={item} />
              ))}
            </ul>
          )}
          <Quote quote={plan.quote} />
        </section>
      </div>
    </>
  );
}

function ProductCard({ item }) {
  const offer = item.synthesis;
  const best = offer?.best;

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
    </li>
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
