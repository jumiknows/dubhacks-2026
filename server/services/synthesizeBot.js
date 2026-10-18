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
  // This Planboard contract uses cents. Do not misprice zero/three-decimal currencies.
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

function normalizeListing(raw, index) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const currency = normalizeCurrency(raw.currency);
  const cents = parseCents(raw.price, currency);
  const isMock = raw.isMock === true;
  return {
    id: typeof raw.id === "string" ? raw.id : `listing-${index}`,
    store: typeof raw.store === "string" ? raw.store : "Unknown merchant",
    title: typeof raw.title === "string" ? raw.title : "Untitled listing",
    price: cents === null ? null : cents / 100,
    currency,
    image: safeUrl(raw.image),
    url: safeUrl(raw.url),
    dimensions: typeof raw.dimensions?.label === "string" ? { label: raw.dimensions.label } : null,
    inStock: typeof raw.inStock === "boolean" ? raw.inStock : null,
    shippingDays: Number.isSafeInteger(raw.shippingDays) && raw.shippingDays >= 0 ? raw.shippingDays : null,
    shippingDate: isMock ? null : validDate(raw.shippingDate),
    estimatedArrival: isMock ? null : validDate(raw.estimatedArrival),
    shippingPrice: normalizeCurrency(raw.shippingCurrency) === currency ? centsAmount(raw.shippingPrice, currency) : null,
    tax: normalizeCurrency(raw.taxCurrency) === currency ? centsAmount(raw.tax, currency) : null,
    source: typeof raw.source === "string" ? raw.source : "unverified_source",
    isMock,
    warnings: isMock ? ["Demo listing: price, stock, dimensions and shipping duration are sample data."] : [],
  };
}

function centsAmount(value, currency) {
  const cents = parseCents(value, currency);
  return cents === null ? null : cents / 100;
}

export function synthesize(item, products) {
  return Promise.resolve(chooseOffer(item, products));
}

function chooseOffer(item, products) {
  const listings = (Array.isArray(products) ? products : []).map(normalizeListing).filter(Boolean);
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
    parseCents(a.price, currency) - parseCents(b.price, currency)) : [];
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
