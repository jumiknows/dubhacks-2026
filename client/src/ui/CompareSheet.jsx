import { money } from "./format.js";
import { Thumb } from "./ShopBoard.jsx";
import { productDetails, valueScore } from "./listing.js";

const AXIS_LABELS = {
  bang_per_buck: "Bang per buck",
  relevancy: "Fits what you asked",
  initial_value: "Value before trust",
  trust: "Review & seller trust",
  trust_multiplier: "Trust multiplier",
  score: "Overall score",
};

/** Two listings side by side. score = bang per buck × relevancy × trust multiplier (floor adjustable). */
export default function CompareSheet({ compare, trustFloor, onTrustFloor, onChoose, onClose }) {
  const { item, result, loading, error } = compare;
  const sides = ["left", "right"].map((side) => {
    const scored = result?.[side] || {};
    const full = (item.products || []).find((p) => p.id === scored.id) || {};
    return { side, label: side === "left" ? "A" : "B", product: { ...full, ...scored, image: full.image ?? scored.image } };
  });
  const winner = result?.pick ? sides.find((s) => s.side === result.pick) : null;
  const tradeoff = result ? tradeoffs(sides[0].product, sides[1].product) : "";

  return (
    <div className="compare-layer" role="dialog" aria-modal="true" aria-label={`Compare ${item.name} listings`}>
      <section className="compare-sheet-v2">
        <header className="compare-head">
          <div>
            <p className="shop-kicker">Comparing · {item.name}</p>
            <h3>
              {loading ? "Scoring both listings…" : error ? "Couldn't compare these two" : winner
                ? `${winner.product.title || winner.product.store} wins`
                : "Too close to call"}
            </h3>
            {tradeoff ? <p className="compare-tradeoff">{tradeoff}</p> : null}
            <p className="shop-meta">
              {error || (winner ? "Value = bang per buck × fit × trust multiplier." : "Value scores are within 0.05, so Esper won't call a winner. Pick on what matters to you.")}
            </p>
          </div>
          <button type="button" className="compare-close" onClick={onClose}>Close</button>
        </header>

        <div className="compare-sides">
          {sides.map(({ side, label, product }) => {
            const won = winner?.side === side;
            return (
              <article key={side} className={won ? "compare-side is-winner" : "compare-side"}>
                <div className="compare-side-top">
                  <Thumb image={product.image} store={product.store} />
                  <div>
                    <p className="product-store">{label} · {product.store}{won ? <em className="chosen-badge">Best value</em> : null}</p>
                    <p className="shop-piece-name">{product.title || product.store || "Listing"}</p>
                    <p className="product-price-row">
                      <strong>{money(product.price, product.currency)}</strong>
                      <span className="value-score">Value {valueScore(product)}/100</span>
                    </p>
                    {product.isMock ? <p className="mock-note">Demo listing: sample price and stock.</p> : null}
                  </div>
                </div>
                <span className="product-facts">
                  {productDetails(product).slice(0, 4).map(([name, detail]) => <span key={name}><b>{name}</b>{detail}</span>)}
                </span>
                <div className="compare-actions">
                  <button type="button" className="confirm" disabled={loading || item.purchased || item.owned || (product.inStock ?? product.in_stock) !== true || !product.currency || !(typeof product.price === "number" && product.price > 0)} onClick={() => onChoose(product.id, true)}>
                    Choose {label} + add to cart
                  </button>
                  <button type="button" className="ghost" disabled={loading || item.purchased || item.owned || (product.inStock ?? product.in_stock) !== true || !product.currency || !(typeof product.price === "number" && product.price > 0)} onClick={() => onChoose(product.id, false)}>
                    Just choose {label}
                  </button>
                </div>
              </article>
            );
          })}
        </div>

        {result?.axes?.length ? (
          <table className="axes compare-axes">
            <thead>
              <tr><th>Why</th><th>A</th><th>B</th></tr>
            </thead>
            <tbody>
              {result.axes.map((axis) => (
                <tr key={axis.name} title={axis.note || ""}>
                  <td>{AXIS_LABELS[axis.name] || humanize(axis.name)}</td>
                  <td className={axis.winner === "left" ? "win" : ""}>{formatAxis(axis.left)}</td>
                  <td className={axis.winner === "right" ? "win" : ""}>{formatAxis(axis.right)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}

        <label className="trust-floor compare-trust">
          <span>Trust floor {Math.round(trustFloor * 100)}% · higher reduces the effect of trust on scores; it does not filter offers</span>
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={trustFloor}
            onChange={(event) => onTrustFloor(Number(event.target.value))}
          />
        </label>
      </section>
    </div>
  );
}

/** The plain-language difference between two listings: price, trust, shipping, rating. */
export function tradeoffs(a, b) {
  const name = (p) => p.store || p.title || "One";
  const parts = [];
  if (typeof a.price === "number" && typeof b.price === "number" && a.price !== b.price) {
    const [cheap, dear] = a.price < b.price ? [a, b] : [b, a];
    parts.push(`${name(cheap)} is ${money(dear.price - cheap.price, cheap.currency || "USD")} cheaper`);
  }
  const better = [];
  const trustA = a.trust ?? null;
  const trustB = b.trust ?? null;
  if (trustA !== null && trustB !== null && Math.abs(trustA - trustB) >= 0.05) better.push(["is better reviewed", trustA > trustB ? a : b]);
  const shipA = a.shippingDays ?? a.shipping_days;
  const shipB = b.shippingDays ?? b.shipping_days;
  if (typeof shipA === "number" && typeof shipB === "number" && shipA !== shipB) better.push([`ships ${Math.abs(shipA - shipB)} day${Math.abs(shipA - shipB) === 1 ? "" : "s"} sooner`, shipA < shipB ? a : b]);
  if (typeof a.rating === "number" && typeof b.rating === "number" && Math.abs(a.rating - b.rating) >= 0.2) better.push([`is rated ${Math.max(a.rating, b.rating).toFixed(1)}★`, a.rating > b.rating ? a : b]);
  for (const side of [a, b]) {
    const wins = better.filter(([, who]) => who === side).map(([what]) => what);
    if (wins.length) parts.push(`${name(side)} ${wins.join(" and ")}`);
  }
  return parts.length ? `${parts.join("; ")}.` : "";
}

function humanize(name) {
  const text = String(name).replace(/_/g, " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function formatAxis(value) {
  return typeof value === "number" ? value.toFixed(2) : String(value ?? "—");
}
