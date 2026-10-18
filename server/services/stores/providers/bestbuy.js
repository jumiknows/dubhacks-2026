import { rawProduct, requestJson, queryTerms } from "../core.js";

/** Best Buy Products API. Free key, 50,000 calls/day. https://developer.bestbuy.com */
export default {
  id: "bestbuy",
  label: "Best Buy",
  kind: "retailer",
  requires: ["BESTBUY_API_KEY"],
  async search(query, { env, limit, fetchImpl }) {
    const terms = queryTerms(query);
    if (terms.length === 0) return [];
    const filter = terms.map((term) => `search=${encodeURIComponent(term)}`).join("&");
    const params = new URLSearchParams({
      apiKey: env.BESTBUY_API_KEY,
      format: "json",
      show: "sku,name,salePrice,image,shortDescription,longDescription,url,onlineAvailability,width,height,depth,upc,freeShipping,shippingCost",
      pageSize: String(limit),
      sort: "bestSellingRank.asc",
    });
    const body = await requestJson(`https://api.bestbuy.com/v1/products(${filter})?${params}`, { fetchImpl });
    return (body.products ?? []).map((item) =>
      rawProduct("bestbuy", {
        id: item.sku,
        store: "Best Buy",
        title: item.name,
        description: item.shortDescription || item.longDescription,
        price: item.salePrice,
        image: item.image,
        url: item.url,
        dimensions: [item.width, item.height, item.depth].filter(Boolean).join(" × "),
        inStock: item.onlineAvailability,
        gtin: item.upc,
        shippingPrice: item.freeShipping ? 0 : item.shippingCost,
      }),
    );
  },
};
