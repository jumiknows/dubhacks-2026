import { fetchProducts, toRaw, toValued } from "./fetchBot.js";
import { MAX_MONEY_CENTS, normalizeCurrency, parseCents, synthesize, validDate, validQuantity } from "./synthesizeBot.js";
import { topItems } from "./topItemsBot.js";

export async function attachOffers(items, options = {}) {
  return Promise.all(
    items.map(async (item) => {
      if (item.purchased || item.synthesis) return item;

      const fetched = await fetchProducts(item.name, {
        ...options,
        details: true,
        // Detail scraping is intentionally bounded per component so a large plan
        // stays responsive while still yielding a useful comparison rail.
        limit: options.productLimit ?? 8,
      });
      const shortlist = await shortlistTop(fetched, options);
      const synthesis = await synthesize(item, shortlist);

      // Expose the same sanitized listings used by synthesis, including sources
      // and nulls for unsafe URLs/prices, rather than leaking unvalidated raw data.
      const products = [synthesis.best, ...synthesis.alternatives].filter(Boolean);
      const image = synthesis.image || products.find((product) => product.image)?.image || null;
      return { ...item, products, synthesis, image };
    })
  );
}

async function shortlistTop(products, options) {
  try {
    const result = await topItems(products.map(toValued), {
      limit: options.topLimit ?? 10,
      trustFloor: options.trustFloor ?? 0.5,
      minPrice: options.minPrice,
      maxPrice: options.maxPrice,
      brandsInclude: options.brandsInclude,
      brandsExclude: options.brandsExclude,
    });
    if (result?.items?.length) return result.items.map(toRaw);
  } catch {
    /* Python top endpoint may be down; keep scored search hits. */
  }
  return [...products]
    .sort((a, b) => (b.score || 0) - (a.score || 0))
    .slice(0, options.topLimit ?? 10);
}

export function quotePlan(items) {
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
