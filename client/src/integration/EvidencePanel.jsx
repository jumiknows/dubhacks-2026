import { useState } from "react";
import { post } from "./transport.js";

const BASE = "/api/conjure";

export function SafetyCheck({ initialUrl = "", merchantId }) {
  const [url, setUrl] = useState(initialUrl);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function assess(event) {
    event?.preventDefault(); setBusy(true); setError(""); setResult(null);
    try { setResult(await post(`${BASE}/websites/assess`, { url, purpose: "link", ...(merchantId ? { merchant_id: merchantId } : {}) })); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  return <section className="esper-evidence" aria-label="Website safety">
    <h3>Check a website</h3>
    <form className="esper-inline" onSubmit={assess}>
      <label className="sr-only" htmlFor="safety-url">Website URL</label>
      <input id="safety-url" type="url" required value={url} onChange={(event) => { setUrl(event.target.value); setResult(null); }} placeholder="https://shop.example/product" />
      <button disabled={busy || !url.trim()}>{busy ? "Checking…" : "Check website"}</button>
    </form>
    {error ? <p role="alert" className="banner">{error}</p> : null}
    {result ? <div className={`esper-assessment is-${result.decision}`} role="status">
      <p><strong>{result.decision === "allowed" ? "Checks passed" : result.decision === "blocked" ? "Blocked" : "Needs review"}</strong> · {result.origin || "Invalid destination"}</p>
      <p>{result.summary}</p>
      <ul>{result.evidence?.map((entry, i) => <li key={i}>{entry.detail}</li>)}</ul>
      {result.allowed ? <a href={url} target="_blank" rel="noopener noreferrer">Open checked website ↗</a> : null}
      {result.limitations?.map((text, i) => <p className="esper-note" key={i}>{text}</p>)}
    </div> : <p className="esper-note">Checks merchant identity and available reputation evidence. Missing evidence may hold a link; a passed check cannot guarantee safety.</p>}
  </section>;
}

export function ReviewReport({ result }) {
  const analysis = result?.analysis;
  return <div className="esper-review-report" role="status">
    <p className="esper-tag">{result?.source?.is_mock || result?.source?.status === "demo" ? "Synthetic demo reviews" : result?.source?.status === "uploaded" ? "Uploaded review sample" : "Review source evidence"}</p>
    <p>{result?.summary}</p>
    {analysis ? <>
      <dl className="esper-facts">
        <div><dt>Reviews analyzed</dt><dd>{analysis.analyzed_count} / {analysis.received_count}</dd></div>
        <div><dt>Sample rating</dt><dd>{analysis.ratings?.mean_five == null ? "Unavailable" : `${analysis.ratings.mean_five.toFixed(1)} / 5`}</dd></div>
        <div><dt>Sample opinion</dt><dd>{Object.entries(analysis.sentiment?.counts || {}).map(([key, value]) => `${value} ${key}`).join(" · ")}</dd></div>
      </dl>
      {analysis.recurring_aspects?.length ? <><h4>Recurring themes</h4><ul>{analysis.recurring_aspects.map((aspect) => <li key={aspect.aspect}><strong>{aspect.aspect}</strong> · {aspect.mention_count} mentions{aspect.evidence?.[0] ? <blockquote>“{aspect.evidence[0].quote}”</blockquote> : null}</li>)}</ul></> : null}
      {analysis.security_flags?.length ? <p className="banner">{analysis.security_flags.length} review instruction attempts were flagged and excluded from the findings.</p> : null}
      {analysis.limitations?.map((text, i) => <p className="esper-note" key={i}>{text}</p>)}
    </> : <p className="esper-note">No review finding was inferred from unavailable evidence.</p>}
  </div>;
}

export default function EvidencePanel() {
  const [mode, setMode] = useState("demo");
  const [source, setSource] = useState("woocommerce");
  const [productId, setProductId] = useState("");
  const [merchant, setMerchant] = useState("");
  const [reviews, setReviews] = useState("[]");
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function analyze(event) {
    event.preventDefault(); setBusy(true); setError(""); setResult(null);
    try {
      const product = { source: mode === "upload" ? "uploaded" : source, external_id: productId || "my-product", ...(merchant ? { merchant } : {}) };
      let path = "demo"; let body = {};
      if (mode === "live") { path = "fetch"; body = { product, limit: 50 }; }
      if (mode === "upload") {
        const records = JSON.parse(reviews);
        if (!Array.isArray(records)) throw new Error("Reviews must be a JSON array.");
        path = "analyze"; body = { product, reviews: records };
      }
      setResult(await post(`${BASE}/reviews/${path}`, body));
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  return <div className="esper-tools-grid">
    <section className="esper-evidence" aria-label="Review insights">
      <h3>Review insights</h3><p className="esper-note">Inspect the evidence behind a review sample, including duplicates, recurring themes, and suspicious instructions.</p>
      <form onSubmit={analyze} className="esper-stack">
        <label>Review source<select value={mode} onChange={(event) => { setMode(event.target.value); setResult(null); }}><option value="demo">Try synthetic demo</option><option value="live">Configured live store</option><option value="upload">Upload review JSON</option></select></label>
        {mode !== "demo" ? <label>Product ID<input value={productId} required={mode === "live"} onChange={(event) => setProductId(event.target.value)} placeholder="Store product ID" /></label> : null}
        {mode === "live" ? <><label>Source adapter<input value={source} onChange={(event) => setSource(event.target.value)} required /></label><label>Configured merchant ID<input value={merchant} onChange={(event) => setMerchant(event.target.value)} required /></label></> : null}
        {mode === "upload" ? <label>Reviews JSON<textarea rows={6} value={reviews} onChange={(event) => setReviews(event.target.value)} spellCheck={false} /></label> : null}
        <button disabled={busy}>{busy ? "Analyzing…" : mode === "demo" ? "Analyze demo reviews" : "Analyze reviews"}</button>
      </form>
      {error ? <p role="alert" className="banner">{error}</p> : null}
      {result ? <ReviewReport result={result} /> : null}
      <a className="esper-note" href={`${BASE}/reviews/workbench`} target="_blank" rel="noopener noreferrer">Open full review workbench ↗</a>
    </section>
    <div><SafetyCheck /><a className="esper-note" href={`${BASE}/websites/workbench`} target="_blank" rel="noopener noreferrer">Open website safety workbench ↗</a></div>
  </div>;
}
