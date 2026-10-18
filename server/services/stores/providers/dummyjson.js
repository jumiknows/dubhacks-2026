import { rawProduct, requestJson, shippingDaysFromText } from "../core.js";

/** DummyJSON sample catalog. No key. Prices and stock are sample data. */
export default {
  id: "dummyjson",
  label: "DummyJSON (sample data)",
  kind: "sample",
  requires: [],
  async search(query, { limit, fetchImpl }) {
    const params = new URLSearchParams({ q: query, limit: String(limit) });
    const body = await requestJson(`https://dummyjson.com/products/search?${params}`, { fetchImpl });
    return (body.products ?? []).map((item) => {
      const size = item.dimensions;
      return rawProduct("dummyjson", {
        id: item.id,
        store: "DummyJSON",
        title: item.title,
        description: item.description,
        price: item.price,
        image: item.thumbnail || item.images?.[0],
        dimensions: size ? `${size.width} × ${size.height} × ${size.depth} cm` : null,
        shippingDays: shippingDaysFromText(item.shippingInformation),
        inStock: item.availabilityStatus ? item.availabilityStatus !== "Out of Stock" : item.stock > 0,
        isMock: true,
        warnings: ["Sample product from DummyJSON; not a real store listing."],
      });
    });
  },
};
