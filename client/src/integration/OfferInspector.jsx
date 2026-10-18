import { useEffect, useState } from "react";
import { useGestureEvents } from "conjure-gestures";
import { compareItems } from "../api.js";
import { money, quantityLabel } from "../ui/format.js";
import { toValued } from "./transport.js";
import Modal from "./Modal.jsx";
import { SafetyCheck } from "./EvidencePanel.jsx";

export default function OfferInspector({ item, tone, holding, holdProgress, onClose, onOwn, onBought, onAdd, trustFloor, onTrustFloor, voiceCompare }) {
  const [picked, setPicked] = useState([]);
  const [compare, setCompare] = useState(null);
  const [pending, setPending] = useState(null);
  const [error, setError] = useState("");
  const [safetyUrl, setSafetyUrl] = useState(null);
  const products = item.products || [];
  const bestId = item.synthesis?.best?.id;
  const stock = (product) => product.in_stock ?? product.inStock ?? null;
  useEffect(() => { setPicked([]); setCompare(null); setError(""); setSafetyUrl(null); }, [item.id]);
  useEffect(() => {
    if (voiceCompare?.itemId === item.id) {
      setCompare(voiceCompare.result);
      setPicked([voiceCompare.result.left?.id, voiceCompare.result.right?.id].filter(Boolean));
    }
  }, [voiceCompare, item.id]);
  useEffect(() => {
    if (picked.length !== 2) { setCompare(null); return; }
    const [left, right] = picked.map((id) => products.find((product) => product.id === id));
    if (!left || !right) return;
    if (!left.currency || !right.currency || left.currency !== right.currency) { setCompare(null); setError("These offers use different or unknown currencies. Compare their original prices before choosing."); return; }
    setError("");
    let cancelled = false;
    compareItems(toValued(left), toValued(right), trustFloor).then((result) => { if (!cancelled) setCompare(result); }).catch((err) => { if (!cancelled) setError(err.message); });
    return () => { cancelled = true; };
  }, [picked, trustFloor, products]);
  useGestureEvents("compare", (event) => {
    const ids = (event.target_ids || []).map((id) => products.find((product) => id === `product:${item.id}:${product.id}`)?.id).filter(Boolean);
    if (ids.length === 2) setPicked(ids);
  });
  async function add(product) {
    setPending(product.id); setError("");
    try { await onAdd(item, product); }
    catch (err) { setError(err.message); }
    finally { setPending(null); }
  }
  return <Modal title={item.name} onClose={onClose} wide>
    <p className="esper-tag">{tone === "cart" ? "In cart" : tone === "owned" ? "Owned" : item.purchased ? "Purchased" : "To buy"}</p>
    <p>{item.reason}{quantityLabel(item) ? ` · ${quantityLabel(item)}` : ""}</p>
    {item.synthesis?.warnings?.map((warning, i) => <p className="banner" key={i}>{warning}</p>)}
    {item.synthesis ? <p className="esper-note">Selected: {item.synthesis.best?.title || item.synthesis.summary} · {money(item.synthesis.totalPrice, item.synthesis.currency)}</p> : <p className="esper-note">Store prices are being gathered. Offers appear as they arrive.</p>}
    <div className="esper-inline esper-wrap"><button onClick={onOwn} type="button" disabled={Boolean(item.order)}>{item.owned ? "Mark needed" : "Already own this"}</button><button onClick={onBought} type="button" disabled={Boolean(item.order)}>{item.order ? "Purchased with order" : item.purchased ? "Mark unpurchased" : "Mark purchased"}</button></div>
    <label className="esper-trust">Trust score floor <output>{Math.round(trustFloor * 100)}%</output><input type="range" min="0" max="1" step="0.05" value={trustFloor} onChange={(event) => onTrustFloor(Number(event.target.value))} /></label>
    <p className="esper-note">A higher floor reduces the effect of trust on comparison scores; it does not filter out offers.</p>
    {error ? <p className="banner" role="alert">{error}</p> : null}
    <div className="esper-offers" aria-label="Product offers">
      {products.map((product) => <article key={product.id} className={`esper-offer${bestId === product.id ? " is-selected" : ""}`} data-gesture-id={`product:${item.id}:${product.id}`} data-product-id={`product:${item.id}:${product.id}`} data-gesture-object={`product:${item.id}:${product.id}`} data-gesture-group={`offers:${item.id}`} data-gesture-kind="original">
        {product.image ? <img src={product.image} alt="" onError={(event) => { event.currentTarget.style.display = "none"; }} /> : null}
        <div><p className="esper-tag">{product.store}{product.isMock ? " · Demo offer" : ""}{product.source ? ` · ${product.source}` : ""}{bestId === product.id ? " · Selected offer" : ""}</p><h3>{product.title}</h3><p><strong>{money(product.price, product.currency)}</strong>{product.trust != null ? ` · Trust ${Math.round(product.trust * 100)}%` : ""}</p><p className="esper-note">{stock(product) === true ? "In stock" : stock(product) === false ? "Out of stock" : "Stock unknown"}{product.shippingDays != null || product.shipping_days != null ? ` · Estimated delivery ${product.shippingDays ?? product.shipping_days} days` : ""}</p>{product.warnings?.map((warning, i) => <p className="esper-note" key={i}>{warning}</p>)}{product.flags?.length ? <p className="esper-note">{product.flags.join(" · ")}</p> : null}
          <div className="esper-inline esper-wrap"><button type="button" disabled={pending != null || item.purchased || item.owned || stock(product) !== true || !product.currency || !(product.price > 0)} onClick={() => add(product)}>{pending === product.id ? "Saving…" : tone === "cart" && bestId === product.id ? "In cart" : "Add to cart"}</button><label className="esper-check"><input type="checkbox" disabled={!product.currency || !Number.isFinite(product.price)} checked={picked.includes(product.id)} onChange={() => setPicked((current) => current.includes(product.id) ? current.filter((id) => id !== product.id) : [...current, product.id].slice(-2))} />Compare</label>{product.url ? <button type="button" className="esper-quiet-button" onClick={() => setSafetyUrl(product.url)}>Check store link</button> : null}</div>
          {holding === product.id ? <progress max="1" value={holdProgress} aria-label="Hold to add to cart" /> : null}
        </div>
      </article>)}
      {!products.length ? <p className="esper-note">{item.pricingFailed ? "No matching offers were returned. You can still mark this item owned or purchased." : "No offers yet. Keep this item on your list while prices arrive."}</p> : null}
    </div>
    {compare ? <section className="esper-comparison" aria-label="Item comparison"><h3>{compare.pick ? `Recommended: ${compare[compare.pick]?.title}` : "Compare the tradeoffs"}</h3><p>{compare.reasons?.join(" ")}</p><table><thead><tr><th>Factor</th><th>{compare.left?.store}</th><th>{compare.right?.store}</th></tr></thead><tbody>{compare.axes?.map((axis) => <tr key={axis.name}><th>{axis.name}</th><td>{String(axis.left)}</td><td>{String(axis.right)}</td></tr>)}</tbody></table>{compare.pick ? <button type="button" disabled={pending != null || item.purchased || item.owned || stock(compare[compare.pick]) !== true || !compare[compare.pick]?.currency} onClick={() => add(compare[compare.pick])}>Use recommended listing</button> : null}</section> : <p className="esper-note">Select two offers to compare price, fit and trust. You can also bring two offer cards together with your hands.</p>}
    {safetyUrl ? <SafetyCheck key={safetyUrl} initialUrl={safetyUrl} /> : null}
  </Modal>;
}
