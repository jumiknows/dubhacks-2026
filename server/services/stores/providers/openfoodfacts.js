import { endsWithHead, queryTerms, rawProduct, requestJson, stem } from "../core.js";

/**
 * Open Food Facts search for US food products, priced from Open Prices
 * (community receipts and shelf photos). Both are free and keyless.
 * Prices are what one person paid at one store on one date.
 *
 * Only answers food queries: at least a quarter of the hits must sit in an
 * OFF category named after the item ("en:chicken-breasts" for chicken breast),
 * so "camp stove" does not turn into stuffing mix.
 */
const POOL = 40;

export default {
  id: "openfoodfacts",
  label: "Open Food Facts + Open Prices",
  kind: "lookup",
  requires: [],
  async search(query, { limit, fetchImpl }) {
    const head = queryTerms(query).at(-1);
    if (!head) return [];
    const params = new URLSearchParams({
      q: `${query} countries_tags:"en:united-states"`,
      page_size: String(POOL),
      fields: "code,product_name,brands,image_front_url,quantity,generic_name,categories_tags",
    });
    const found = await requestJson(`https://search.openfoodfacts.org/search?${params}`, { fetchImpl });
    const all = (found.hits ?? []).filter((hit) => hit.code && hit.product_name);
    const inCategory = all.filter((hit) => (hit.categories_tags ?? []).some((tag) => stem(tag.split(":").pop().split("-").pop()) === stem(head)));
    if (inCategory.length === 0 || inCategory.length < all.length / 4) return [];

    const priceParams = new URLSearchParams({
      product_code__in: inCategory.map((hit) => hit.code).join(","),
      currency: "USD",
      order_by: "-date",
      size: "100",
    });
    const prices = await requestJson(`https://prices.openfoodfacts.org/api/v1/prices?${priceParams}`, { fetchImpl })
      .then((body) => body.items ?? [])
      .catch(() => []);
    const latest = new Map();
    for (const price of prices) {
      const code = price.product?.code ?? price.product_code;
      if (code && !latest.has(code) && price.price_per !== "KILOGRAM") latest.set(code, price);
    }

    const score = (hit) => 2 * Number(endsWithHead(query, hit.product_name)) + Number(latest.has(hit.code));
    return inCategory
      .sort((a, b) => score(b) - score(a))
      .slice(0, limit)
      .map((hit) => {
        const price = latest.get(hit.code);
        const place = price?.location?.osm_brand || price?.location?.osm_name;
        return rawProduct("openfoodfacts", {
          id: hit.code,
          store: place || "Open Food Facts",
          title: [brandOf(hit.brands), hit.product_name].filter(Boolean).join(" "),
          description: hit.generic_name,
          price: price?.price ?? null,
          image: hit.image_front_url,
          url: `https://world.openfoodfacts.org/product/${hit.code}`,
          dimensions: hit.quantity,
          gtin: hit.code,
          warnings: price
            ? [`Community-reported price from ${price.date}${place ? ` at ${place}` : ""}.`]
            : ["No reported US price for this product yet."],
        });
      });
  },
};

function brandOf(brands) {
  const first = Array.isArray(brands) ? brands[0] : String(brands || "").split(",")[0];
  return first?.trim() || null;
}
