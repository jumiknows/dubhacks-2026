/**
 * OWNER: Synthesis bot
 * STATUS: Prefers the Python weighted scorer, then local rank.
 *
 * POST {PYTHON_API_URL}/market/synthesize
 *   { item, products, weights? }
 */

const PYTHON_API = process.env.PYTHON_API_URL || "http://localhost:8000";

export async function synthesize(item, products) {
  const live = await synthesizePython(item, products);
  if (live) return live;
  return chooseOffer(item, products);
}

async function synthesizePython(item, products) {
  try {
    const response = await fetch(`${PYTHON_API}/market/synthesize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        item: {
          name: item.name,
          quantity: item.quantity,
          unit: item.unit,
          reason: item.reason,
        },
        products: products.map(toMarket),
      }),
    });
    if (!response.ok) return null;
    const body = await response.json();
    return {
      summary: body.summary,
      image: body.image,
      dimensions: body.dimensions,
      shippingDate: body.shipping_date,
      totalPrice: body.total_price,
      currency: body.currency || "USD",
      best: body.best ? fromMarket(body.best) : null,
      alternatives: (body.alternatives || []).map(fromMarket),
      method: body.method,
      weights: body.weights,
    };
  } catch {
    return null;
  }
}

function toMarket(product) {
  return {
    id: product.id,
    store: product.store,
    title: product.title,
    price: product.price,
    currency: product.currency || "USD",
    image: product.image,
    url: product.url,
    dimensions: product.dimensions,
    shipping_days: product.shippingDays ?? product.shipping_days ?? null,
    in_stock: product.inStock !== false && product.in_stock !== false,
    rating: product.rating ?? null,
    review_count: product.reviewCount ?? product.review_count ?? 0,
    seller: product.seller ?? null,
    seller_rating: product.seller_rating ?? null,
    condition: product.condition || "new",
    marketplace: product.marketplace || "amazon",
    query: product.query || "",
    brand: product.brand ?? null,
    specs: product.specs || {},
    history: product.history ?? null,
    asin: product.asin ?? null,
    walmart_id: product.walmart_id ?? null,
    bang_per_buck: product.bang_per_buck,
    relevancy: product.relevancy,
    trust: product.trust,
    flags: product.flags || [],
    prime: product.prime ?? false,
  };
}

function fromMarket(product) {
  return {
    id: product.id,
    store: product.store,
    title: product.title,
    price: product.price,
    currency: product.currency,
    image: product.image,
    url: product.url,
    dimensions: product.dimensions,
    shippingDays: product.shipping_days ?? null,
    shipping_days: product.shipping_days ?? null,
    inStock: product.in_stock,
    in_stock: product.in_stock,
    rating: product.rating,
    reviewCount: product.review_count,
    review_count: product.review_count,
    seller: product.seller,
    condition: product.condition,
    marketplace: product.marketplace,
    brand: product.brand,
    specs: product.specs || {},
    history: product.history,
    bang_per_buck: product.bang_per_buck,
    relevancy: product.relevancy,
    trust: product.trust,
    score: product.score,
    flags: product.flags || [],
    scores: product.scores,
    asin: product.asin,
    walmart_id: product.walmart_id,
  };
}

function chooseOffer(item, products) {
  const ranked = rank(products || []);
  const best = ranked[0] || null;
  if (!best) return emptyOffer(item);

  const unitPrice = typeof best.price === "number" ? best.price : null;
  const quantity = item.quantity > 0 ? item.quantity : 1;
  const totalPrice = unitPrice == null ? null : roundCents(unitPrice * quantity);
  const pack = quantity > 1 ? `${quantity} × ` : "";
  const stockNote = best.inStock === false ? " (out of stock)" : "";

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
    if (a.inStock !== b.inStock) return stockRank(a) - stockRank(b);
    const ap = typeof a.price === "number" ? a.price : Number.POSITIVE_INFINITY;
    const bp = typeof b.price === "number" ? b.price : Number.POSITIVE_INFINITY;
    return ap - bp;
  });
}

// In stock first, then unknown (lookup sources), then out of stock.
function stockRank(product) {
  return product.inStock === true ? 0 : product.inStock === false ? 2 : 1;
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
