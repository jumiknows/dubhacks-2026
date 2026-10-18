process.env.PYTHON_API_URL = "http://127.0.0.1:1";
process.env.STORES_LIVE = "false";

import test from "node:test";
import assert from "node:assert/strict";
import { MAX_MONEY_CENTS, normalizeCurrency, parseCents, synthesize, validDate } from "../services/synthesizeBot.js";
import { attachOffers, quotePlan } from "../services/pipeline.js";
import { generatePlan, validatePlanRequest } from "../services/planner.js";

const item = (overrides = {}) => ({ name: "Test item", quantity: 1, purchased: false, ...overrides });
const product = (overrides = {}) => ({ id: "p1", title: "Product", store: "Store", price: 1.01, currency: "USD", inStock: true, ...overrides });

test("money parsing uses declared currencies and exact cents without guessing", () => {
  assert.equal(parseCents("USD 1,234.50", "usd"), 123450);
  assert.equal(parseCents("$1.09", "USD"), 109);
  assert.equal(parseCents("0.00", "USD"), 0);
  assert.equal(parseCents(0.1, "USD"), 10);
  for (const value of [-1, NaN, Infinity, true, null, "", "1.234", "1,23", "1e3", "about $2", "$2-3", "-0.01", "€2.00"]) {
    assert.equal(parseCents(value, "USD"), null, String(value));
  }
  assert.equal(parseCents("$2.00", null), null);
  assert.equal(parseCents("$2.00", "CAD"), null);
  assert.equal(parseCents("2.00", "JPY"), null);
  assert.equal(normalizeCurrency("XYZ"), null);
  const maximum = `${MAX_MONEY_CENTS / 100n}.${String(MAX_MONEY_CENTS % 100n).padStart(2, "0")}`;
  assert.equal(parseCents(maximum, "USD"), Number(MAX_MONEY_CENTS));
  assert.equal(parseCents(Number(MAX_MONEY_CENTS) / 100, "USD"), Number(MAX_MONEY_CENTS));
  assert.equal(parseCents("90071992547409.91", "USD"), null);
});

test("synthesis multiplies cents before converting back to the legacy dollar field", async () => {
  const result = await synthesize(item({ quantity: 3 }), [product({ price: 1.01 }), product({ id: "expensive", price: 1.02 })]);
  assert.equal(result.totalPrice, 3.03);
  assert.equal(result.best.id, "p1");
  assert.equal(result.priceScope, "items_only");
  assert.equal(result.fullTotal, null);
  assert.equal(result.costComplete, false);
});

test("missing prices, false/unknown stock and invalid quantities cannot become a valid quote", async () => {
  const bad = [product({ price: -2 }), product({ price: Infinity }), product({ price: null }), product({ price: 0.01, inStock: false }), product({ inStock: undefined })];
  assert.equal((await synthesize(item(), bad)).best, null);
  for (const quantity of [0, -1, 1.5, "2", Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal((await synthesize(item({ quantity }), [product()])).totalPrice, null);
  }
  assert.equal((await synthesize(item({ quantity: Number.MAX_SAFE_INTEGER }), [product()])).totalPrice, null);
});

test("synthesis never compares currencies or assumes a missing currency", async () => {
  const listings = [product({ price: 2 }), product({ id: "eur", price: 1, currency: "EUR" })];
  assert.equal((await synthesize(item(), listings)).best, null);
  assert.equal((await synthesize(item({ currency: "USD" }), listings)).best.id, "p1");
  assert.equal((await synthesize(item(), [product({ currency: undefined })])).totalPrice, null);
});

test("source URLs are limited to credential-free HTTP(S) and invalid source dates stay unknown", async () => {
  const result = await synthesize(item(), [product({ url: "javascript:alert(1)", image: "https://user:password@example.com/img", shippingDate: "2026-02-30", shippingDays: 2 })]);
  assert.equal(result.best.url, null);
  assert.equal(result.image, null);
  assert.equal(result.shippingDate, null);
  assert.equal(result.estimatedArrival, null);
  assert.equal(validDate("2024-02-29"), "2024-02-29");
  assert.equal(validDate("2026-02-29"), null);
});

test("explicit shipping fees are retained but ambiguous unit/order charges are never added", async () => {
  const result = await synthesize(item({ quantity: 3 }), [product({ price: 2, shippingPrice: "4.50", shippingCurrency: "USD", tax: "0.25", taxCurrency: "USD" })]);
  assert.equal(result.totalPrice, 6);
  assert.equal(result.shippingPrice, 4.5);
  assert.equal(result.tax, 0.25);
  assert.equal(result.fullTotal, null);
  const missingCurrency = await synthesize(item(), [product({ shippingPrice: "4.50", tax: "0.25" })]);
  assert.equal(missingCurrency.shippingPrice, null);
  assert.equal(missingCurrency.tax, null);
});

test("demo fixtures remain labeled and never generate dates from shipping duration", async () => {
  const draft = generatePlan({ prompt: "camping", category: "camping" });
  assert.equal(draft.isMock, true);
  assert.ok(draft.items.every((entry) => Number.isSafeInteger(entry.quantity) && entry.quantity > 0));
  const offers = await attachOffers(draft.items);
  assert.ok(offers.every((entry) => entry.products.every((p) => p.isMock && p.source === "demo_catalog")));
  assert.ok(offers.every((entry) => entry.synthesis.isMock && entry.synthesis.shippingDate === null));
  assert.equal(quotePlan(offers).readyBy, null);
  assert.equal((await synthesize(item(), [product({ isMock: true, estimatedArrival: "2026-12-20", shippingDate: "2026-12-18" })])).shippingDate, null);
});

test("quote totals are complete merchandise subtotals or null, never hidden partial sums", () => {
  const priced = item({ synthesis: { totalPrice: 0.1, currency: "USD" } });
  const second = item({ synthesis: { totalPrice: 0.2, currency: "USD" } });
  assert.equal(quotePlan([priced, second]).totalPrice, 0.3);
  const partial = quotePlan([priced, item()]);
  assert.equal(partial.totalPrice, null);
  assert.equal(partial.knownSubtotal, 0.1);
  assert.equal(partial.missingPriceCount, 1);
  assert.equal(quotePlan([priced, item({ synthesis: { totalPrice: 1, currency: "EUR" } })]).totalPrice, null);
  assert.equal(quotePlan([item({ synthesis: { totalPrice: 1 } })]).totalPrice, null);
  assert.equal(quotePlan([item({ synthesis: { totalPrice: NaN, currency: "USD" } })]).totalPrice, null);
  assert.equal(quotePlan([priced, item({ purchased: true })]).totalPrice, 0.1);
  assert.equal(quotePlan([]).totalPrice, 0);
});

test("readyBy requires arrival evidence for every item rather than a latest known ship date", () => {
  const entry = (arrival) => item({ synthesis: { totalPrice: 1, currency: "USD", shippingDate: "2026-10-18", estimatedArrival: arrival } });
  assert.equal(quotePlan([entry("2026-10-21"), entry("2026-10-23")]).readyBy, "2026-10-23");
  assert.equal(quotePlan([entry("2026-10-21"), entry(null)]).readyBy, null);
});

test("trip prompts plan a travel kit named after the destination", () => {
  for (const [prompt, title] of [
    ["I'm going to Tokyo for a week", "Trip to Tokyo"],
    ["Beach weekend in Cancún", "Trip to Cancún"],
    ["Business trip to New York", "Trip to New York"],
    ["planning a vacation", "Travel kit"],
  ]) {
    const plan = generatePlan({ prompt });
    assert.equal(plan.category, "travel", prompt);
    assert.equal(plan.title, title, prompt);
  }
  const names = generatePlan({ prompt: "trip to Lisbon" }).items.map((item) => item.name);
  assert.ok(names.includes("Carry-on suitcase") && names.includes("Universal travel adapter"));
  // "week" alone is still groceries; camping trips stay camping.
  assert.equal(generatePlan({ prompt: "groceries for the week" }).category, "groceries");
  assert.equal(generatePlan({ prompt: "camping trip in Yosemite" }).category, "camping");
  assert.equal(validatePlanRequest({ prompt: "x", category: "travel" }), null);
});

test("every travel item has offline listings from two stores to compare", async () => {
  const draft = generatePlan({ prompt: "I'm flying to Paris" });
  const offers = await attachOffers(draft.items);
  for (const item of offers) {
    const stores = new Set(item.products.map((p) => p.store));
    assert.ok(stores.size >= 2, `${item.name}: ${[...stores].join(", ")}`);
    assert.equal(typeof item.synthesis.totalPrice, "number", item.name);
  }
});

test("planner validates request shape and length without coercing user input", () => {
  for (const request of [null, [], {}, { prompt: false }, { prompt: " " }, { prompt: "x".repeat(2001) }, { prompt: "x", category: {} }, { prompt: "x", category: "unknown" }, { prompt: "x", purchased: true }]) {
    assert.equal(typeof validatePlanRequest(request), "string");
  }
  assert.equal(validatePlanRequest({ prompt: "buy socks" }), null);
  assert.equal(validatePlanRequest({ prompt: "keep devices", category: "electronics" }), null);
});
