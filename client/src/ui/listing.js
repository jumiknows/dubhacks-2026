// Listing helpers shared by the product stage, the compare sheet and the cart.

/** The shape /api/compare scores. Unknown signals get neutral defaults instead of null. */
export function toValued(product) {
  const num = (value, fallback) => (typeof value === "number" && Number.isFinite(value) ? value : fallback);
  return {
    id: String(product.id),
    title: product.title || "",
    store: product.store || "",
    url: product.url || null,
    price: num(product.price, null),
    in_stock: (product.inStock ?? product.in_stock) !== false,
    bang_per_buck: Math.max(0, num(product.bang_per_buck, 0.5)),
    relevancy: Math.max(0, num(product.relevancy, 1)),
    trust: Math.min(1, Math.max(0, num(product.trust, 0.5))),
    flags: product.flags || [],
    brand: product.brand || null,
    specs: Object.fromEntries(Object.entries(product.specs || {}).filter(([, v]) => v != null).map(([k, v]) => [k, String(v)])),
    marketplace: product.marketplace || null,
    history: product.history && typeof product.history === "object" ? product.history : null,
    condition: product.condition || "new",
    rating: num(product.rating, null),
    review_count: num(product.review_count ?? product.reviewCount, 0),
    prime: product.prime === true,
    shipping_days: num(product.shipping_days ?? product.shippingDays, null),
    image: product.image || null,
    currency: product.currency || "USD",
    dimensions: product.dimensions && typeof product.dimensions === "object" ? product.dimensions : null,
  };
}

export function valueScore(product) {
  const score = product.score ?? ((product.bang_per_buck ?? 0.5) * (product.relevancy ?? 1) * (product.trust_multiplier ?? product.trust ?? 0.7));
  return Math.round(Math.max(0, Math.min(1, score)) * 100);
}

export function productDetails(product) {
  const details = [];
  const dimensions = typeof product.dimensions === "string" ? product.dimensions : product.dimensions?.label;
  if (dimensions) details.push(["Dimensions", dimensions]);
  const reviews = product.reviewCount ?? product.review_count;
  if (product.rating != null) details.push(["Rating", `${Number(product.rating).toFixed(1)} / 5${reviews ? ` · ${Number(reviews).toLocaleString()} reviews` : ""}`]);
  const shipping = product.shippingDays ?? product.shipping_days;
  if (typeof shipping === "number") details.push(["Shipping", `${shipping} day${shipping === 1 ? "" : "s"}`]);
  if (product.condition) details.push(["Condition", product.condition]);
  if (product.seller) details.push(["Seller", product.seller]);
  if (product.inStock === false || product.in_stock === false) details.push(["Availability", "Out of stock"]);
  for (const [key, detail] of Object.entries(product.specs || {}).slice(0, 6)) {
    if (detail && !details.some(([label]) => label.toLowerCase() === key.toLowerCase())) details.push([key, String(detail)]);
  }
  return details.slice(0, 8);
}

export function bestListingId(item) {
  return item?.synthesis?.best?.id ?? null;
}

export function isPriced(item) {
  const total = item?.synthesis?.totalPrice;
  return typeof total === "number" && total > 0;
}
