/**
 * OWNER: Top list
 * Rank listings that already have bang_per_buck, relevancy, and trust.
 * Returns about ten items (limit is a request field, default 10).
 *
 * TODO: drive the sku "relevant items" reel from this list instead of raw search hits.
 */

const PYTHON_API = process.env.PYTHON_API_URL || "http://localhost:8000";

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
  const response = await fetch(`${PYTHON_API}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || data.detail || `Top list failed (${response.status})`);
  }
  return data;
}
