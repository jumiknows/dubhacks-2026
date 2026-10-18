/**
 * OWNER: Synthesis bot
 * STATUS: Prefers the Python weighted scorer, then a deterministic local pick.
 *
 * POST {PYTHON_API_URL}/market/synthesize
 *   { item, products, weights? }
 *
 * Every listing is sanitized here first. Money is counted in integer cents;
 * delivery dates and merchant trust are never inferred from a store name.
 * totalPrice retains the original quantity x unit-price meaning.
 */

const PYTHON_API = process.env.PYTHON_API_URL || "http://localhost:8000";

// Leave enough precision for the existing JSON number-in-dollars contract to
// round-trip every cent. Computation itself remains in integer cents.
export const MAX_MONEY_CENTS = BigInt(Number.MAX_SAFE_INTEGER) / 4n;
const CURRENCIES = new Set(Intl.supportedValuesOf("currency"));

export function normalizeCurrency(value) {
  if (typeof value !== "string") return null;
  const code = value.trim().toUpperCase();
  if (!CURRENCIES.has(code)) return null;
  // The planner contract uses cents. Do not misprice zero/three-decimal currencies.
  const digits = new Intl.NumberFormat("en", { style: "currency", currency: code })
    .resolvedOptions().maximumFractionDigits;
  return digits === 2 ? code : null;
}

export function parseCents(value, currency) {
  const code = normalizeCurrency(currency);
  if (!code || (typeof value !== "string" && typeof value !== "number")) return null;
  if (typeof value === "number" && (!Number.isFinite(value) || value < 0)) return null;
  let text = String(value).trim();
  if (text.length > 64) return null;
  if (text.startsWith(`${code} `)) text = text.slice(4).trim();
  if (text.endsWith(` ${code}`)) text = text.slice(0, -4).trim();
  // A bare dollar sign is accepted only when USD was separately declared.
  if (code === "USD" && text.startsWith("$")) text = text.slice(1);
  if (!/^(?:\d+|[1-9]\d{0,2}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(text)) return null;
  const [whole, fraction = ""] = text.replaceAll(",", "").split(".");
  const cents = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
  return cents <= MAX_MONEY_CENTS ? Number(cents) : null;
}

export function validQuantity(value) {
  return Number.isSafeInteger(value) && value > 0;
}

export function validDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : null;
}

function safeUrl(value) {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}

function unit(value) {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : null;
}

function count(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function text(value, max = 200) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null;
}

/** Validated listing: money and links checked, comparison signals kept for the UI and compare model. */
function normalizeListing(raw, index) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const currency = normalizeCurrency(raw.currency);
  const cents = parseCents(raw.price, currency);
  const isMock = raw.isMock === true;
  const inStock = typeof raw.inStock === "boolean" ? raw.inStock : typeof raw.in_stock === "boolean" ? raw.in_stock : null;
  const shippingDays = [raw.shippingDays, raw.shipping_days].find((d) => Number.isSafeInteger(d) && d >= 0) ?? null;
  const label = typeof raw.dimensions === "string" ? raw.dimensions : raw.dimensions?.label;
  const reviewCount = count(raw.reviewCount ?? raw.review_count);
  const rating = typeof raw.rating === "number" && raw.rating >= 0 && raw.rating <= 5 ? raw.rating : null;
  const sourceWarnings = Array.isArray(raw.warnings) ? raw.warnings.filter((w) => typeof w === "string").slice(0, 5) : [];
  return {
    id: typeof raw.id === "string" ? raw.id : `listing-${index}`,
    store: typeof raw.store === "string" ? raw.store : "Unknown merchant",
    title: typeof raw.title === "string" ? raw.title : "Untitled listing",
    description: text(raw.description, 400),
    price: cents === null ? null : cents / 100,
    currency,
    image: safeUrl(raw.image),
    url: safeUrl(raw.url),
    dimensions: typeof label === "string" && label.trim() ? { label: label.trim().slice(0, 80) } : null,
    inStock,
    in_stock: inStock,
    shippingDays,
    shipping_days: shippingDays,
    shippingDate: isMock ? null : validDate(raw.shippingDate),
    estimatedArrival: isMock ? null : validDate(raw.estimatedArrival),
    shippingPrice: normalizeCurrency(raw.shippingCurrency) === currency ? centsAmount(raw.shippingPrice, currency) : null,
    tax: normalizeCurrency(raw.taxCurrency) === currency ? centsAmount(raw.tax, currency) : null,
    // Comparison signals. Scores are 0..1; anything else is dropped rather than guessed.
    score: unit(raw.score),
    scores: raw.scores && typeof raw.scores === "object" && !Array.isArray(raw.scores) ? raw.scores : null,
    bang_per_buck: unit(raw.bang_per_buck),
    relevancy: unit(raw.relevancy),
    trust: unit(raw.trust),
    trust_multiplier: unit(raw.trust_multiplier),
    rating,
    reviewCount,
    review_count: reviewCount,
    seller: text(raw.seller, 80),
    condition: text(raw.condition, 40),
    marketplace: text(raw.marketplace, 40),
    brand: text(raw.brand, 80),
    specs: raw.specs && typeof raw.specs === "object" && !Array.isArray(raw.specs) ? raw.specs : {},
    history: raw.history ?? null,
    flags: Array.isArray(raw.flags) ? raw.flags.filter((f) => typeof f === "string").slice(0, 10) : [],
    prime: raw.prime === true,
    asin: text(raw.asin, 20),
    walmart_id: text(raw.walmart_id, 40),
    source: typeof raw.source === "string" ? raw.source : "unverified_source",
    isMock,
    warnings: isMock
      ? ["Demo listing: price, stock, dimensions and shipping duration are sample data.", ...sourceWarnings]
      : sourceWarnings,
  };
}

function centsAmount(value, currency) {
  const cents = parseCents(value, currency);
  return cents === null ? null : cents / 100;
}

/** The listings the UI may show. Same sanitizer synthesis uses. */
export function sanitizeListings(products) {
  return (Array.isArray(products) ? products : []).map(normalizeListing).filter(Boolean);
}

export async function synthesize(item, products) {
  const listings = sanitizeListings(products);
  const weighted = await synthesizePython(item, listings);
  return weighted ?? chooseOffer(item, listings);
}

/** The Python scorer picks; money and listing data still come from the sanitized side. */
async function synthesizePython(item, listings) {
  if (!listings.length) return null;
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
        products: listings.map(toMarket),
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return null;
    const body = await response.json();
    const byId = new Map(listings.map((listing) => [listing.id, listing]));
    const scored = (row) => {
      const listing = byId.get(row?.id);
      if (!listing) return null;
      return { ...listing, score: unit(row.score) ?? listing.score, scores: row.scores ?? listing.scores };
    };
    const best = scored(body.best);
    if (!best || best.price === null || best.currency === null || best.inStock === false) return null;
    const ranked = [best, ...(body.alternatives || []).map(scored).filter(Boolean)];
    const rest = listings.filter((listing) => !ranked.some((row) => row.id === listing.id));
    return offer(item, best, [...ranked.slice(1), ...rest], best.currency, {
      method: body.method,
      weights: body.weights,
    });
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
    shipping_days: product.shippingDays,
    in_stock: product.inStock !== false,
    rating: product.rating,
    review_count: product.reviewCount ?? 0,
    seller: product.seller,
    condition: product.condition || "new",
    marketplace: product.marketplace || "amazon",
    brand: product.brand,
    specs: product.specs || {},
    history: product.history,
    asin: product.asin,
    walmart_id: product.walmart_id,
    bang_per_buck: product.bang_per_buck,
    relevancy: product.relevancy,
    trust: product.trust,
    flags: product.flags || [],
    prime: product.prime,
  };
}

function chooseOffer(item, listings) {
  const warnings = [];
  if (listings.some((p) => p.price === null || p.currency === null)) {
    warnings.push("Some listings have missing, invalid or unsupported prices/currencies and cannot be compared.");
  }
  const available = listings.filter((p) => p.inStock === true && p.price !== null && p.currency !== null);
  const currencies = new Set(available.map((p) => p.currency));
  const requested = normalizeCurrency(item.currency);
  let currency = requested ?? (currencies.size === 1 ? [...currencies][0] : null);
  if (item.currency != null && !requested) {
    currency = null;
    warnings.push("Requested currency is unsupported; no currency conversion was performed.");
  } else if (!requested && currencies.size > 1) {
    warnings.push("Listings use different currencies; no cheapest offer can be selected without a requested currency.");
  }
  const ranked = currency ? available.filter((p) => p.currency === currency).sort((a, b) =>
    parseCents(a.price, currency) - parseCents(b.price, currency)) : [];
  const best = ranked[0] ?? null;
  if (!best) warnings.push("No comparable, explicitly in-stock priced listing is available.");
  return offer(item, best, [...ranked.slice(1), ...listings.filter((p) => !ranked.includes(p))], currency, {
    method: "cheapest_in_stock",
    warnings,
  });
}

function offer(item, best, alternatives, currency, { method, weights = null, warnings = [] }) {
  const notes = [...warnings];
  if (!validQuantity(item.quantity)) notes.push("Quantity must be a positive safe integer; no price was calculated.");
  const cents = best && validQuantity(item.quantity) ? BigInt(parseCents(best.price, currency)) * BigInt(item.quantity) : null;
  const subtotal = cents !== null && cents <= MAX_MONEY_CENTS ? Number(cents) / 100 : null;
  if (cents !== null && subtotal === null) notes.push("Merchandise subtotal exceeds the supported safe amount.");
  if (best?.isMock) notes.push(...best.warnings);
  notes.push("Merchandise subtotal excludes shipping and tax; a delivered total is unknown.");
  if (!best?.shippingDate) notes.push("Shipping date is unknown; shipping duration alone is not a dated promise.");
  if (!best?.estimatedArrival) notes.push("Arrival date is unknown.");
  return {
    summary: best ? `${item.quantity > 1 ? `${item.quantity} × ` : ""}${best.title} from ${best.store}` : `No priced listing for ${item.name} yet.`,
    image: best?.image ?? null,
    dimensions: best?.dimensions ?? null,
    shippingDate: best?.shippingDate ?? null,
    estimatedArrival: best?.estimatedArrival ?? null,
    totalPrice: subtotal,
    subtotal,
    priceScope: "items_only",
    currency,
    shippingPrice: best?.shippingPrice ?? null,
    tax: best?.tax ?? null,
    // Charge scopes are absent from the legacy RawProduct contract. Do not add
    // unit/order charges to a quantity subtotal without an explicit agreed scope.
    fullTotal: null,
    costComplete: false,
    best,
    alternatives,
    method,
    weights,
    source: best?.source ?? "no_comparable_listing",
    isMock: best?.isMock ?? alternatives.some((p) => p.isMock),
    warnings: [...new Set(notes)],
  };
}
