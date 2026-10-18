import { useState } from "react";
import { money } from "./format.js";
import { LISTING_DRAG_TYPE, Thumb } from "./ShopBoard.jsx";

/** Floating cart. It is also where listings are dropped: pinch-drag by hand, or drag with the mouse. */
export function CartDock({ lines, total, currency, dragging, onOpen, onDropListing }) {
  const [over, setOver] = useState(false);
  const count = lines.length;
  return (
    <button
      type="button"
      className={`cart-dock${dragging || over ? " is-target" : ""}${count ? " has-items" : ""}`}
      data-drop-zone="cart"
      data-gesture-id="cart-dock"
      aria-label={`Cart, ${count} item${count === 1 ? "" : "s"}. Drop a listing here to add it.`}
      onClick={onOpen}
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes(LISTING_DRAG_TYPE)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => {
        setOver(false);
        const raw = event.dataTransfer.getData(LISTING_DRAG_TYPE);
        if (!raw) return;
        event.preventDefault();
        try {
          const { itemId, productId } = JSON.parse(raw);
          onDropListing(itemId, productId);
        } catch {
          /* not one of ours */
        }
      }}
    >
      <span className="cart-dock-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24"><path d="M4 5h2l2.2 10.2a1 1 0 0 0 1 .8h7.9a1 1 0 0 0 1-.8L20 8H7" /><circle cx="10" cy="19.5" r="1.3" /><circle cx="17" cy="19.5" r="1.3" /></svg>
        {count ? <b>{count}</b> : null}
      </span>
      <span className="cart-dock-copy">
        {dragging || over ? "Drop to add" : count ? money(total, currency) : "Cart"}
      </span>
    </button>
  );
}

export default function CartSheet({
  stage, lines, total, currency, checkout, receipt, busy, mode,
  onRemove, onCheckout, onPlace, onBack, onClose,
}) {
  return (
    <div className="cart-layer" role="dialog" aria-modal="true" aria-label="Cart and checkout">
      <section className="cart-sheet">
        <header className="cart-sheet-head">
          <div>
            <p className="shop-kicker">{stage === "receipt" ? "Order placed" : stage === "review" ? "Review order" : "Cart"}</p>
            <h3>
              {stage === "receipt" ? `Order ${receipt.orderId}` : stage === "review"
                ? `Pay ${money(checkout.amount / 100, checkout.currency.toUpperCase())}`
                : lines.length ? `${lines.length} item${lines.length === 1 ? "" : "s"} · ${money(total, currency)}` : "Your cart is empty"}
            </h3>
          </div>
          <button type="button" className="compare-close" onClick={onClose}>Close</button>
        </header>

        {stage === "receipt" ? <Receipt receipt={receipt} lines={lines} /> : (
          <>
            {stage === "review" ? <p className="mock-tag">Demo checkout · no real payment</p> : null}
            {lines.length ? (
              <ul className="cart-lines">
                {lines.map(({ item, plan }) => (
                  <li key={item.id}>
                    <Thumb image={item.synthesis?.best?.image || item.image} store={item.synthesis?.best?.store || item.name} />
                    <span className="cart-name">
                      {item.name}
                      <span className="reason">
                        {item.synthesis?.best?.store || "—"} · {plan.title}{item.synthesis?.isMock ? " · demo listing" : ""}
                      </span>
                    </span>
                    <strong>{money(item.synthesis.totalPrice, item.synthesis.currency || "USD")}</strong>
                    {stage === "cart" ? (
                      <button type="button" className="cart-remove" aria-label={`Remove ${item.name}`} onClick={() => onRemove(item.id)}>
                        Remove
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="quiet">Hold a listing for a second, drag it here, or tell ESPER “add it to my cart”.</p>
            )}
            {stage === "review" ? (
              <footer className="quote">
                <span>Demo card · Visa •••• 4242</span>
                <strong>{money(checkout.amount / 100, checkout.currency.toUpperCase())}</strong>
              </footer>
            ) : null}
            <div className="cart-actions">
              {stage === "review" ? (
                <>
                  <button type="button" className="ghost" disabled={busy} onClick={onBack}>Back to cart</button>
                  <button type="button" className="confirm" disabled={busy} onClick={onPlace}>
                    {busy ? "Placing order…" : "Place mock order"}
                  </button>
                </>
              ) : (
                <button type="button" className="confirm cart-pay" disabled={busy || !lines.length} onClick={onCheckout}>
                  {busy ? "Starting checkout…" : mode === "test" ? `Pay ${money(total, currency)} with Stripe` : `Check out ${money(total, currency)}`}
                </button>
              )}
            </div>
          </>
        )}
      </section>
    </div>
  );
}

const SANDBOX_STATUS = {
  accepted: (s) => `cart #${s.cartId}${s.rejected ? ` · ${s.rejected} not in their catalog` : ""}`,
  unreachable: (s) => `unreachable (${s.error}), recorded locally`,
  skipped: () => "skipped (MOCK_ORDER_SANDBOX=off)",
};

function Receipt({ receipt, lines }) {
  const name = (id) => lines.find(({ item }) => item.id === id)?.item.name || "item";
  return (
    <div className="receipt" role="status">
      <p className="mock-tag">Mock order · no card was charged</p>
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
            <span className="cart-name">
              {sandbox.label}
              <span className="reason">{sandbox.itemIds.map(name).join(", ")}</span>
            </span>
            <span>{SANDBOX_STATUS[sandbox.status](sandbox)}</span>
          </li>
        ))}
        {receipt.local.length ? (
          <li>
            <span className="cart-name">
              Recorded locally
              <span className="reason">{receipt.local.map(name).join(", ")}</span>
            </span>
            <span>no sandbox store</span>
          </li>
        ) : null}
      </ul>
      <p className="quiet">Those items are now green on your board.</p>
    </div>
  );
}
