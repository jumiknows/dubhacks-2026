/**
 * OWNER: Synthesis bot
 * STATUS: Stub. Returns a Promise of one display offer for a plan item.
 *
 * Replace chooseOffer() with a model that weighs price, shipping,
 * dimensions, and images. Keep the Synthesis shape.
 *
 * Synthesis:
 *   { summary, image, dimensions, shippingDate, totalPrice, currency, best, alternatives }
 *   shippingDate: YYYY-MM-DD | null
 *   totalPrice: unit price × quantity, or null when nothing is priced
 *   best: RawProduct | null
 *   alternatives: RawProduct[]
 */

export function synthesize(item, products) {
  const offer = chooseOffer(item, products);
  return Promise.resolve(offer);
}

function chooseOffer(item, products) {
  const ranked = rank(products || []);
  const best = ranked[0] || null;

  if (!best) {
    return emptyOffer(item);
  }

  const unitPrice = typeof best.price === "number" ? best.price : null;
  const quantity = item.quantity > 0 ? item.quantity : 1;
  const totalPrice = unitPrice == null ? null : roundCents(unitPrice * quantity);
  const pack = quantity > 1 ? `${quantity} × ` : "";
  const stockNote = best.inStock ? "" : " (out of stock)";

  return {
    summary: unitPrice == null
      ? `No priced listing for ${item.name} yet.`
      : `${pack}${best.title} from ${best.store}${stockNote}`,
    image: best.image,
    dimensions: best.dimensions,
    shippingDate: shippingDate(best.shippingDays),
    totalPrice,
    currency: best.currency || "USD",
    best,
    alternatives: ranked.slice(1),
  };
}

function emptyOffer(item) {
  return {
    summary: `No products for ${item.name} yet.`,
    image: null,
    dimensions: null,
    shippingDate: null,
    totalPrice: null,
    currency: "USD",
    best: null,
    alternatives: [],
  };
}

function rank(products) {
  return [...products].sort((a, b) => {
    if (a.inStock !== b.inStock) return a.inStock ? -1 : 1;
    const ap = typeof a.price === "number" ? a.price : Number.POSITIVE_INFINITY;
    const bp = typeof b.price === "number" ? b.price : Number.POSITIVE_INFINITY;
    return ap - bp;
  });
}

function shippingDate(days) {
  if (typeof days !== "number") return null;
  const date = new Date();
  date.setDate(date.getDate() + days);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function roundCents(amount) {
  return Math.round(amount * 100) / 100;
}
