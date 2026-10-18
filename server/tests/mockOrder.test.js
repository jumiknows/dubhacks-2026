import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { savePlan } from "../store.js";
import { quotePlan } from "../services/pipeline.js";
import { configureStripe, confirmCheckout, createCheckout } from "../services/checkout.js";
import { placeMockOrder, sampleRef } from "../services/mockOrder.js";

/** Stand-in for the two sandboxes, with DummyJSON's habit of dropping unknown ids. */
function sandboxFetch(calls = [], { down = [] } = {}) {
  return async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url, body });
    if (down.some((host) => url.includes(host))) throw new TypeError("fetch failed");
    if (url === "https://fakestoreapi.com/carts") return json({ id: 11, ...body });
    if (url === "https://dummyjson.com/carts/add") {
      const known = body.products.filter((p) => p.id < 200);
      return json({ id: 209, products: known.map((p) => ({ ...p, price: 9.99 })), total: known.length * 9.99 });
    }
    return new Response("not found", { status: 404 });
  };
}

function json(value) {
  return new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } });
}

function line(itemId, listing, quantity = 1) {
  return { itemId, name: itemId, amount: 1000, currency: "usd", quantity, listing };
}

afterEach(() => configureStripe());

describe("sampleRef", () => {
  it("reads the sample store and numeric id from rawProduct ids", () => {
    assert.deepEqual(sampleRef({ id: "fakestore-3", source: "fakestore" }), { source: "fakestore", id: 3 });
    assert.deepEqual(sampleRef({ id: "dummyjson-12" }), { source: "dummyjson", id: 12 });
    assert.equal(sampleRef({ id: "bestbuy-12", source: "bestbuy" }), null);
    assert.equal(sampleRef({ id: "dummyjson-12", source: "fakestore" }), null);
    assert.equal(sampleRef(null), null);
  });
});

describe("placeMockOrder", () => {
  it("sends each sample-store line to its own sandbox cart", async () => {
    const calls = [];
    const receipt = await placeMockOrder(
      {
        lines: [
          line("jacket", { id: "fakestore-3", source: "fakestore" }, 2),
          line("lamp", { id: "dummyjson-12", source: "dummyjson" }),
          line("tent", { id: "rei-1", source: "rei" }),
        ],
        amount: 3000,
        currency: "usd",
      },
      { fetchImpl: sandboxFetch(calls), env: {} }
    );

    assert.match(receipt.orderId, /^ord_mock_/);
    assert.deepEqual(receipt.card, { brand: "visa", last4: "4242" });
    assert.deepEqual(receipt.local, ["tent"]);
    const byProvider = Object.fromEntries(receipt.sandboxes.map((s) => [s.provider, s]));
    assert.equal(byProvider.fakestore.cartId, 11);
    assert.equal(byProvider.dummyjson.cartId, 209);
    assert.equal(byProvider.dummyjson.accepted, 1);

    const fake = calls.find((c) => c.url.includes("fakestoreapi"));
    assert.deepEqual(fake.body.products, [{ productId: 3, quantity: 2 }]);
  });

  it("counts ids DummyJSON dropped", async () => {
    const receipt = await placeMockOrder(
      { lines: [line("a", { id: "dummyjson-5" }), line("b", { id: "dummyjson-99999" })], amount: 2000, currency: "usd" },
      { fetchImpl: sandboxFetch(), env: {} }
    );
    assert.equal(receipt.sandboxes[0].accepted, 1);
    assert.equal(receipt.sandboxes[0].rejected, 1);
  });

  it("still completes when a sandbox is down, and skips the network when off", async () => {
    const lines = [line("a", { id: "fakestore-1" })];
    const down = await placeMockOrder({ lines, amount: 1000, currency: "usd" }, {
      fetchImpl: sandboxFetch([], { down: ["fakestoreapi"] }), env: {},
    });
    assert.equal(down.sandboxes[0].status, "unreachable");

    const calls = [];
    const off = await placeMockOrder({ lines, amount: 1000, currency: "usd" }, {
      fetchImpl: sandboxFetch(calls), env: { MOCK_ORDER_SANDBOX: "off" },
    });
    assert.equal(off.sandboxes[0].status, "skipped");
    assert.equal(calls.length, 0);
  });
});

describe("mock checkout places one order", () => {
  it("returns the receipt and stamps the order id on bought items, once", async () => {
    const calls = [];
    configureStripe({ mockOrder: { fetchImpl: sandboxFetch(calls), env: {} } });
    const items = [
      {
        id: "jacket",
        name: "Jacket",
        quantity: 1,
        purchased: false,
        products: [],
        synthesis: { totalPrice: 55.99, currency: "USD", best: { id: "fakestore-3", source: "fakestore", price: 55.99, currency: "USD", inStock: true } },
      },
    ];
    const plan = savePlan({ id: "plan-mock-order", items, quote: quotePlan(items) });

    const started = await createCheckout(plan.id, ["jacket"]);
    const [first, second] = await Promise.all([confirmCheckout(started.id), confirmCheckout(started.id)]);

    assert.equal(first.receipt.orderId, second.receipt.orderId);
    assert.equal(first.receipt.amount, 5599);
    assert.equal(first.plan.items[0].order.orderId, first.receipt.orderId);
    assert.equal(calls.length, 1);
  });
});
