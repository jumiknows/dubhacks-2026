import { fetchProducts } from "./fetchBot.js";
import { synthesize } from "./synthesizeBot.js";

/**
 * Awaits the fetch-bot promise (a list of products), then the
 * synthesis-bot promise (image, dimensions, ship date, total).
 * Neither bot is implemented here.
 */
export async function attachOffers(items) {
  return Promise.all(
    items.map(async (item) => {
      if (item.purchased || item.synthesis) return item;

      const productsPromise = fetchProducts(item.name);
      const products = await productsPromise;

      const synthesisPromise = synthesize(item, products);
      const synthesis = await synthesisPromise;

      return { ...item, products, synthesis };
    })
  );
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
