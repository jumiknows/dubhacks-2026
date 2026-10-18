/**
 * OWNER: Top list
 * Rank listings that already have bang_per_buck, relevancy, and trust.
 * Returns about ten items (limit is a request field, default 10).
 *
 * TODO: drive the sku "relevant items" reel from this list instead of raw search hits.
 */

import { marketPost } from "./marketClient.js";

export function topItems(items, {
  limit = 10,
  trustFloor = 0.5,
  minPrice,
  maxPrice,
  brandsInclude,
  brandsExclude,
} = {}) {
  return post("/market/top", {
    items,
    limit,
    trust_floor: trustFloor,
    min_price: minPrice,
    max_price: maxPrice,
    brands_include: brandsInclude || [],
    brands_exclude: brandsExclude || [],
  });
}

async function post(path, body) {
  return marketPost(path, body);
}
