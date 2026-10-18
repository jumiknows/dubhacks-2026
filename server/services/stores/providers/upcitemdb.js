import { rawProduct, requestJson } from "../core.js";

/**
 * UPCitemdb product search. The trial endpoint allows 100 requests a day
 * without signup; UPCITEMDB_USER_KEY switches to a paid plan.
 * Offers are merchant prices UPCitemdb last saw, not live quotes.
 */
export default {
  id: "upcitemdb",
  label: "UPCitemdb",
  kind: "lookup",
  requires: [],
  cacheTtlMs: 6 * 60 * 60 * 1000,
  async search(query, { env, limit, fetchImpl }) {
    const paid = Boolean(env.UPCITEMDB_USER_KEY);
    const params = new URLSearchParams({ s: query, match_mode: "0", type: "product" });
    const body = await requestJson(`https://api.upcitemdb.com/prod/${paid ? "v1" : "trial"}/search?${params}`, {
      headers: paid ? { user_key: env.UPCITEMDB_USER_KEY, key_type: "3scale" } : {},
      fetchImpl,
    });
    return (body.items ?? []).slice(0, limit).map((item) => {
      const offer = latestOffer(item.offers);
      const seen = offer?.updated_t ? new Date(offer.updated_t * 1000).toISOString().slice(0, 10) : null;
      return rawProduct("upcitemdb", {
        id: item.ean || item.upc,
        store: offer?.merchant || item.brand || "UPCitemdb",
        title: item.title,
        description: item.description,
        price: offer?.price ?? null,
        image: item.images?.find((url) => url.startsWith("https://")) ?? item.images?.[0],
        url: offer?.link,
        dimensions: item.dimension,
        inStock: offer ? !/out of stock/i.test(offer.availability || "") && (offer.availability ? true : null) : null,
        gtin: item.ean || item.upc,
        warnings: offer ? [`Offer price last seen ${seen ?? "on an unknown date"}; confirm on the merchant site.`] : [],
      });
    });
  },
};

function latestOffer(offers = []) {
  return offers
    .filter((offer) => typeof offer.price === "number" && offer.price > 0 && (!offer.currency || offer.currency === "USD"))
    .sort((a, b) => (b.updated_t ?? 0) - (a.updated_t ?? 0))[0] ?? null;
}
