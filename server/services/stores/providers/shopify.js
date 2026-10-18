import { rawProduct, requestJson, storeList } from "../core.js";

/**
 * Shopify Storefront API, one request per configured store. Product queries
 * work tokenless on a store's primary domain. SHOPIFY_STORES is a comma list
 * of domains; add "|token" to a domain to send a Storefront access token.
 */
const QUERY = `query Search($q: String!, $n: Int!) {
  shop { name }
  products(first: $n, query: $q) {
    nodes { id title handle description onlineStoreUrl availableForSale
      featuredImage { url }
      priceRange { minVariantPrice { amount currencyCode } } }
  }
}`;

export default {
  id: "shopify",
  label: "Shopify stores",
  kind: "store",
  requires: ["SHOPIFY_STORES"],
  async search(query, { env, limit, fetchImpl }) {
    const stores = storeList(env.SHOPIFY_STORES);
    const settled = await Promise.allSettled(stores.map(async ({ domain, token }) => {
      const body = await requestJson(`https://${domain}/api/2025-07/graphql.json`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { "X-Shopify-Storefront-Access-Token": token } : {}) },
        body: JSON.stringify({ query: QUERY, variables: { q: query, n: limit } }),
        fetchImpl,
      });
      const shop = body.data?.shop?.name || domain;
      return (body.data?.products?.nodes ?? [])
        .filter((item) => item.priceRange?.minVariantPrice?.currencyCode === "USD")
        .map((item) =>
          rawProduct("shopify", {
            id: `${domain}-${item.handle}`,
            store: shop,
            title: item.title,
            description: item.description,
            price: item.priceRange.minVariantPrice.amount,
            image: item.featuredImage?.url,
            url: item.onlineStoreUrl || `https://${domain}/products/${item.handle}`,
            inStock: item.availableForSale,
          }),
        );
    }));
    return firstErrorOrResults(settled);
  },
};

/** Keep results from stores that answered; throw only if every store failed. */
export function firstErrorOrResults(settled) {
  const ok = settled.filter((result) => result.status === "fulfilled");
  if (ok.length === 0 && settled.length > 0) throw settled[0].reason;
  return ok.flatMap((result) => result.value);
}
