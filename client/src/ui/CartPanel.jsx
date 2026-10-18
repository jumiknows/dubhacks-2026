import { useState } from "react";
import { money } from "./format.js";

/**
 * Cart for a plan: every unpurchased item with a price, all selected by default.
 * Self-contained so it can sit in any view that has a plan; it only needs
 * onCheckout(itemIds), which should resolve after the browser starts redirecting.
 */
export default function CartPanel({ items, onCheckout }) {
  // Track what was unticked, so items added or repriced later start selected.
  const [skipped, setSkipped] = useState(() => new Set());
  const [paying, setPaying] = useState(false);

  const open = items.filter((item) => !item.purchased);
  const payable = open.filter((item) => typeof item.synthesis?.totalPrice === "number" && item.synthesis.totalPrice > 0);
  const chosen = payable.filter((item) => !skipped.has(item.id));
  const total = Math.round(chosen.reduce((sum, item) => sum + item.synthesis.totalPrice, 0) * 100) / 100;
  const currency = chosen[0]?.synthesis.currency || "USD";

  function toggle(id) {
    setSkipped((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function pay() {
    setPaying(true);
    try {
      await onCheckout(chosen.map((item) => item.id));
    } finally {
      setPaying(false);
    }
  }

  return (
    <section className="panel cart" aria-label="Cart">
      <h3>Cart</h3>
      {open.length === 0 ? (
        <p className="quiet">Everything on this list is bought.</p>
      ) : (
        <ul className="cart-lines">
          {open.map((item) => {
            const price = item.synthesis?.totalPrice;
            const priced = payable.includes(item);
            return (
              <li key={item.id} className={priced ? "" : "is-unpriced"}>
                <label>
                  <input
                    type="checkbox"
                    checked={priced && !skipped.has(item.id)}
                    disabled={!priced || paying}
                    onChange={() => toggle(item.id)}
                  />
                  <span className="cart-name">
                    {item.name}
                    <span className="reason">{item.synthesis?.best?.store || "No listing yet"}</span>
                  </span>
                  <strong>{priced ? money(price, item.synthesis.currency) : "—"}</strong>
                </label>
              </li>
            );
          })}
        </ul>
      )}
      {payable.length ? (
        <footer className="quote">
          <span>
            {chosen.length} of {payable.length} selected
          </span>
          <strong>{money(total, currency)}</strong>
        </footer>
      ) : null}
      {payable.length ? (
        <button type="button" className="confirm cart-pay" disabled={!chosen.length || paying} onClick={pay}>
          {paying ? "Opening Stripe…" : `Pay ${money(total, currency)}`}
        </button>
      ) : null}
    </section>
  );
}
