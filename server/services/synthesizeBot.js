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
 *   choice: why best won, e.g. "Lowest price in stock"
 *
 * prefs.priority (from onboarding) picks the ranking: "price" (default),
 * "speed" (soonest shipping), or "trusted" (major retailers over
 * marketplace sellers and sample data).
 */

export function synthesize(item, products, prefs = {}) {
  const offer = chooseOffer(item, products, prefs.priority);
  return Promise.resolve(offer);
}

const CHOICE = {
  price: "Lowest price in stock",
  speed: "Ships soonest",
  trusted: "From a major retailer",
};

function chooseOffer(item, products, priority) {
  const ranked = rank(products || [], priority);
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
    choice: CHOICE[priority] || CHOICE.price,
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

function rank(products, priority) {
  return [...products].sort((a, b) => {
    if (a.inStock !== b.inStock) return a.inStock ? -1 : 1;
    if (priority === "speed") {
      const byDays = orInfinity(a.shippingDays) - orInfinity(b.shippingDays);
      if (byDays) return byDays;
    }
    if (priority === "trusted") {
      const byTrust = trustRank(a) - trustRank(b);
      if (byTrust) return byTrust;
    }
    return orInfinity(a.price) - orInfinity(b.price);
  });
}

function orInfinity(value) {
  return typeof value === "number" ? value : Number.POSITIVE_INFINITY;
}

// Live store adapters tag listings with a source; marketplaces and sample data rank lower.
const MARKETPLACES = new Set(["ebay", "etsy", "upcitemdb"]);
function trustRank(product) {
  if (product.isMock) return 2;
  return MARKETPLACES.has(product.source) ? 1 : 0;
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
