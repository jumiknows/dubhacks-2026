import { fetchProducts, toValued } from "./fetchBot.js";
import { topItems } from "./topItemsBot.js";
import { MAX_MONEY_CENTS, normalizeCurrency, parseCents, synthesize, validDate, validQuantity } from "./synthesizeBot.js";

/**
 * Awaits the fetch-bot promise (a list of products), then the
 * synthesis-bot promise (image, dimensions, ship date, total).
 * Neither bot is implemented here.
 */
export async function attachOffers(items, options = {}) {
  return Promise.all(
    items.map(async (item) => {
      if (item.purchased || item.synthesis) return item;

      const fetched = await fetchProducts(item.name, options);
      const products = await shortlistTop(fetched, options);

      const synthesisPromise = synthesize(item, products, options);
      const synthesis = await synthesisPromise;

      // Expose the same sanitized listings used by synthesis, including sources
      // and nulls for unsafe URLs/prices, rather than leaking unvalidated raw data.
      return { ...item, products: [synthesis.best, ...synthesis.alternatives].filter(Boolean), synthesis };
    })
  );
}

async function shortlistTop(products, options) {
  if (!products.length || products.every((product) => product.isMock)) return products;
  try {
    const result = await topItems(products.map(toValued), {
      limit: options.topLimit ?? 10,
      trustFloor: options.trustFloor ?? 0.5,
      minPrice: options.minPrice,
      maxPrice: options.maxPrice,
      brandsInclude: options.brandsInclude,
      brandsExclude: options.brandsExclude,
    });
    // Rank the original listings so upstream defaults never replace provenance,
    // prices, stock or shipping evidence obtained at search time.
    const byId = new Map(products.map((product) => [product.id, product]));
    const ranked = result?.items?.map((product) => byId.get(product.id)).filter(Boolean);
    if (ranked?.length) return ranked;
  } catch {
    // A missing marketplace service leaves the original search results usable.
  }
  return [...products].sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, options.topLimit ?? 10);
}

/** Make one of the item's own listings the offer. Returns null if the id isn't one of them. */
export function pickListing(item, listingId) {
  const listing = (item.products || []).find((product) => product.id === listingId);
  if (!listing) return null;
  const quantity = item.quantity > 0 ? item.quantity : 1;
  const total = typeof listing.price === "number" ? Math.round(listing.price * quantity * 100) / 100 : null;
  return {
    ...item,
    synthesis: {
      ...item.synthesis,
      summary: `${listing.title} from ${listing.store}`,
      image: listing.image,
      dimensions: listing.dimensions,
      totalPrice: total,
      currency: listing.currency || "USD",
      best: listing,
    },
  };
}

export function quotePlan(items, { budgetMax = null } = {}) {
  const open = items.filter((item) => !item.purchased);
  const currencies = new Set(open.map((item) => normalizeCurrency(item.synthesis?.currency)).filter(Boolean));
  const currency = open.length === 0 ? "USD" : currencies.size === 1 ? [...currencies][0] : null;
  let knownCents = 0n;
  let missingPriceCount = 0;
  const warnings = [];
  for (const item of open) {
    const offer = item.synthesis;
    const cents = parseCents(offer?.totalPrice, offer?.currency);
    if (!currency || offer?.currency !== currency || cents === null || !validQuantity(item.quantity)) {
      missingPriceCount++;
    } else {
      knownCents += BigInt(cents);
    }
  }
  const safeAmount = knownCents <= MAX_MONEY_CENTS;
  const subtotalComplete = missingPriceCount === 0 && safeAmount;
  const knownSubtotal = currency && safeAmount ? Number(knownCents) / 100 : null;
  const dates = open.map((item) => item.synthesis?.isMock ? null : validDate(item.synthesis?.estimatedArrival));
  if (missingPriceCount) warnings.push("Some items lack comparable prices; the full merchandise subtotal is unknown.");
  if (!safeAmount) warnings.push("Merchandise subtotal exceeds the supported safe amount.");
  if (currencies.size > 1) warnings.push("Mixed currencies were not added or converted.");
  if (open.length) warnings.push("Merchandise subtotal excludes shipping and tax; the delivered total is unknown.");
  if (dates.some((date) => !date)) warnings.push("An arrival date is missing; ready-by date is unknown.");
  return {
    budgetMax,
    budgetCurrency: "USD",
    overBudget: budgetMax !== null && subtotalComplete && currency === "USD" ? knownSubtotal > budgetMax : null,
    toBuyCount: open.length,
    purchasedCount: items.length - open.length,
    totalPrice: subtotalComplete ? knownSubtotal : null,
    currency,
    readyBy: dates.length && dates.every(Boolean) ? dates.sort().at(-1) : null,
    priceScope: "items_only",
    knownSubtotal,
    missingPriceCount,
    subtotalComplete,
    costComplete: open.length === 0,
    fullTotal: open.length === 0 ? 0 : null,
    isMock: open.some((item) => item.synthesis?.isMock),
    source: "plan_merchandise_quote",
    warnings,
  };
}
