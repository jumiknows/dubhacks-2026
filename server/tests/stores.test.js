import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { clearCache, clearTokens, isRelevant, shippingDaysFromText, storeList } from "../services/stores/core.js";
import { resetStoreState, searchStores, storeStatus } from "../services/stores/index.js";

/** fetch stand-in: the first route whose pattern matches the URL answers. */
function fakeFetch(routes, calls = []) {
  return async (url, init = {}) => {
    calls.push({ url: String(url), init });
    const route = routes.find(([pattern]) => pattern.test(String(url)));
    if (!route) return new Response("not found", { status: 404 });
    const [, body, status = 200, headers = {}] = route;
    const value = typeof body === "function" ? body(String(url), init) : body;
    return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json", ...headers } });
  };
}

const ONLY = (...ids) => ({
  STORES_DISABLED: ["bestbuy", "kroger", "etsy", "ebay", "woocommerce", "shopify", "upcitemdb", "openfoodfacts", "dummyjson", "fakestore"]
    .filter((id) => !ids.includes(id)).join(","),
  STORES_SAMPLE_DATA: "always",
});

afterEach(() => {
  clearCache();
  clearTokens();
  resetStoreState();
});

describe("adapters", () => {
  it("Best Buy maps price, stock, dimensions and shipping", async () => {
    const calls = [];
    const fetchImpl = fakeFetch([[/api\.bestbuy\.com/, { products: [{
      sku: 123, name: "Black Diamond Headlamp", salePrice: 39.99, image: "http://pisces.bbystatic.com/a.jpg",
      shortDescription: "<p>300 lumens</p>", url: "https://www.bestbuy.com/site/123", onlineAvailability: true,
      width: "2 inches", height: "1 inches", upc: "0123", freeShipping: true,
    }] }]], calls);
    const { products } = await searchStores("Headlamp", { env: { ...ONLY("bestbuy"), BESTBUY_API_KEY: "k" }, fetchImpl });
    assert.match(calls[0].url, /products\(search=headlamp\)/);
    assert.deepEqual(products[0], {
      id: "bestbuy-123", store: "Best Buy", title: "Black Diamond Headlamp", description: "300 lumens",
      price: 39.99, currency: "USD", image: "https://pisces.bbystatic.com/a.jpg", url: "https://www.bestbuy.com/site/123",
      dimensions: { label: "2 inches × 1 inches" }, shippingDays: null, inStock: true, source: "bestbuy",
      isMock: false, warnings: [], gtin: "0123", shippingPrice: 0, shippingCurrency: "USD",
    });
  });

  it("Kroger gets a token once and reads promo price and stock", async () => {
    const calls = [];
    const fetchImpl = fakeFetch([
      [/oauth2\/token/, { access_token: "t", expires_in: 1800 }],
      [/api\.kroger\.com\/v1\/products/, { data: [{
        productId: "1", description: "Kroger Whole Milk", brand: "Kroger", upc: "0001",
        images: [{ perspective: "front", sizes: [{ size: "medium", url: "https://img/k.jpg" }] }],
        items: [{ price: { regular: 3.49, promo: 2.99 }, size: "1 gal", inventory: { stockLevel: "LOW" } }],
        productPageURI: "/p/milk/1",
      }] }],
    ], calls);
    const env = { ...ONLY("kroger"), KROGER_CLIENT_ID: "id", KROGER_CLIENT_SECRET: "s", KROGER_LOCATION_ID: "01400943" };
    const { products } = await searchStores("Milk", { env, fetchImpl });
    await searchStores("Whole milk", { env, fetchImpl });
    assert.equal(calls.filter((call) => /token/.test(call.url)).length, 1);
    assert.equal(calls[0].init.headers.Authorization, `Basic ${Buffer.from("id:s").toString("base64")}`);
    assert.match(calls[1].url, /filter\.locationId=01400943/);
    assert.equal(products[0].price, 2.99);
    assert.equal(products[0].inStock, true);
    assert.equal(products[0].url, "https://www.kroger.com/p/milk/1");
    assert.deepEqual(products[0].dimensions, { label: "1 gal" });
  });

  it("Etsy divides price and drops non-USD listings", async () => {
    const fetchImpl = fakeFetch([[/openapi\.etsy\.com/, { results: [
      { listing_id: 1, title: "Wedding Guest Book", price: { amount: 3450, divisor: 100, currency_code: "USD" }, quantity: 2, url: "https://www.etsy.com/listing/1", images: [{ url_570xN: "https://i.etsystatic.com/1.jpg" }] },
      { listing_id: 2, title: "Guest Book", price: { amount: 3000, divisor: 100, currency_code: "EUR" }, quantity: 1 },
    ] }]]);
    const { products } = await searchStores("Guest book", { env: { ...ONLY("etsy"), ETSY_API_KEY: "k" }, fetchImpl });
    assert.equal(products.length, 1);
    assert.equal(products[0].price, 34.5);
    assert.equal(products[0].image, "https://i.etsystatic.com/1.jpg");
  });

  it("eBay passes through stated arrival dates and shipping cost", async () => {
    const fetchImpl = fakeFetch([
      [/oauth2\/token/, { access_token: "t", expires_in: 7200 }],
      [/item_summary\/search/, { itemSummaries: [{
        itemId: "v1|1|0", title: "Coleman Sundome Tent", price: { value: "79.99", currency: "USD" }, condition: "New",
        image: { imageUrl: "https://i.ebayimg.com/1.jpg" }, itemWebUrl: "https://www.ebay.com/itm/1",
        shippingOptions: [{ shippingCost: { value: "5.00", currency: "USD" }, minEstimatedDeliveryDate: "2026-10-22T07:00:00.000Z" }],
      }] }],
    ]);
    const { products } = await searchStores("2-person tent", { env: { ...ONLY("ebay"), EBAY_CLIENT_ID: "id", EBAY_CLIENT_SECRET: "s" }, fetchImpl });
    assert.equal(products[0].price, 79.99);
    assert.equal(products[0].estimatedArrival, "2026-10-22");
    assert.equal(products[0].shippingPrice, 5);
  });

  it("WooCommerce converts minor units and keeps answering stores", async () => {
    const fetchImpl = fakeFetch([
      [/good\.shop/, [{ id: 7, name: "String Lights 20ft", permalink: "https://good.shop/p/7", prices: { price: "1599", currency_code: "USD", currency_minor_unit: 2 }, images: [{ src: "https://good.shop/7.jpg" }], is_in_stock: true }]],
      [/down\.shop/, { error: "down" }, 500],
    ]);
    const { products, sources } = await searchStores("String lights", { env: { ...ONLY("woocommerce"), WOOCOMMERCE_STORES: "good.shop, https://down.shop/" }, fetchImpl });
    assert.equal(products[0].price, 15.99);
    assert.equal(products[0].store, "good.shop");
    assert.equal(sources.find((source) => source.id === "woocommerce").error, null);
  });

  it("Shopify sends the optional storefront token", async () => {
    const calls = [];
    const fetchImpl = fakeFetch([[/graphql\.json/, { data: { shop: { name: "Allbirds" }, products: { nodes: [
      { title: "Wool Runner", handle: "wool-runner", availableForSale: true, featuredImage: { url: "https://cdn.shopify.com/1.jpg" }, priceRange: { minVariantPrice: { amount: "110.0", currencyCode: "USD" } } },
    ] } } }]], calls);
    const { products } = await searchStores("Wool runner", { env: { ...ONLY("shopify"), SHOPIFY_STORES: "www.allbirds.com|tok" }, fetchImpl });
    assert.equal(calls[0].init.headers["X-Shopify-Storefront-Access-Token"], "tok");
    assert.equal(products[0].store, "Allbirds");
    assert.equal(products[0].url, "https://www.allbirds.com/products/wool-runner");
    assert.equal(products[0].price, 110);
  });

  it("UPCitemdb uses the newest USD offer and labels its age", async () => {
    const fetchImpl = fakeFetch([[/upcitemdb/, { items: [{ ean: "0712", title: "LED Headlamp", images: ["https://img/1.jpg"], offers: [
      { merchant: "Old", price: 10, availability: "", updated_t: 1500000000, link: "https://upcitemdb.com/a" },
      { merchant: "Walmart", price: 12.5, availability: "Out of Stock", updated_t: 1700000000, link: "https://upcitemdb.com/b" },
    ] }] }]]);
    const { products } = await searchStores("Headlamp", { env: ONLY("upcitemdb"), fetchImpl });
    assert.equal(products[0].store, "Walmart");
    assert.equal(products[0].price, 12.5);
    assert.equal(products[0].inStock, false);
    assert.match(products[0].warnings[0], /last seen 2023-11-14/);
  });

  it("Open Food Facts joins Open Prices by barcode", async () => {
    const calls = [];
    const fetchImpl = fakeFetch([
      [/search\.openfoodfacts\.org/, { hits: [
        { code: "1", product_name: "Milk chocolate", brands: ["Hershey"], categories_tags: ["en:chocolates"] },
        { code: "2", product_name: "Whole milk", brands: ["Lucerne"], quantity: "1 gal", image_front_url: "https://images.openfoodfacts.org/2.jpg", categories_tags: ["en:dairies", "en:milks"] },
      ] }],
      [/prices\.openfoodfacts\.org/, { items: [{ product: { code: "2" }, price: 3.99, currency: "USD", date: "2026-10-01", location: { osm_brand: "Safeway" } }] }],
    ], calls);
    const { products } = await searchStores("Milk", { env: ONLY("openfoodfacts"), fetchImpl });
    assert.match(calls[1].url, /product_code__in=2&/);
    assert.equal(products[0].title, "Lucerne Whole milk");
    assert.equal(products[0].store, "Safeway");
    assert.equal(products[0].price, 3.99);
    assert.match(products[0].warnings[0], /2026-10-01 at Safeway/);
  });

  it("Open Food Facts stays out of non-food searches", async () => {
    const calls = [];
    const fetchImpl = fakeFetch([[/search\.openfoodfacts\.org/, { hits: [
      { code: "1", product_name: "Stove Top Stuffing Mix", categories_tags: ["en:stuffings"] },
    ] }]], calls);
    const { products } = await searchStores("Camp stove", { env: ONLY("openfoodfacts"), fetchImpl });
    assert.deepEqual(products, []);
    assert.equal(calls.length, 1);
  });

  it("sample APIs are flagged as mock data", async () => {
    const fetchImpl = fakeFetch([
      [/dummyjson/, { products: [{ id: 34, title: "Nescafe Coffee", price: 7.99, thumbnail: "https://cdn.dummyjson.com/c.webp", availabilityStatus: "In Stock", shippingInformation: "Ships in 1-2 business days", dimensions: { width: 20, height: 29, depth: 29 } }] }],
      [/fakestoreapi/, [{ id: 1, title: "Mens Cotton Jacket", price: 55.99, image: "https://fakestoreapi.com/1.png" }]],
    ]);
    const { products } = await searchStores("Coffee", { env: ONLY("dummyjson", "fakestore"), fetchImpl });
    assert.equal(products.length, 1);
    assert.equal(products[0].isMock, true);
    assert.equal(products[0].shippingDays, 2);
    assert.deepEqual(products[0].dimensions, { label: "20 × 29 × 29 cm" });
  });
});

describe("searchStores", () => {
  const sample = [/dummyjson/, { products: [{ id: 1, title: "Sample Headlamp", price: 1 }] }];

  it("uses sample APIs only when no real store matched", async () => {
    const env = { ...ONLY("upcitemdb", "dummyjson"), STORES_SAMPLE_DATA: "fallback" };
    let result = await searchStores("Headlamp", { env, fetchImpl: fakeFetch([[/upcitemdb/, { items: [{ ean: "1", title: "Real Headlamp" }] }], sample]) });
    assert.deepEqual(result.products.map((product) => product.source), ["upcitemdb"]);
    clearCache();
    result = await searchStores("Headlamp", { env, fetchImpl: fakeFetch([[/upcitemdb/, { items: [] }], sample]) });
    assert.deepEqual(result.products.map((product) => product.source), ["dummyjson"]);
  });

  it("drops results whose title lacks the item noun", async () => {
    const fetchImpl = fakeFetch([[/upcitemdb/, { items: [{ ean: "1", title: "Rubber Bands 200ct" }, { ean: "2", title: "Gold Wedding Band" }] }]]);
    const { products } = await searchStores("Wedding bands", { env: ONLY("upcitemdb"), fetchImpl });
    assert.deepEqual(products.map((product) => product.title), ["Gold Wedding Band"]);
  });

  it("cools a provider down after HTTP 429", async () => {
    const calls = [];
    const fetchImpl = fakeFetch([[/upcitemdb/, { code: "TOO_FAST" }, 429, { "retry-after": "60" }]], calls);
    const first = await searchStores("Headlamp", { env: ONLY("upcitemdb"), fetchImpl });
    const second = await searchStores("Tent", { env: ONLY("upcitemdb"), fetchImpl });
    assert.equal(first.sources[0].error, "HTTP 429");
    assert.equal(second.sources[0].error, "rate limited, cooling down");
    assert.equal(calls.length, 1);
  });

  it("times out slow providers without failing the search", async () => {
    const fetchImpl = (url, { signal }) => new Promise((resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason)));
    const { products, sources } = await searchStores("Headlamp", { env: { ...ONLY("upcitemdb"), STORES_TIMEOUT_MS: "500" }, fetchImpl });
    assert.deepEqual(products, []);
    assert.equal(sources[0].error, "timed out");
  });

  it("fills missing descriptions from Icecat by barcode", async () => {
    const fetchImpl = fakeFetch([
      [/upcitemdb/, { items: [{ ean: "0885909950805", title: "Apple Headlamp" }] }],
      [/icecat/, { data: { GeneralInfo: { SummaryDescription: { LongSummaryDescription: "<b>Bright</b> lamp" } }, Image: { HighPic: "https://images.icecat.biz/1.jpg" } } }],
    ]);
    const { products } = await searchStores("Headlamp", { env: { ...ONLY("upcitemdb"), ICECAT_USERNAME: "me" }, fetchImpl });
    assert.equal(products[0].description, "Bright lamp");
    assert.equal(products[0].image, "https://images.icecat.biz/1.jpg");
  });

  it("reports why providers are off without exposing keys", () => {
    const status = storeStatus({ BESTBUY_API_KEY: "secret", STORES_DISABLED: "etsy" });
    assert.equal(status.find((provider) => provider.id === "bestbuy").enabled, true);
    assert.equal(status.find((provider) => provider.id === "etsy").reason, "Disabled by STORES_DISABLED");
    assert.equal(status.find((provider) => provider.id === "kroger").reason, "Missing KROGER_CLIENT_ID, KROGER_CLIENT_SECRET");
    assert.doesNotMatch(JSON.stringify(status), /secret/);
  });
});

describe("helpers", () => {
  it("parses shipping text, store lists and relevance", () => {
    assert.equal(shippingDaysFromText("Ships in 1 week"), 7);
    assert.equal(shippingDaysFromText("Ships overnight"), 1);
    assert.equal(shippingDaysFromText("Ships in 3-5 business days"), 5);
    assert.deepEqual(storeList("https://a.com/x, b.co|t, not a domain"), [{ domain: "a.com", token: null }, { domain: "b.co", token: "t" }]);
    assert.equal(isRelevant("Sleeping bags", { title: "Kelty Cosmic 20 Sleeping Bag" }), true);
    assert.equal(isRelevant("Sleeping bag", { title: "Sleeping Pad" }), false);
  });
});
