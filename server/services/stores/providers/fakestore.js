import { cached, isRelevant, rawProduct, requestJson } from "../core.js";

/** Fake Store API sample catalog (20 products, no search endpoint). No key. */
export default {
  id: "fakestore",
  label: "Fake Store API (sample data)",
  kind: "sample",
  requires: [],
  async search(query, { limit, fetchImpl }) {
    const all = await cached("fakestore:all", 60 * 60 * 1000, () => requestJson("https://fakestoreapi.com/products", { fetchImpl }));
    return (Array.isArray(all) ? all : [])
      .filter((item) => isRelevant(query, item))
      .slice(0, limit)
      .map((item) =>
        rawProduct("fakestore", {
          id: item.id,
          store: "Fake Store",
          title: item.title,
          description: item.description,
          price: item.price,
          image: item.image,
          isMock: true,
          warnings: ["Sample product from Fake Store API; not a real store listing."],
        }),
      );
  },
};
