import { clientCredentialsToken, rawProduct, requestJson } from "../core.js";

/**
 * Kroger Products API. Free developer registration (client credentials).
 * Prices and stock only come back when KROGER_LOCATION_ID names a store.
 * https://developer.kroger.com
 */
export default {
  id: "kroger",
  label: "Kroger",
  kind: "retailer",
  requires: ["KROGER_CLIENT_ID", "KROGER_CLIENT_SECRET"],
  async search(query, { env, limit, fetchImpl }) {
    const token = await clientCredentialsToken({
      tokenUrl: "https://api.kroger.com/v1/connect/oauth2/token",
      clientId: env.KROGER_CLIENT_ID,
      clientSecret: env.KROGER_CLIENT_SECRET,
      scope: "product.compact",
      fetchImpl,
    });
    const params = new URLSearchParams({ "filter.term": query, "filter.limit": String(limit) });
    if (env.KROGER_LOCATION_ID) params.set("filter.locationId", env.KROGER_LOCATION_ID);
    const body = await requestJson(`https://api.kroger.com/v1/products?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
      fetchImpl,
    });
    return (body.data ?? []).map((item) => {
      const variant = item.items?.[0] ?? {};
      const price = variant.price?.promo || variant.price?.regular;
      const stock = variant.inventory?.stockLevel;
      return rawProduct("kroger", {
        id: item.productId,
        store: "Kroger",
        title: item.description,
        description: [item.brand, ...(item.categories ?? [])].filter(Boolean).join(" · "),
        price: price > 0 ? price : null,
        image: frontImage(item.images),
        url: item.productPageURI ? `https://www.kroger.com${item.productPageURI}` : null,
        dimensions: variant.size,
        inStock: stock ? stock !== "TEMPORARILY_OUT_OF_STOCK" : null,
        gtin: item.upc,
        warnings: env.KROGER_LOCATION_ID ? ["Price is for one Kroger store location."] : ["Set KROGER_LOCATION_ID for store prices."],
      });
    });
  },
};

function frontImage(images = []) {
  const picture = images.find((image) => image.perspective === "front") ?? images[0];
  const sizes = picture?.sizes ?? [];
  return (sizes.find((size) => size.size === "large") ?? sizes.find((size) => size.size === "medium") ?? sizes[0])?.url ?? null;
}
