import { clientCredentialsToken, rawProduct, requestJson } from "../core.js";

/** eBay Browse API item search. Developer account with an application keyset. */
export default {
  id: "ebay",
  label: "eBay",
  kind: "marketplace",
  requires: ["EBAY_CLIENT_ID", "EBAY_CLIENT_SECRET"],
  async search(query, { env, limit, fetchImpl }) {
    const sandbox = env.EBAY_ENV === "sandbox";
    const host = sandbox ? "https://api.sandbox.ebay.com" : "https://api.ebay.com";
    const token = await clientCredentialsToken({
      tokenUrl: `${host}/identity/v1/oauth2/token`,
      clientId: env.EBAY_CLIENT_ID,
      clientSecret: env.EBAY_CLIENT_SECRET,
      scope: "https://api.ebay.com/oauth/api_scope",
      fetchImpl,
    });
    const params = new URLSearchParams({ q: query, limit: String(limit), filter: "buyingOptions:{FIXED_PRICE},priceCurrency:USD" });
    const body = await requestJson(`${host}/buy/browse/v1/item_summary/search?${params}`, {
      headers: { Authorization: `Bearer ${token}`, "X-EBAY-C-MARKETPLACE-ID": env.EBAY_MARKETPLACE_ID || "EBAY_US" },
      fetchImpl,
    });
    return (body.itemSummaries ?? [])
      .filter((item) => item.price?.currency === "USD")
      .map((item) => {
        const shipping = item.shippingOptions?.[0];
        return rawProduct("ebay", {
          id: item.itemId,
          store: item.seller?.username ? `eBay · ${item.seller.username}` : "eBay",
          title: item.title,
          description: item.shortDescription || item.condition,
          price: item.price.value,
          image: item.image?.imageUrl ?? item.thumbnailImages?.[0]?.imageUrl,
          url: item.itemWebUrl,
          inStock: true,
          estimatedArrival: shipping?.minEstimatedDeliveryDate,
          shippingPrice: shipping?.shippingCost?.currency === "USD" ? shipping.shippingCost.value : null,
          warnings: item.condition && item.condition !== "New" ? [`Condition: ${item.condition}.`] : [],
        });
      });
  },
};
