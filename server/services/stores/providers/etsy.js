import { rawProduct, requestJson } from "../core.js";

/**
 * Etsy Open API v3, active listings search. ETSY_API_KEY is the value Etsy
 * expects in the x-api-key header (keystring, or keystring:shared_secret on
 * newer apps). https://developers.etsy.com/documentation
 */
export default {
  id: "etsy",
  label: "Etsy",
  kind: "marketplace",
  requires: ["ETSY_API_KEY"],
  async search(query, { env, limit, fetchImpl }) {
    const params = new URLSearchParams({ keywords: query, limit: String(limit), includes: "Images", sort_on: "score" });
    const body = await requestJson(`https://openapi.etsy.com/v3/application/listings/active?${params}`, {
      headers: { "x-api-key": env.ETSY_API_KEY },
      fetchImpl,
    });
    return (body.results ?? [])
      .filter((item) => item.price?.currency_code === "USD")
      .map((item) =>
        rawProduct("etsy", {
          id: item.listing_id,
          store: "Etsy",
          title: item.title,
          description: item.description,
          price: item.price.amount / (item.price.divisor || 100),
          image: item.images?.[0]?.url_570xN,
          url: item.url,
          inStock: item.quantity > 0,
          warnings: ["Sold by an independent Etsy seller."],
        }),
      );
  },
};
