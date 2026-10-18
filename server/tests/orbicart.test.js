import test from "node:test";
import assert from "node:assert/strict";
import { createOrbiCartPlan, OrbiCartError } from "../services/orbicart.js";
import { createApp } from "../index.js";
import { configureStripe } from "../services/checkout.js";
import { useAccountStore } from "../services/accounts.js";

const product = (changes = {}) => ({
  id: "store.example:tent", title: "Two-person tent", store: "Outdoor store", storeDomain: "store.example",
  url: "https://store.example/products/tent", image: null, price: 15, compareAt: 20, currency: "USD", available: true, why: [], score: 5,
  ...changes,
});
const body = (changes = {}) => ({ items: [{ id: "tent", name: "Tent", quantity: 2, spec: null }], title: "Mountain camping", ...changes });
const catalog = { tent: {} };
const source = (products) => ({ catalog, recommend: async (items) => ({
  recommendations: items.map((item) => ({ itemId: item.id, name: item.name, quantity: item.quantity, status: "ok", products })), failures: [],
}) });

test("source-ranked offers become a checked backend plan without changing the first selected product", async () => {
  const result = await createOrbiCartPlan(body({ budget: 100 }), source([product(), product({ id: "cheaper", price: 10.25 })]));
  assert.equal(result.recommendations[0].itemId, result.plan.items[0].id);
  assert.equal(result.plan.items[0].synthesis.best.id, "store.example:tent");
  assert.equal(result.plan.items[0].synthesis.totalPrice, 30);
  assert.equal(result.plan.items[0].products[1].price, 10.25);
  assert.equal(result.plan.quote.fullTotal, null);
  assert.equal(result.plan.quote.readyBy, null);
  assert.equal(result.plan.source, "orbicart_catalog");
  assert.equal(result.plan.isMock, false);
});

test("browser prices, duplicate items, invalid money and unsupported upstream offers cannot reach checkout", async () => {
  for (const request of [body({ products: [] }), body({ items: [{ ...body().items[0], price: 0.01 }] }),
    body({ items: [body().items[0], body().items[0]] }), body({ budget: Infinity }), body({ budget: 1.001 }),
    body({ items: [{ ...body().items[0], quantity: 0 }] })]) {
    await assert.rejects(createOrbiCartPlan(request, source([])), (error) => error instanceof OrbiCartError);
  }
  const result = await createOrbiCartPlan(body(), source([
    product({ price: Infinity }), product({ price: 0.001 }), product({ available: false }),
    product({ currency: "EUR" }), product({ currency: undefined }), product({ url: "javascript:alert(1)" }),
  ]));
  assert.equal(result.recommendations[0].products.length, 0);
  assert.equal(result.plan.items[0].synthesis.best, null);
  assert.equal(result.plan.quote.totalPrice, null);
});

test("unsupported kit identifiers do not access inherited catalog properties", async () => {
  let supplied;
  const options = { catalog, recommend: async (items) => { supplied = items; return { recommendations: [], failures: [] }; } };
  const result = await createOrbiCartPlan(body({ items: [{ id: "constructor", name: "Other item", quantity: 1 }] }), options);
  assert.deepEqual(supplied, []);
  assert.equal(result.recommendations[0].status, "no-match");
});

test("the imported TypeScript source catalog loads without a provider request for unsupported kit items", async () => {
  const result = await createOrbiCartPlan(body({ items: [{ id: "constructor", name: "Unsupported item", quantity: 1 }] }));
  assert.equal(result.recommendations[0].products.length, 0);
  assert.equal(result.plan.quote.totalPrice, null);
});

test("OrbiCart plan creation, selection, budget and paid receipt reuse the protected backend", async (t) => {
  useAccountStore({ sessions: new Map(), accounts: new Map(), save() {} });
  configureStripe({ mockOrder: { env: { MOCK_ORDER_SANDBOX: "off" } } });
  const app = createApp(undefined, { orbicartOptions: source([product(), product({ id: "cheaper", price: 10 })]) });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(async () => { configureStripe(); server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  let cookie = "";
  const request = async (path, value, method = "POST") => {
    const response = await fetch(origin + path, {
      method, headers: { "Content-Type": "application/json", cookie },
      ...(value === undefined ? {} : { body: JSON.stringify(value) }),
    });
    if (response.headers.get("set-cookie")) cookie = response.headers.get("set-cookie").split(";")[0];
    return response;
  };
  const created = await request("/api/orbicart/plans", body({ budget: 20 }));
  assert.equal(created.status, 201);
  const { plan } = await created.json();
  assert.equal((await request("/api/checkout", { planId: plan.id, itemIds: ["tent"] })).status, 409);
  const selection = await request(`/api/plans/${plan.id}/items/tent/listing`, { listingId: "cheaper" }, "PUT");
  assert.equal(selection.status, 200);
  const checkout = await (await request("/api/checkout", { planId: plan.id, itemIds: ["tent"] })).json();
  assert.equal(checkout.amount, 2000);
  const paid = await (await request(`/api/checkout/${checkout.id}`, undefined, "GET")).json();
  assert.equal(paid.plan.items[0].order.listing.id, "cheaper");
  assert.equal(paid.plan.items[0].order.amount, 2000);
  assert.equal(paid.plan.quote.toBuyCount, 0);
  assert.equal((await (await request("/api/plans", undefined, "GET")).json()).plans[0].id, plan.id);
});
