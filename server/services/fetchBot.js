/**
 * OWNER: Fetch bot
 * STATUS: Live. Searches two sources in parallel and merges what they return:
 *   - Python marketplace service: POST {PYTHON_API_URL}/market/search
 *       { query, marketplaces, limit: 8, details: true }
 *   - every configured store API (services/stores/), including the sample
 *     stores DummyJSON and Fake Store that mock checkout can place orders with
 * Falls back to the mock catalog below when neither returns a match.
 *
 * Store listings also carry description, source, isMock, warnings and gtin
 * (see services/stores/core.js). Set STORES_LIVE=false to skip the store APIs.
 */
import { searchStores } from "./stores/index.js";

import { marketPost } from "./marketClient.js";
const MARKETS = (process.env.MARKETPLACES || "amazon,ebay,walmart")
  .split(",")
  .map((name) => name.trim())
  .filter(Boolean);

export async function fetchProducts(query, options = {}) {
  const [market, stores] = await Promise.all([searchPython(query, options), searchStoreApis(query)]);
  const live = [...(market || []), ...stores];
  const real = live.filter((product) => !product.isMock);
  if (real.length) return real;
  if (live.length) return live;
  return searchCatalog(query);
}

async function searchStoreApis(query) {
  if (process.env.STORES_LIVE === "false") return [];
  try {
    const { products } = await searchStores(query);
    return products.map(toRaw);
  } catch (err) {
    console.error("[fetchBot] store search failed:", err);
    return [];
  }
}

async function searchPython(query, options) {
  try {
    const body = await marketPost("/market/search", {
      query,
      marketplaces: options.marketplaces || MARKETS,
      limit: options.limit ?? 8,
      details: options.details !== false,
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
    image: resolveImage(product.image),
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
    bang_per_buck: product.bang_per_buck ?? null,
    relevancy: product.relevancy ?? null,
    trust: product.trust ?? null,
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
    description: product.description ?? null,
    gtin: product.gtin ?? null,
  };
}

function resolveImage(image) {
  if (typeof image !== "string" || !image) return null;
  if (/^\/static\/products\/[A-Za-z0-9_-][A-Za-z0-9_.-]*\.(?:png|jpe?g|webp|gif|svg)$/i.test(image)) return `/api/conjure${image}`;
  return image;
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
  // Travel: two stores per item so a comparison is always possible offline.
  listing({ keyword: "suitcase", store: "Amazon", title: "Samsonite Freeform 21\" Carry-On Spinner", price: 149, dimensions: "21 × 15 × 10 in", shippingDays: 2, url: "https://www.amazon.com/s?k=carry-on+suitcase", brand: "Samsonite" }),
  listing({ keyword: "suitcase", store: "Target", title: "Open Story 20\" Hardside Carry-On", price: 89, dimensions: "20 × 14 × 9 in", shippingDays: 5, url: "https://www.target.com/s?searchTerm=carry-on+suitcase", brand: "Open Story" }),
  listing({ keyword: "packing cube", store: "Amazon", title: "BAGSMART Packing Cubes, 6 Set", price: 24, dimensions: "6 pieces", shippingDays: 2, url: "https://www.amazon.com/s?k=packing+cubes", brand: "BAGSMART" }),
  listing({ keyword: "packing cube", store: "REI", title: "Eagle Creek Pack-It Starter Set", price: 45, dimensions: "3 pieces", shippingDays: 4, url: "https://www.rei.com/search?q=packing+cubes", brand: "Eagle Creek" }),
  listing({ keyword: "travel adapter", store: "Amazon", title: "EPICKA Universal Travel Adapter", price: 22, dimensions: "3 × 2 in", shippingDays: 2, url: "https://www.amazon.com/s?k=universal+travel+adapter", brand: "EPICKA" }),
  listing({ keyword: "travel adapter", store: "Best Buy", title: "Insignia Worldwide Travel Adapter", price: 30, dimensions: "3 × 2 in", shippingDays: 3, url: "https://www.bestbuy.com/site/searchpage.jsp?st=travel+adapter", brand: "Insignia" }),
  listing({ keyword: "portable charger", store: "Best Buy", title: "Anker PowerCore 20,000 mAh", price: 50, dimensions: "6 × 2.9 in", shippingDays: 3, url: "https://www.bestbuy.com/site/searchpage.jsp?st=portable+charger", brand: "Anker" }),
  listing({ keyword: "portable charger", store: "Walmart", title: "onn. 10,000 mAh Power Bank", price: 15, dimensions: "5.6 × 2.8 in", shippingDays: 4, url: "https://www.walmart.com/search?q=portable+charger", brand: "onn." }),
  listing({ keyword: "headphones", store: "Amazon", title: "Soundcore Space Q45 Noise Cancelling", price: 99, dimensions: "Over-ear", shippingDays: 2, url: "https://www.amazon.com/s?k=noise+cancelling+headphones", brand: "Soundcore" }),
  listing({ keyword: "headphones", store: "Best Buy", title: "Bose QuietComfort Headphones", price: 299, dimensions: "Over-ear", shippingDays: 3, url: "https://www.bestbuy.com/site/searchpage.jsp?st=noise+cancelling+headphones", brand: "Bose" }),
  listing({ keyword: "neck pillow", store: "Amazon", title: "Cabeau Evolution S3 Travel Pillow", price: 40, dimensions: "Memory foam", shippingDays: 2, url: "https://www.amazon.com/s?k=travel+neck+pillow", brand: "Cabeau" }),
  listing({ keyword: "neck pillow", store: "Target", title: "Open Story Memory Foam Neck Pillow", price: 15, dimensions: "Memory foam", shippingDays: 5, url: "https://www.target.com/s?searchTerm=neck+pillow", brand: "Open Story" }),
  listing({ keyword: "toiletry", store: "Amazon", title: "BAGSMART Hanging Toiletry Bag", price: 20, dimensions: "10 × 7 in", shippingDays: 2, url: "https://www.amazon.com/s?k=toiletry+bag", brand: "BAGSMART" }),
  listing({ keyword: "toiletry", store: "Target", title: "Open Story Clear Toiletry Bag", price: 12, dimensions: "TSA quart size", shippingDays: 5, url: "https://www.target.com/s?searchTerm=toiletry+bag", brand: "Open Story" }),
  listing({ keyword: "passport", store: "Amazon", title: "Zoppen RFID Passport Wallet", price: 13, dimensions: "9 × 5 in", shippingDays: 2, url: "https://www.amazon.com/s?k=passport+wallet", brand: "Zoppen" }),
  listing({ keyword: "passport", store: "REI", title: "Eagle Creek RFID Passport Wallet", price: 25, dimensions: "5.5 × 4 in", shippingDays: 4, url: "https://www.rei.com/search?q=passport+wallet", brand: "Eagle Creek" }),
];
