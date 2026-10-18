import { useEffect, useRef, useState } from "react";
import { post, request, streamEvents } from "./transport.js";
import { money } from "../ui/format.js";
import SignedCheckout from "./SignedCheckout.jsx";

const BASE = "/api/conjure";

export default function AssistantPanel({ onPlanProduct }) {
  const [sessionId, setSessionId] = useState(null);
  const sessionRequest = useRef(null);
  const controller = useRef(null);
  const [text, setText] = useState("");
  const [messages, setMessages] = useState([]);
  const [products, setProducts] = useState([]);
  const [traces, setTraces] = useState([]);
  const [trust, setTrust] = useState(null);
  const [comparison, setComparison] = useState(null);
  const [profile, setProfile] = useState(null);
  const [audit, setAudit] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [source, setSource] = useState(null);
  const [staged, setStaged] = useState(null);
  const requestVersion = useRef(0);
  useEffect(() => () => controller.current?.abort(), []);
  async function session() {
    if (sessionId) return sessionId;
    if (!sessionRequest.current) sessionRequest.current = post(`${BASE}/session`).then((body) => { setSessionId(body.session_id); return body.session_id; }).finally(() => { sessionRequest.current = null; });
    return sessionRequest.current;
  }
  async function showProducts(ids) {
    const version = ++requestVersion.current;
    const results = await Promise.all(ids.map((id) => request(`${BASE}/products/${encodeURIComponent(id)}`)));
    if (requestVersion.current === version) setProducts(results);
  }
  async function action(data) {
    if (["show_results", "rerank"].includes(data.action)) return showProducts(data.product_ids || []);
    if (["highlight_trust", "open_detail"].includes(data.action)) { setTrust(await request(`${BASE}/trust/${encodeURIComponent(data.product_id)}`)); }
    if (data.action === "open_compare") setComparison(data);
    if (data.action === "stage_checkout" || data.action === "policy_refusal") setStaged(data);
    if (data.action === "update_profile") setProfile(data.profile);
    if (data.action === "policy_refusal") setError(data.policy?.checks?.filter((check) => !check.passed).map((check) => check.reason).join(" ") || "This request did not pass the assistant's policy checks.");
  }
  async function send(event) {
    event.preventDefault();
    const prompt = text.trim(); if (!prompt || busy) return;
    setBusy(true); setError(""); setSource(null); setTraces([]); setText("");
    const turnId = crypto.randomUUID();
    setMessages((current) => [...current, { role: "you", text: prompt }, { role: "assistant", text: "", id: turnId }]);
    controller.current = new AbortController();
    const pending = [];
    try {
      const id = await session();
      await streamEvents(`${BASE}/chat`, { session_id: id, text: prompt, ui_context: { visible_ids: products.map((product) => product.id), focused_id: trust?.product_id || null } }, (kind, data) => {
        if (kind === "say") setMessages((current) => current.map((message) => message.id === turnId ? { ...message, text: `${message.text}${message.text ? " " : ""}${data.text || ""}` } : message));
        if (kind === "action") pending.push(action(data).catch((err) => setError(err.message)));
        if (kind === "trace") setTraces((current) => [...current, data]);
        if (kind === "error") setError(data.message || "The assistant could not finish this turn.");
        if (kind === "done") setSource(data);
      }, { signal: controller.current.signal });
      await Promise.all(pending);
    } catch (err) { if (err.name !== "AbortError") setError(err.message); }
    finally { setBusy(false); }
  }
  async function feedback(productId, signal) {
    try { const id = await session(); const body = await post(`${BASE}/feedback`, { session_id: id, product_id: productId, signal }); await Promise.all((body.actions || []).map(action)); }
    catch (err) { setError(err.message); }
  }
  async function details(kind) {
    try { const id = await session(); const value = await request(`${BASE}/${kind}/${id}`); if (kind === "audit") setAudit(value); else setProfile(value); }
    catch (err) { setError(err.message); }
  }
  return <section className="esper-assistant" aria-label="Shopping assistant">
    <header className="esper-section-head"><h2>Ask ESPER</h2><span className="esper-tag">AI assistant</span></header>
    <p className="esper-note">Explore the assistant's fictional skincare catalog, compare choices, and inspect review trust. Add a product to your shopping plans to find store offers.</p>
    <div className="esper-chat" aria-live="polite" aria-busy={busy}>{messages.length ? messages.map((message, i) => <div key={message.id || i} className={`esper-message is-${message.role}`}><strong>{message.role === "you" ? "You" : "ESPER"}</strong><p>{message.text || (busy ? "Thinking…" : "No spoken response was returned.")}</p></div>) : <p className="esper-empty">Try “Find a gentle fragrance-free moisturizer under $30,” then ask “Why trust this one?”</p>}</div>
    <form onSubmit={send} className="esper-inline"><label className="sr-only" htmlFor="assistant-text">Ask the assistant</label><input id="assistant-text" value={text} maxLength={2000} onChange={(event) => setText(event.target.value)} placeholder="Find a gentle moisturizer under $30" /><button disabled={busy || !text.trim()}>{busy ? "Thinking…" : "Ask"}</button>{busy ? <button type="button" onClick={() => controller.current?.abort()}>Stop</button> : null}</form>
    {error ? <p className="banner" role="alert">{error}</p> : null}
    {source ? <p className="esper-note">{source.source === "fallback" ? "Local assistant" : "Model assistant"}{source.grounded ? " · Response checked against tool results" : ""}</p> : null}
    <div className="esper-assistant-products">{products.map((product) => <article key={product.id} className="esper-offer"><div><p className="esper-tag">Demo catalog · {product.brand}</p><h3>{product.title}</h3><p>{money(product.price)} · Listed rating {product.rating_listed}</p><p className="esper-note">{product.summary}</p><div className="esper-inline esper-wrap"><button type="button" onClick={() => onPlanProduct(product)}>Find store offers</button><button type="button" className="esper-quiet-button" onClick={() => action({ action: "highlight_trust", product_id: product.id }).catch((err) => setError(err.message))}>Review trust</button><button type="button" className="esper-quiet-button" onClick={() => feedback(product.id, "like")}>Like</button><button type="button" className="esper-quiet-button" onClick={() => feedback(product.id, "dismiss")}>Dismiss</button></div></div></article>)}</div>
    {trust ? <section className="esper-assessment"><h3>Review trust · {products.find((product) => product.id === trust.product_id)?.title || trust.product_id}</h3><p><strong>{trust.tier}</strong>{trust.score != null ? ` · ${trust.score}/100` : " · Insufficient evidence"}</p><ul>{trust.top_reasons?.map((reason) => <li key={reason}>{reason}</li>)}</ul><p className="esper-note">Listed rating {trust.rating_listed} · Adjusted rating {trust.rating_adjusted}{trust.seeded_for_demo ? " · Seeded demo evidence" : ""}</p>{trust.security_flags?.length ? <p className="banner">{trust.security_flags.length} instruction attempts flagged in review text.</p> : null}</section> : null}
    {comparison ? <section className="esper-comparison" aria-label="Assistant comparison"><h3>Product tradeoffs</h3><table><thead><tr><th>Factor</th><th>{products.find((product) => product.id === comparison.product_ids?.[0])?.title || comparison.product_ids?.[0]}</th><th>{products.find((product) => product.id === comparison.product_ids?.[1])?.title || comparison.product_ids?.[1]}</th></tr></thead><tbody>{comparison.tradeoffs?.map((tradeoff) => <tr key={tradeoff.dimension}><th>{tradeoff.dimension}</th><td>{tradeoff.a}</td><td>{tradeoff.b}</td></tr>)}</tbody></table></section> : null}
    <SignedCheckout getSession={session} products={products} staged={staged} onStage={setStaged} />
    <details className="esper-traces"><summary>Assistant activity · {traces.length} events</summary><ul>{traces.map((trace, i) => <li key={i}><strong>{trace.kind === "tool" ? trace.name : trace.kind === "policy" ? `${trace.passed ? "Passed" : "Held"}: ${trace.rule}` : "Filter"}</strong> · {trace.reason || trace.why || `${trace.ms ?? 0} ms`}</li>)}</ul></details>
    <div className="esper-inline esper-wrap"><button type="button" className="esper-quiet-button" onClick={() => details("profile")}>View preferences</button><button type="button" className="esper-quiet-button" onClick={() => details("audit")}>View audit trail</button></div>
    {profile ? <details open><summary>Assistant preferences</summary><p className="esper-note">Needs: {profile.needs?.join(", ") || "None yet"} · Avoid: {profile.avoid?.join(", ") || "None"} · Budget: {profile.budget_max == null ? "Not set" : money(profile.budget_max)}</p></details> : null}
    {audit ? <details open><summary>Audit trail</summary><pre className="esper-json">{JSON.stringify(audit, null, 2)}</pre></details> : null}
  </section>;
}
