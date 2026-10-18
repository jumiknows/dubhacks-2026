/**
 * OWNER: Fetch bot
 * STATUS: Calls the Python marketplace service, then falls back to the mock catalog.
 *
 * POST {PYTHON_API_URL}/market/search
 *   { query, marketplaces, limit: 50, details: false }
 */

import { marketPost } from "./marketClient.js";
const MARKETS = (process.env.MARKETPLACES || "amazon,ebay,walmart")
  .split(",")
  .map((name) => name.trim())
  .filter(Boolean);

export async function fetchProducts(query, options = {}) {
  const live = await searchPython(query, options);
  if (live?.length) return live;
  return searchCatalog(query);
}

async function searchPython(query, options) {
  try {
    const body = await marketPost("/market/search", {
      query,
      marketplaces: options.marketplaces || MARKETS,
      limit: options.limit ?? 50,
      details: options.details === true,
      min_price: options.minPrice ?? options.min_price,
      max_price: options.maxPrice ?? options.max_price,
      brands_include: options.brandsInclude || options.brands_include || [],
      brands_exclude: options.brandsExclude || options.brands_exclude || [],
    });
    if (!Array.isArray(body.products)) return null;
    return body.products.map((product) => toRaw({
      ...product,
      source: body.source === "fixture" ? "demo_catalog" : body.source === "selenium" ? "selenium" : "unverified_source",
      isMock: body.source === "fixture",
      warnings: body.errors || [],
    }));
  } catch {
    return null;
  }
}

export function toRaw(product) {
  const inStock = product.in_stock ?? product.inStock ?? null;
  const shippingDays = product.shipping_days ?? product.shippingDays ?? null;
  return {
    id: product.id,
    store: product.store,
    title: product.title,
    price: product.price,
    currency: product.currency ?? null,
    image: product.image,
    url: product.url,
    dimensions: product.dimensions,
    shippingDays,
    shipping_days: shippingDays,
    inStock,
    in_stock: inStock,
    rating: product.rating ?? null,
    reviewCount: product.review_count ?? product.reviewCount ?? 0,
    review_count: product.review_count ?? product.reviewCount ?? 0,
    seller: product.seller ?? null,
    seller_rating: product.seller_rating ?? product.sellerRating ?? null,
    condition: product.condition || "new",
    marketplace: product.marketplace,
    brand: product.brand ?? null,
    specs: product.specs || {},
    history: product.history ?? null,
    asin: product.asin ?? null,
    walmart_id: product.walmart_id ?? product.walmartId ?? null,
    ebay_id: product.ebay_id ?? null,
    query: product.query || "",
    prime: product.prime ?? false,
    coupon: product.coupon || 0,
    shipping_fee: product.shipping_fee || 0,
    bang_per_buck: product.bang_per_buck ?? 0.5,
    relevancy: product.relevancy ?? 1,
    trust: product.trust ?? 0.5,
    initial_value: product.initial_value ?? null,
    trust_multiplier: product.trust_multiplier ?? null,
    score: product.score ?? null,
    flags: product.flags || [],
    source: product.source || "unverified_source",
    isMock: product.isMock === true,
    warnings: Array.isArray(product.warnings) ? product.warnings : [],
    shippingDate: product.shippingDate ?? product.shipping_date ?? null,
    estimatedArrival: product.estimatedArrival ?? product.estimated_arrival ?? null,
    shippingPrice: product.shippingPrice ?? null,
    shippingCurrency: product.shippingCurrency ?? null,
    tax: product.tax ?? null,
    taxCurrency: product.taxCurrency ?? null,
  };
}

export function toValued(product) {
  const raw = toRaw(product);
  return {
    id: raw.id,
    title: raw.title,
    store: raw.store,
    url: raw.url,
    price: raw.price,
    in_stock: raw.in_stock,
    bang_per_buck: raw.bang_per_buck,
    relevancy: raw.relevancy,
    trust: raw.trust,
    flags: raw.flags,
    brand: raw.brand,
    specs: raw.specs,
    marketplace: raw.marketplace,
    history: raw.history,
    condition: raw.condition,
    rating: raw.rating,
    review_count: raw.review_count,
    prime: raw.prime,
    shipping_days: raw.shipping_days,
    image: raw.image,
    currency: raw.currency,
    asin: raw.asin,
    walmart_id: raw.walmart_id,
    ebay_id: raw.ebay_id,
    query: raw.query,
    dimensions: raw.dimensions,
    seller: raw.seller,
    seller_rating: raw.seller_rating,
    coupon: raw.coupon,
    shipping_fee: raw.shipping_fee,
    initial_value: raw.initial_value,
    trust_multiplier: raw.trust_multiplier,
    score: raw.score,
  };
}

function searchCatalog(query) {
  const q = String(query || "").toLowerCase();
  const hits = CATALOG.filter((product) =>
    product.keywords.some((keyword) => q.includes(keyword))
  );
  if (hits.length === 0) return [unlisted(query)];
  return hits.map(({ keywords, ...product }) => toRaw(product));
}

function unlisted(query) {
  const name = String(query || "Item").trim() || "Item";
  return toRaw({
    id: `unlisted-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    store: "No listing",
    title: name,
    price: null,
    currency: "USD",
    source: "demo_catalog",
    isMock: true,
    warnings: ["No demo listing matches this query; no live store lookup was performed."],
    in_stock: false,
    bang_per_buck: 0.35,
    relevancy: 0.4,
    trust: 0.2,
  });
}

function listing({
  keyword,
  store,
  title,
  price,
  dimensions,
  shippingDays,
  url,
  inStock = true,
  brand,
}) {
  return {
    id: `${store}-${keyword}`.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    keywords: [keyword],
    store,
    title,
    brand: brand || store,
    price,
    currency: "USD",
    image: null,
    url,
    dimensions: dimensions ? { label: dimensions } : null,
    shipping_days: shippingDays,
    in_stock: inStock,
    source: "demo_catalog",
    isMock: true,
    warnings: ["Sample listing; price, stock, dimensions and shipping duration are not live merchant data."],
    bang_per_buck: 0.55,
    relevancy: 0.8,
    trust: 0.7,
    marketplace: "amazon",
  };
}

const CATALOG = [
  listing({ keyword: "tent", store: "REI", title: "Half Dome 2-Person Tent", price: 189, dimensions: "Packed 7 × 22 in", shippingDays: 3, url: "https://www.rei.com/search?q=2+person+tent", brand: "REI" }),
  listing({ keyword: "tent", store: "Target", title: "Coleman Sundome Tent", price: 79, dimensions: "Packed 8 × 24 in", shippingDays: 5, url: "https://www.target.com/s?searchTerm=tent", brand: "Coleman" }),
  listing({ keyword: "sleeping bag", store: "REI", title: "Kelty Cosmic 20", price: 99, dimensions: "84 × 30 in", shippingDays: 4, url: "https://www.rei.com/search?q=sleeping+bag", brand: "Kelty" }),
  listing({ keyword: "sleeping pad", store: "REI", title: "Therm-a-Rest Z Lite", price: 55, dimensions: "20 × 5 in", shippingDays: 4, url: "https://www.rei.com/search?q=sleeping+pad", brand: "Therm-a-Rest" }),
  listing({ keyword: "stove", store: "REI", title: "MSR PocketRocket", price: 45, dimensions: "4 × 2 in", shippingDays: 3, url: "https://www.rei.com/search?q=camp+stove", brand: "MSR" }),
  listing({ keyword: "headlamp", store: "REI", title: "Petzl Actik", price: 40, dimensions: "3 × 2 in", shippingDays: 3, url: "https://www.rei.com/search?q=headlamp", brand: "Petzl" }),
  listing({ keyword: "water filter", store: "REI", title: "Sawyer Squeeze", price: 45, dimensions: "6 × 2 in", shippingDays: 4, url: "https://www.rei.com/search?q=water+filter", brand: "Sawyer" }),
  listing({ keyword: "first aid", store: "Target", title: "Adventure Medical Kit", price: 15, dimensions: "8 × 5 in", shippingDays: 5, url: "https://www.target.com/s?searchTerm=first+aid", brand: "Adventure Medical" }),
  listing({ keyword: "cooler", store: "Walmart", title: "Igloo Island Breeze", price: 30, dimensions: "16 can", shippingDays: 4, url: "https://www.walmart.com/search?q=cooler", brand: "Igloo" }),
  listing({ keyword: "laptop", store: "Best Buy", title: "14-inch Laptop", price: 699, dimensions: "12.4 × 8.9 in", shippingDays: 3, url: "https://www.bestbuy.com/site/searchpage.jsp?st=laptop", brand: "Lenovo" }),
];
