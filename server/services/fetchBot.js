/**
 * OWNER: Fetch bot
 * STATUS: Stub. Returns a Promise of products for one query.
 *
 * Replace searchCatalog() with trusted-store API calls (REI, Target,
 * Walmart, Costco, or whichever stores you settle on). Keep the
 * RawProduct shape so synthesizeBot.js does not need to change.
 *
 * RawProduct:
 *   { id, store, title, price, currency, image, url,
 *     dimensions, shippingDays, inStock }
 *   price: number | null          USD for one unit of the plan item
 *   image: absolute URL | null
 *   dimensions: { label: string } | null
 *   shippingDays: number | null
 */

export function fetchProducts(query) {
  const products = searchCatalog(query);
  return Promise.resolve(products);
}

function searchCatalog(query) {
  const q = String(query || "").toLowerCase();
  const hits = CATALOG.filter((product) =>
    product.keywords.some((keyword) => q.includes(keyword))
  );

  if (hits.length === 0) {
    return [unlisted(query)];
  }

  return hits.map(({ keywords, ...product }) => product);
}

function unlisted(query) {
  const name = String(query || "Item").trim() || "Item";
  return {
    id: `unlisted-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    store: "No listing",
    title: name,
    price: null,
    currency: "USD",
    image: null,
    url: null,
    dimensions: null,
    shippingDays: null,
    inStock: false,
  };
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
}) {
  return {
    id: `${store}-${keyword}`.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    keywords: [keyword],
    store,
    title,
    price,
    currency: "USD",
    image: null,
    url,
    dimensions: dimensions ? { label: dimensions } : null,
    shippingDays,
    inStock,
  };
}

// MOCK CATALOG — delete once searchCatalog() calls store APIs.
// Keywords must appear inside the plan item names in planner.js.
const CATALOG = [
  listing({ keyword: "tent", store: "REI", title: "Half Dome 2-Person Tent", price: 189, dimensions: "Packed 7 × 22 in", shippingDays: 3, url: "https://www.rei.com/search?q=2+person+tent" }),
  listing({ keyword: "tent", store: "Target", title: "Coleman Sundome Tent", price: 79, dimensions: "Packed 8 × 24 in", shippingDays: 5, url: "https://www.target.com/s?searchTerm=tent" }),
  listing({ keyword: "sleeping bag", store: "REI", title: "Kelty Cosmic 20", price: 99, dimensions: "84 × 30 in", shippingDays: 4, url: "https://www.rei.com/search?q=sleeping+bag" }),
  listing({ keyword: "sleeping bag", store: "Walmart", title: "Ozark Trail 40° Bag", price: 25, dimensions: "82 × 30 in", shippingDays: 2, url: "https://www.walmart.com/search?q=sleeping+bag" }),
  listing({ keyword: "sleeping pad", store: "REI", title: "Switchback Foam Pad", price: 55, dimensions: "Rolled 20 × 5 in", shippingDays: 3, url: "https://www.rei.com/search?q=sleeping+pad" }),
  listing({ keyword: "sleeping pad", store: "Target", title: "Camp Pad", price: 30, dimensions: "72 × 20 in", shippingDays: 6, url: "https://www.target.com/s?searchTerm=sleeping+pad" }),
  listing({ keyword: "camp stove", store: "REI", title: "PocketRocket Stove", price: 45, dimensions: "2 × 3 in", shippingDays: 3, url: "https://www.rei.com/search?q=camp+stove" }),
  listing({ keyword: "camp stove", store: "Walmart", title: "Single Burner Stove", price: 22, dimensions: "4 × 4 × 3 in", shippingDays: 4, url: "https://www.walmart.com/search?q=camp+stove" }),
  listing({ keyword: "headlamp", store: "REI", title: "Spot 400 Headlamp", price: 40, dimensions: "2.6 × 1.6 in", shippingDays: 3, url: "https://www.rei.com/search?q=headlamp" }),
  listing({ keyword: "headlamp", store: "Target", title: "LED Headlamp", price: 12, dimensions: "2 × 1.5 in", shippingDays: 2, url: "https://www.target.com/s?searchTerm=headlamp" }),
  listing({ keyword: "water filter", store: "REI", title: "Squeeze Water Filter", price: 45, dimensions: "6 in", shippingDays: 3, url: "https://www.rei.com/search?q=water+filter" }),
  listing({ keyword: "water filter", store: "Walmart", title: "Pump Water Filter", price: 28, dimensions: "7 in", shippingDays: 5, url: "https://www.walmart.com/search?q=water+filter" }),
  listing({ keyword: "first aid", store: "Target", title: "100-Piece First Aid Kit", price: 15, dimensions: "7 × 5 × 2 in", shippingDays: 2, url: "https://www.target.com/s?searchTerm=first+aid+kit" }),
  listing({ keyword: "first aid", store: "Walmart", title: "Compact First Aid Kit", price: 9, dimensions: "6 × 4 × 2 in", shippingDays: 3, url: "https://www.walmart.com/search?q=first+aid+kit" }),
  listing({ keyword: "cooler", store: "Target", title: "16-Can Cooler", price: 30, dimensions: "16 × 11 × 10 in", shippingDays: 4, url: "https://www.target.com/s?searchTerm=cooler" }),
  listing({ keyword: "cooler", store: "Walmart", title: "Wheeled Cooler", price: 48, dimensions: "24 × 15 × 16 in", shippingDays: 5, url: "https://www.walmart.com/search?q=cooler" }),

  listing({ keyword: "invitation", store: "Target", title: "Invitation Set", price: 18, dimensions: "5 × 7 in", shippingDays: 6, url: "https://www.target.com/s?searchTerm=wedding+invitations" }),
  listing({ keyword: "invitation", store: "Walmart", title: "Invitation Kit", price: 12, dimensions: "5 × 7 in", shippingDays: 4, url: "https://www.walmart.com/search?q=wedding+invitations" }),
  listing({ keyword: "bouquet", store: "Target", title: "Mixed Bouquet", price: 45, dimensions: "12 in tall", shippingDays: 2, url: "https://www.target.com/s?searchTerm=bouquet" }),
  listing({ keyword: "bouquet", store: "Costco", title: "Seasonal Bouquet", price: 32, dimensions: "14 in tall", shippingDays: 2, url: "https://www.costco.com/CatalogSearch?keyword=bouquet" }),
  listing({ keyword: "cake", store: "Costco", title: "Sheet Cake", price: 28, dimensions: "12 × 16 in", shippingDays: 2, url: "https://www.costco.com/CatalogSearch?keyword=cake" }),
  listing({ keyword: "cake", store: "Target", title: "Celebration Cake", price: 35, dimensions: "8 in round", shippingDays: 1, url: "https://www.target.com/s?searchTerm=cake" }),
  listing({ keyword: "wedding band", store: "Target", title: "Plain Band", price: 80, dimensions: "Sized to order", shippingDays: 7, url: "https://www.target.com/s?searchTerm=wedding+band" }),
  listing({ keyword: "wedding band", store: "Walmart", title: "Classic Band", price: 55, dimensions: "Sized to order", shippingDays: 6, url: "https://www.walmart.com/search?q=wedding+band" }),
  listing({ keyword: "suit", store: "Target", title: "Suit Separates", price: 120, dimensions: "See size chart", shippingDays: 6, url: "https://www.target.com/s?searchTerm=suit" }),
  listing({ keyword: "suit", store: "Walmart", title: "Suit Jacket", price: 70, dimensions: "See size chart", shippingDays: 5, url: "https://www.walmart.com/search?q=suit" }),
  listing({ keyword: "photo", store: "Target", title: "Photo Session Package", price: 250, dimensions: "Digital delivery", shippingDays: 7, url: "https://www.target.com/s?searchTerm=photo+session" }),
  listing({ keyword: "photo", store: "Costco", title: "Portrait Session", price: 180, dimensions: "Digital delivery", shippingDays: 7, url: "https://www.costco.com/CatalogSearch?keyword=photo" }),
  listing({ keyword: "string light", store: "Target", title: "20-ft String Lights", price: 16, dimensions: "20 ft", shippingDays: 3, url: "https://www.target.com/s?searchTerm=string+lights" }),
  listing({ keyword: "string light", store: "Walmart", title: "Outdoor String Lights", price: 12, dimensions: "25 ft", shippingDays: 4, url: "https://www.walmart.com/search?q=string+lights" }),
  listing({ keyword: "guest book", store: "Target", title: "Guest Book", price: 18, dimensions: "8 × 6 in", shippingDays: 4, url: "https://www.target.com/s?searchTerm=guest+book" }),
  listing({ keyword: "guest book", store: "Walmart", title: "Wedding Guest Book", price: 14, dimensions: "9 × 7 in", shippingDays: 3, url: "https://www.walmart.com/search?q=guest+book" }),

  listing({ keyword: "milk", store: "Target", title: "Whole Milk", price: 3.49, dimensions: "1 gal", shippingDays: 1, url: "https://www.target.com/s?searchTerm=milk" }),
  listing({ keyword: "milk", store: "Walmart", title: "Whole Milk", price: 3.19, dimensions: "1 gal", shippingDays: 1, url: "https://www.walmart.com/search?q=milk" }),
  listing({ keyword: "eggs", store: "Target", title: "Large Eggs", price: 3.29, dimensions: "1 dozen", shippingDays: 1, url: "https://www.target.com/s?searchTerm=eggs" }),
  listing({ keyword: "eggs", store: "Walmart", title: "Large Eggs", price: 2.84, dimensions: "1 dozen", shippingDays: 1, url: "https://www.walmart.com/search?q=eggs" }),
  listing({ keyword: "bread", store: "Target", title: "Sandwich Bread", price: 2.49, dimensions: "20 oz loaf", shippingDays: 1, url: "https://www.target.com/s?searchTerm=bread" }),
  listing({ keyword: "bread", store: "Walmart", title: "White Bread", price: 1.47, dimensions: "20 oz loaf", shippingDays: 1, url: "https://www.walmart.com/search?q=bread" }),
  listing({ keyword: "chicken", store: "Costco", title: "Chicken Breast", price: 4.99, dimensions: "per lb", shippingDays: 2, url: "https://www.costco.com/CatalogSearch?keyword=chicken" }),
  listing({ keyword: "chicken", store: "Walmart", title: "Chicken Breast", price: 3.48, dimensions: "per lb", shippingDays: 1, url: "https://www.walmart.com/search?q=chicken+breast", inStock: false }),
  listing({ keyword: "vegetable", store: "Target", title: "Mixed Vegetables", price: 1.79, dimensions: "12 oz bag", shippingDays: 1, url: "https://www.target.com/s?searchTerm=mixed+vegetables" }),
  listing({ keyword: "vegetable", store: "Walmart", title: "Mixed Vegetables", price: 1.48, dimensions: "12 oz bag", shippingDays: 1, url: "https://www.walmart.com/search?q=mixed+vegetables" }),
  listing({ keyword: "banana", store: "Target", title: "Bananas", price: 0.69, dimensions: "per lb", shippingDays: 1, url: "https://www.target.com/s?searchTerm=bananas" }),
  listing({ keyword: "banana", store: "Walmart", title: "Bananas", price: 0.56, dimensions: "per lb", shippingDays: 1, url: "https://www.walmart.com/search?q=bananas" }),
  listing({ keyword: "coffee", store: "Target", title: "Ground Coffee", price: 7.99, dimensions: "12 oz", shippingDays: 2, url: "https://www.target.com/s?searchTerm=coffee" }),
  listing({ keyword: "coffee", store: "Costco", title: "Coffee", price: 12.49, dimensions: "2 lb", shippingDays: 3, url: "https://www.costco.com/CatalogSearch?keyword=coffee" }),
  listing({ keyword: "pasta", store: "Target", title: "Spaghetti", price: 1.29, dimensions: "16 oz", shippingDays: 1, url: "https://www.target.com/s?searchTerm=pasta" }),
  listing({ keyword: "pasta", store: "Walmart", title: "Spaghetti", price: 0.98, dimensions: "16 oz", shippingDays: 1, url: "https://www.walmart.com/search?q=pasta" }),
];
