import { marketPost } from "./marketClient.js";

/** Deterministic merchandise comparison. Money is counted in integer cents;
 * delivery dates and merchant trust are never inferred from a store name.
 * totalPrice retains the original quantity x unit-price meaning.
 */

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
  if (/^\/api\/conjure\/static\/products\/[A-Za-z0-9_-][A-Za-z0-9_.-]*\.(?:png|jpe?g|webp|gif|svg)$/i.test(value)) return value;
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
    gtin: text(raw.gtin, 40),
    shippingCurrency: normalizeCurrency(raw.shippingCurrency),
    taxCurrency: normalizeCurrency(raw.taxCurrency),
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

export function sanitizeListings(products) {
  return (Array.isArray(products) ? products : []).map(normalizeListing).filter(Boolean);
}

export async function synthesize(item, products, options = {}) {
  const originals = sanitizeListings(products);
  let ranking = null;
  if (originals.length > 1 && originals.some((product) => product.source === "selenium")) {
    try {
      const result = await marketPost("/market/synthesize", {
        item: { name: item.name, quantity: item.quantity, unit: item.unit, reason: item.reason },
        products: originals.filter((product) => product.inStock === true && product.price !== null && product.currency !== null)
          .map((product) => ({ ...product, in_stock: product.inStock, shipping_days: product.shippingDays,
            marketplace: ["amazon", "ebay", "walmart"].includes(product.marketplace) ? product.marketplace : "amazon" })),
      });
      ranking = [result.best, ...(result.alternatives || [])].filter(Boolean).map((product) => product.id);
    } catch {
      // Keep the checked local comparison available if the ranking service fails.
    }
  }
  return chooseOffer(item, originals, ranking, options.priority);
}

function chooseOffer(item, products, ranking, priority) {
  const listings = products;
  const warnings = [];
  if (!validQuantity(item.quantity)) warnings.push("Quantity must be a positive safe integer; no price was calculated.");
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
    (priority === "speed" && a.shippingDays !== b.shippingDays
      ? (a.shippingDays ?? Infinity) - (b.shippingDays ?? Infinity)
      : priority === "trusted" && a.trust !== b.trust
      ? (b.trust ?? -1) - (a.trust ?? -1)
      : ranking?.includes(a.id) && ranking?.includes(b.id)
      ? ranking.indexOf(a.id) - ranking.indexOf(b.id)
      : parseCents(a.price, currency) - parseCents(b.price, currency))) : [];
  const best = ranked[0] ?? null;
  const cents = best && validQuantity(item.quantity) ? BigInt(parseCents(best.price, currency)) * BigInt(item.quantity) : null;
  const subtotal = cents !== null && cents <= MAX_MONEY_CENTS ? Number(cents) / 100 : null;
  if (cents !== null && subtotal === null) warnings.push("Merchandise subtotal exceeds the supported safe amount.");
  if (!best) warnings.push("No comparable, explicitly in-stock priced listing is available.");
  if (best?.isMock) warnings.push(...best.warnings);
  warnings.push("Merchandise subtotal excludes shipping and tax; a delivered total is unknown.");
  if (!best?.shippingDate) warnings.push("Shipping date is unknown; shipping duration alone is not a dated promise.");
  if (!best?.estimatedArrival) warnings.push("Arrival date is unknown.");
  return {
    choice: priority === "speed" ? "Shortest reported shipping duration; dates may be unknown"
      : priority === "trusted" ? "Highest available trust score; missing evidence remains unknown"
      : "Lowest comparable merchandise price",
    method: ranking?.length ? "python_weighted_ranking_checked_quote" : "checked_local_merchandise_comparison",
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
    alternatives: [...ranked.slice(1), ...listings.filter((p) => !ranked.includes(p))],
    source: best?.source ?? "no_comparable_listing",
    isMock: best?.isMock ?? listings.some((p) => p.isMock),
    warnings,
  };
}
