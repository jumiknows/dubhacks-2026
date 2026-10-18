import { useState } from "react";
import { money } from "../ui/format.js";
import { MockCheckoutSheet, Receipt } from "../ui/MockCheckout.jsx";

export default function IntegratedCart({ plans, marks, onRemove, onCheckout, checkout, receipt, onPlaceOrder, onCancelOrder, onDismissReceipt }) {
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState("");
  const groups = plans.map((plan) => ({ ...plan, items: plan.items.filter((item) => marks[item.id] === "cart" && !item.purchased && !item.owned) })).filter((plan) => plan.items.length);
  const items = plans.flatMap((plan) => plan.items);
  async function pay(plan) {
    setPaying(true); setError("");
    try { await onCheckout(plan.id, plan.items.map((item) => item.id)); }
    catch (err) { setError(err.message); }
    finally { setPaying(false); }
  }
  return <aside className="esper-cart" aria-label="Shopping cart">
    <header className="esper-section-head"><h2>Your cart</h2><span>{groups.reduce((count, plan) => count + plan.items.length, 0)} items</span></header>
    <p className="esper-note">Add an offer from a list to save its store and price. Orders are reviewed before payment. Merchandise subtotals exclude unknown shipping and tax.</p>
    {error ? <p className="banner" role="alert">{error}</p> : null}
    {receipt ? <Receipt receipt={receipt} items={items} onDismiss={onDismissReceipt} /> : null}
    {checkout ? <MockCheckoutSheet checkout={checkout} items={items} onPlace={onPlaceOrder} onCancel={onCancelOrder} /> : <>
      {groups.map((plan) => {
        const currencies = new Set(plan.items.map((item) => item.synthesis?.currency));
        const currency = currencies.size === 1 ? [...currencies][0] : null;
        const priced = currency && plan.items.every((item) => Number.isFinite(item.synthesis?.totalPrice) && item.synthesis.totalPrice > 0);
        const total = priced ? plan.items.reduce((sum, item) => sum + item.synthesis.totalPrice, 0) : null;
        return <section className="esper-cart-group" key={plan.id}><h3>{plan.title}</h3><ul>{plan.items.map((item) => <li key={item.id}><div><strong>{item.name}</strong><span className="esper-note">{item.synthesis?.best?.store} · {money(item.synthesis?.totalPrice, item.synthesis?.currency)}</span></div><button type="button" className="esper-quiet-button" onClick={() => onRemove(item.id)} aria-label={`Remove ${item.name} from cart`}>Remove</button></li>)}</ul><button type="button" disabled={paying || !priced} onClick={() => pay(plan)}>{paying ? "Opening checkout…" : priced ? `Review checkout · ${money(total, currency)}` : "Prices or currency need review"}</button></section>;
      })}
      {!groups.length ? <p className="esper-empty">Your cart is ready when you are. Open a list, choose an item, then add a store offer.</p> : null}
    </>}
  </aside>;
}
