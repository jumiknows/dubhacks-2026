import { useRef, useState } from "react";
import { post } from "./transport.js";
import { money } from "../ui/format.js";

const BASE = "/api/conjure";
async function sign(key, payload) {
  const bytes = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(payload)));
  return btoa(String.fromCharCode(...bytes));
}

export default function SignedCheckout({ getSession, products, staged, onStage }) {
  const key = useRef(null);
  const [budget, setBudget] = useState("50");
  const [quantity, setQuantity] = useState("1");
  const [categories, setCategories] = useState("");
  const [rules, setRules] = useState(null);
  const [selected, setSelected] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [authorization, setAuthorization] = useState(null);
  async function register(event) {
    event.preventDefault(); setBusy(true); setError(""); setAuthorization(null);
    try {
      const sessionId = await getSession();
      const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
      const { kty, crv, x, y } = await crypto.subtle.exportKey("jwk", pair.publicKey);
      const intent = { session_id: sessionId, budget_max: Number(budget), categories: categories.split(",").map((text) => text.trim()).filter(Boolean), verified_only: true, max_quantity: Number(quantity), autonomy: "stage", issued_at: new Date().toISOString(), nonce: crypto.randomUUID() };
      const payload = JSON.stringify(intent);
      await post(`${BASE}/mandate/intent`, { session_id: sessionId, public_key_jwk: { kty, crv, x, y }, payload, signature: await sign(pair.privateKey, payload) });
      key.current = pair.privateKey; setRules(intent); onStage(null);
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  async function stage() {
    const id = selected || products[0]?.id; if (!id) return;
    setBusy(true); setError(""); setAuthorization(null);
    try { onStage(await post(`${BASE}/checkout/stage`, { session_id: await getSession(), product_id: id, quantity: 1 })); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  async function authorize() {
    if (!key.current || !staged?.cart_payload) return;
    setBusy(true); setError("");
    try {
      const signature = await sign(key.current, staged.cart_payload);
      setAuthorization(await post(`${BASE}/checkout/intent`, { session_id: await getSession(), cart_hash: staged.cart.cart_hash, signature }));
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  return <details className="esper-signing" open={Boolean(staged)}><summary>Signed shopping rules & demo cart</summary>
    <p className="esper-note">The assistant can propose a demo cart within rules you sign. Only your separate cart signature authorizes the simulation. No real payment or store order is placed here.</p>
    <form className="esper-stack" onSubmit={register}>
      <label>Maximum demo budget (USD)<input type="number" min="0.01" max="10000" step="0.01" value={budget} onChange={(event) => setBudget(event.target.value)} required /></label>
      <label>Maximum quantity per product<input type="number" min="1" max="10" step="1" value={quantity} onChange={(event) => setQuantity(event.target.value)} required /></label>
      <label>Allowed categories (comma separated; blank allows any)<input value={categories} maxLength={300} onChange={(event) => setCategories(event.target.value)} placeholder="moisturizer, cleanser" /></label>
      <p className="esper-note">Verified merchants only. The assistant may stage a cart and must ask you to sign before simulated authorization. Your private key stays in this page’s memory.</p>
      <button disabled={busy}>{busy ? "Working…" : "Sign these shopping rules"}</button>
    </form>
    {rules ? <p className="esper-notice">Active signed rules: up to {money(rules.budget_max)}, {rules.max_quantity} per product, {rules.categories.join(", ") || "any category"}, verified merchants only.</p> : null}
    {products.length ? <div className="esper-inline esper-wrap"><label className="sr-only" htmlFor="stage-product">Demo product to stage</label><select id="stage-product" value={selected || products[0].id} onChange={(event) => setSelected(event.target.value)}>{products.map((product) => <option key={product.id} value={product.id}>{product.title}</option>)}</select><button type="button" disabled={busy} onClick={stage}>Propose demo cart</button></div> : null}
    {staged ? <section className="esper-assessment" aria-label="Signed demo cart"><h3>{staged.policy?.allowed ? "Review proposed demo cart" : "Cart held by policy"}</h3>{staged.cart ? <><ul>{staged.cart.items?.map((item) => <li key={item.product_id}>{item.quantity} × {item.title} · {money(item.unit_price)}</li>)}</ul><p><strong>{money(staged.cart.total, staged.cart.currency?.toUpperCase())}</strong></p></> : null}<ul>{staged.policy?.checks?.map((check) => <li key={check.rule}>{check.passed ? "Passed" : "Held"}: {check.reason}</li>)}</ul>{staged.policy?.allowed ? <><button type="button" disabled={busy || !key.current || Boolean(authorization)} onClick={authorize}>{authorization ? "Demo cart authorized" : "Sign demo cart"}</button>{!key.current ? <p className="esper-note">Sign shopping rules above, then propose a new cart to authorize with this browser’s key.</p> : null}</> : null}</section> : null}
    {authorization ? <p className="esper-notice" role="status">Simulated authorization for {money(authorization.amount / 100, authorization.currency?.toUpperCase())}. No charge or store order was made.</p> : null}
    {error ? <p className="banner" role="alert">{error}</p> : null}
  </details>;
}
