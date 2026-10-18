import { rawProduct, requestJson, storeList } from "../core.js";
import { firstErrorOrResults } from "./shopify.js";

/**
 * WooCommerce Store API. Public product endpoints need no key.
 * WOOCOMMERCE_STORES is a comma list of store domains.
 */
export default {
  id: "woocommerce",
  label: "WooCommerce stores",
  kind: "store",
  requires: ["WOOCOMMERCE_STORES"],
  async search(query, { env, limit, fetchImpl }) {
    const stores = storeList(env.WOOCOMMERCE_STORES);
    const settled = await Promise.allSettled(stores.map(async ({ domain }) => {
      const params = new URLSearchParams({ search: query, per_page: String(limit) });
      const items = await requestJson(`https://${domain}/wp-json/wc/store/v1/products?${params}`, { fetchImpl });
      return (Array.isArray(items) ? items : [])
        .filter((item) => item.prices?.currency_code === "USD")
        .map((item) =>
          rawProduct("woocommerce", {
            id: `${domain}-${item.id}`,
            store: domain.replace(/^www\./, ""),
            title: item.name,
            description: item.short_description || item.description,
            price: Number(item.prices.price) / 10 ** (item.prices.currency_minor_unit ?? 2),
            image: item.images?.[0]?.src,
            url: item.permalink,
            inStock: item.is_in_stock,
            gtin: item.sku && /^\d{8,14}$/.test(item.sku) ? item.sku : null,
          }),
        );
    }));
    return firstErrorOrResults(settled);
  },
};
