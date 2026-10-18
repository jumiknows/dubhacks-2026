import { useState } from "react";
import { money } from "./format.js";

/**
 * Stand-in for Stripe's hosted page when the server has no Stripe key.
 * Nothing is typed and nothing is charged: the demo card is display-only.
 */
export function MockCheckoutSheet({ checkout, items, onPlace, onCancel }) {
  const [placing, setPlacing] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const lines = items.filter((item) => checkout.itemIds.includes(item.id));
  const currency = checkout.currency.toUpperCase();

  async function place() {
    setPlacing(true);
    try {
      await onPlace();
    } finally {
      setPlacing(false);
    }
  }

  async function cancel() { setCancelling(true); try { await onCancel(); } finally { setCancelling(false); } }

  return (
    <section className="panel cart mock-checkout" aria-label="Mock checkout">
      <p className="mock-tag">Demo checkout · no real payment</p>
      <h3>Review order</h3>
      <ul className="cart-lines">
        {lines.map((item) => (
          <li key={item.id}>
            <div className="cart-row">
              <span className="cart-name">
                {item.name}
                <span className="reason">{item.synthesis?.best?.store || "—"}</span>
              </span>
              <strong>{money(item.synthesis?.totalPrice, currency)}</strong>
            </div>
          </li>
        ))}
      </ul>
      <footer className="quote">
        <span>Demo card · Visa •••• 4242</span>
        <strong>{money(checkout.amount / 100, currency)}</strong>
      </footer>
      <div className="mock-actions">
        <button type="button" className="ghost" onClick={cancel} disabled={placing || cancelling}>
          {cancelling ? "Cancelling…" : "Back to cart"}
        </button>
        <button type="button" className="confirm" onClick={place} disabled={placing || cancelling}>
          {placing ? "Placing order…" : "Place mock order"}
        </button>
      </div>
    </section>
  );
}

const SANDBOX_STATUS = {
  accepted: (s) => `cart #${s.cartId}${s.rejected ? ` · ${s.rejected} not in their catalog` : ""}`,
  unreachable: (s) => `unreachable (${s.error}), recorded locally`,
  skipped: () => "skipped (MOCK_ORDER_SANDBOX=off)",
};

export function Receipt({ receipt, items, onDismiss }) {
  const name = (id) => items.find((item) => item.id === id)?.name || id;
  return (
    <section className="panel cart receipt" aria-label="Order receipt" role="status">
      <p className="mock-tag">Mock order · no card was charged</p>
      <h3>Order {receipt.orderId}</h3>
      <dl className="facts">
        <div>
          <dt>Total</dt>
          <dd>{money(receipt.amount / 100, receipt.currency.toUpperCase())}</dd>
        </div>
        <div>
          <dt>Card</dt>
          <dd>Visa •••• {receipt.card.last4}</dd>
        </div>
        <div>
          <dt>Placed</dt>
          <dd>{new Date(receipt.placedAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}</dd>
        </div>
      </dl>
      <ul className="cart-lines">
        {receipt.sandboxes.map((sandbox) => (
          <li key={sandbox.provider}>
            <div className="cart-row">
              <span className="cart-name">
                {sandbox.label}
                <span className="reason">{sandbox.itemIds.map(name).join(", ")}</span>
              </span>
              <span>{SANDBOX_STATUS[sandbox.status](sandbox)}</span>
            </div>
          </li>
        ))}
        {receipt.local.length ? (
          <li>
            <div className="cart-row">
              <span className="cart-name">
                Recorded locally
                <span className="reason">{receipt.local.map(name).join(", ")}</span>
              </span>
              <span>no sandbox store</span>
            </div>
          </li>
        ) : null}
      </ul>
      <button type="button" className="ghost" onClick={onDismiss}>
        Done
      </button>
    </section>
  );
}
