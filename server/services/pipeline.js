import { fetchProducts, toRaw, toValued } from "./fetchBot.js";
import { synthesize } from "./synthesizeBot.js";
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
      const image = synthesis?.image || shortlist.find((product) => product.image)?.image || null;

      return { ...item, products: shortlist, synthesis, image };
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
  const prices = open
    .map((item) => item.synthesis?.totalPrice)
    .filter((price) => typeof price === "number");
  const dates = open
    .map((item) => item.synthesis?.shippingDate)
    .filter(Boolean)
    .sort();

  const total = prices.reduce((sum, price) => sum + price, 0);

  return {
    toBuyCount: open.length,
    purchasedCount: items.length - open.length,
    totalPrice: Math.round(total * 100) / 100,
    currency: "USD",
    readyBy: dates.at(-1) || null,
  };
}
