import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import Stripe from "stripe";
import { savePlan } from "../store.js";
import { pickListing, quotePlan } from "../services/pipeline.js";
import {
  assertItemUnlocked, cancelCheckout, CheckoutError, cartLines, configureStripe, confirmCheckout, createCheckout, createCartCheckout, handleWebhook, stripeMode,
} from "../services/checkout.js";

let seq = 0;

function plan() {
  seq += 1;
  const items = [
    item("tent", 129.99),
    item("stove", 45.5, { image: "https://img.example/stove.jpg" }),
    item("lamp", null),
    { ...item("bag", 60), purchased: true },
  ];
  return savePlan({ id: `plan-${seq}`, title: "Camping trip", items, quote: quotePlan(items) });
}

function item(id, totalPrice, best = {}) {
  return {
    id,
    name: id[0].toUpperCase() + id.slice(1),
    quantity: 1,
    purchased: false,
    products: [{ id: `${id}-alt`, title: `Cheap ${id}`, store: "REI", price: 10.25, currency: "USD", inStock: true }],
    synthesis: totalPrice == null ? null : { summary: `${id} from REI`, totalPrice, currency: "USD", best: { id: `${id}-best`, title: id, store: "REI", price: totalPrice, currency: "USD", inStock: true, ...best } },
  };
}

function fakeStripe(session = {}) {
  const calls = [];
  return {
    calls,
    checkout: {
      sessions: {
        async create(params) {
          calls.push(params);
          return { id: "cs_test_123", url: "https://checkout.stripe.com/c/pay/cs_test_123" };
        },
        async retrieve(id) {
          return { id, ...session };
        },
        async expire(id) {
          session.status = "expired";
          return { id, ...session };
        },
      },
    },
  };
}

async function rejects(promise, status) {
  await assert.rejects(promise, (err) => err instanceof CheckoutError && err.status === status);
}

afterEach(() => configureStripe());

describe("cartLines", () => {
  it("prices from the stored plan, in cents", () => {
    const lines = cartLines(plan(), ["tent", "stove"]);
    assert.deepEqual(lines.map((l) => [l.itemId, l.amount, l.currency]), [["tent", 12999, "usd"], ["stove", 4550, "usd"]]);
    assert.equal(lines[1].image, "https://img.example/stove.jpg");
    assert.equal(lines[0].image, null);
  });

  it("rejects empty, duplicate, unknown, unpriced and purchased items", () => {
    const p = plan();
    const status = (ids) => {
      try {
        cartLines(p, ids);
      } catch (err) {
        return err.status;
      }
      return "ok";
    };
    assert.equal(status([]), 400);
    assert.equal(status(["tent", "tent"]), 400);
    assert.equal(status(["nope"]), 404);
    assert.equal(status(["lamp"]), 409);
    assert.equal(status(["bag"]), 409);
  });

  it("rejects missing currencies, stock, invalid quantities, stale totals and mixed-currency carts", () => {
    const p = plan();
    const original = structuredClone(p.items[0]);
    for (const change of [
      (entry) => { entry.synthesis.currency = undefined; },
      (entry) => { entry.synthesis.totalPrice = Infinity; },
      (entry) => { entry.synthesis.totalPrice = 0.001; },
      (entry) => { entry.synthesis.best.inStock = null; },
      (entry) => { entry.synthesis.best.price = 1; },
      (entry) => { entry.quantity = 1.5; },
      (entry) => { entry.owned = true; },
    ]) {
      p.items[0] = structuredClone(original);
      change(p.items[0]);
      assert.throws(() => cartLines(p, ["tent"]), (err) => err instanceof CheckoutError && err.status === 409);
    }
    p.items[0] = original;
    p.items[1].synthesis.currency = "EUR";
    p.items[1].synthesis.best.currency = "EUR";
    assert.throws(() => cartLines(p, ["tent", "stove"]), /share a currency/);
  });
});

describe("mock checkout (no STRIPE_SECRET_KEY)", () => {
  it("marks only the paid items purchased and requotes", async () => {
    assert.equal(stripeMode(), "mock");
    const p = plan();
    const started = await createCheckout(p.id, ["tent"]);
    assert.equal(started.mock, true);
    assert.equal(started.amount, 12999);
    assert.match(started.url, /checkout=success&session_id=cs_mock_/);

    const done = await confirmCheckout(started.id);
    assert.equal(done.status, "paid");
    const byId = Object.fromEntries(done.plan.items.map((i) => [i.id, i]));
    assert.equal(byId.tent.purchased, true);
    assert.equal(byId.tent.order.checkoutSessionId, started.id);
    assert.equal(byId.stove.purchased, false);
    assert.equal(done.plan.quote.toBuyCount, 2);

    const again = await confirmCheckout(started.id);
    assert.equal(again.plan.items.find((i) => i.id === "tent").order.paidAt, byId.tent.order.paidAt);
  });

  it("404s an unknown plan or session", async () => {
    await rejects(createCheckout("missing", ["tent"]), 404);
    await rejects(confirmCheckout("cs_mock_nope"), 404);
  });
});

describe("Stripe checkout", () => {
  it("sends server prices and cart metadata to Stripe", async () => {
    const client = fakeStripe();
    configureStripe({ client });
    const p = plan();
    const started = await createCheckout(p.id, ["tent", "stove"]);
    assert.equal(started.url, "https://checkout.stripe.com/c/pay/cs_test_123");
    assert.equal(started.mock, false);

    const [params] = client.calls;
    assert.equal(params.mode, "payment");
    assert.equal(params.metadata.plan_id, p.id);
    assert.equal(params.metadata.item_ids, "tent,stove");
    assert.match(params.metadata.checkout_reference, /^co_/);
    assert.match(params.cancel_url, new RegExp(`checkout_id=${params.metadata.checkout_reference}$`));
    assert.deepEqual(params.line_items.map((l) => l.price_data.unit_amount), [12999, 4550]);
    assert.deepEqual(params.line_items[1].price_data.product_data.images, ["https://img.example/stove.jpg"]);
    assert.match(params.success_url, /session_id=\{CHECKOUT_SESSION_ID\}$/);
  });

  it("does not mark items purchased until Stripe says paid", async () => {
    const p = plan();
    const metadata = { plan_id: p.id, item_ids: "stove" };
    const session = { payment_status: "unpaid", metadata };
    configureStripe({ client: fakeStripe(session) });
    await createCheckout(p.id, ["stove"]);
    const pending = await confirmCheckout("cs_test_123");
    assert.equal(pending.status, "unpaid");
    assert.equal(pending.plan.items.find((i) => i.id === "stove").purchased, false);

    session.payment_status = "paid";
    const paid = await confirmCheckout("cs_test_123");
    assert.equal(paid.plan.items.find((i) => i.id === "stove").purchased, true);
    assert.equal(paid.receipt.orderId, "cs_test_123");
    assert.equal(new Date(paid.receipt.placedAt).toISOString(), paid.receipt.placedAt);
    assert.equal(paid.receipt.amount, 4550);
    assert.equal(paid.receipt.currency, "usd");
    assert.equal(paid.receipt.mock, false);
    assert.equal(paid.plan.items.find((i) => i.id === "stove").order.orderId, paid.receipt.orderId);
    assert.deepEqual((await confirmCheckout("cs_test_123")).receipt, paid.receipt);
  });
});

describe("webhook", () => {
  const secret = "whsec_test_secret";
  const stripe = new Stripe("sk_test_dummy");

  function signed(object, type = "checkout.session.completed") {
    const payload = JSON.stringify({ id: "evt_1", object: "event", type, data: { object } });
    return [Buffer.from(payload), stripe.webhooks.generateTestHeaderString({ payload, secret })];
  }

  it("marks captured items purchased on a signed checkout.session.completed", async () => {
    const client = fakeStripe();
    client.webhooks = stripe.webhooks;
    configureStripe({ client, secret });
    const p = plan();
    const checkout = await createCheckout(p.id, ["tent"]);
    const original = structuredClone(p.items[0].synthesis);
    p.items[0] = await pickListing(p.items[0], "tent-alt");
    const [body, sig] = signed({ id: checkout.id, payment_status: "paid", metadata: { plan_id: p.id, item_ids: "tent" } });
    assert.deepEqual(handleWebhook(body, sig), { received: true, type: "checkout.session.completed" });
    assert.equal(p.items.find((i) => i.id === "tent").purchased, true);
    assert.equal(p.items[0].order.listing.id, original.best.id);
    assert.equal(p.items[0].synthesis.totalPrice, original.totalPrice);
  });

  it("ignores unpaid completions and rejects bad signatures", () => {
    configureStripe({ client: stripe, secret });
    const p = plan();
    const [body, sig] = signed({ id: "cs_test_9", payment_status: "unpaid", metadata: { plan_id: p.id, item_ids: "tent" } });
    handleWebhook(body, sig);
    assert.equal(p.items.find((i) => i.id === "tent").purchased, false);
    assert.throws(() => handleWebhook(body, "t=1,v1=bad"), (err) => err.status === 400);
  });

  it("503s when webhooks are not configured", () => {
    assert.throws(() => handleWebhook(Buffer.from("{}"), "sig"), (err) => err.status === 503);
  });
});

describe("pickListing", () => {
  it("reprices from the item's own listing and ignores foreign ids", async () => {
    const tent = { ...item("tent", 129.99), quantity: 2 };
    const picked = await pickListing(tent, "tent-alt");
    assert.equal(picked.synthesis.totalPrice, 20.5);
    assert.equal(picked.synthesis.best.store, "REI");
    assert.equal(await pickListing(tent, "someone-elses"), null);
  });
});

describe("pending checkout and captured paid offers", () => {
  it("rejects duplicate checkout and releases a cancelled mock cart", async () => {
    const p = plan();
    const first = await createCheckout(p.id, ["tent"]);
    assert.throws(() => assertItemUnlocked(p.id, "tent"), (err) => err.status === 409);
    await rejects(createCheckout(p.id, ["tent"]), 409);
    const cancelled = await cancelCheckout(first.id);
    assert.equal(cancelled.status, "cancelled");
    assert.equal((await confirmCheckout(first.id)).status, "cancelled");
    assert.equal(p.items[0].purchased, false);
    assert.doesNotThrow(() => assertItemUnlocked(p.id, "tent"));
    const second = await createCheckout(p.id, ["tent"]);
    assert.notEqual(second.id, first.id);
  });

  it("records the offer actually checked out even when a stale caller replaces the current selection", async () => {
    const p = plan();
    const captured = structuredClone(p.items[0].synthesis);
    const checkout = await createCheckout(p.id, ["tent"]);
    p.items[0] = await pickListing(p.items[0], "tent-alt");
    const paid = await confirmCheckout(checkout.id);
    assert.equal(paid.plan.items[0].synthesis.best.id, captured.best.id);
    assert.equal(paid.plan.items[0].synthesis.totalPrice, captured.totalPrice);
    assert.equal(paid.plan.items[0].order.amount, 12999);
    assert.equal(paid.plan.items[0].order.listing.id, captured.best.id);
    await rejects(createCheckout(p.id, ["tent"]), 409);
    assert.equal((await cancelCheckout(checkout.id)).status, "paid");
  });

  it("reserves before provider creation and releases reservations if creation fails", async () => {
    const p = plan();
    const client = fakeStripe();
    let release;
    const blocked = new Promise((resolve) => { release = resolve; });
    const ordinaryCreate = client.checkout.sessions.create;
    client.checkout.sessions.create = async (...args) => {
      await blocked;
      return ordinaryCreate(...args);
    };
    configureStripe({ client });
    const creation = createCheckout(p.id, ["tent"]);
    await rejects(createCheckout(p.id, ["tent"]), 409);
    assert.throws(() => assertItemUnlocked(p.id, "tent"), /pending checkout/);
    release();
    await creation;

    const secondPlan = plan();
    client.checkout.sessions.create = async () => { throw new Error("provider unavailable"); };
    await assert.rejects(createCheckout(secondPlan.id, ["tent"]), /provider unavailable/);
    assert.doesNotThrow(() => assertItemUnlocked(secondPlan.id, "tent"));
    client.checkout.sessions.create = ordinaryCreate;
    assert.ok((await createCheckout(secondPlan.id, ["tent"])).id);
  });

  it("expires a Stripe session before unlocking and records payment winning a cancel race", async () => {
    const p = plan();
    const session = { payment_status: "unpaid", status: "open" };
    const client = fakeStripe(session);
    configureStripe({ client });
    const checkout = await createCheckout(p.id, ["tent"]);
    const token = new URL(client.calls[0].cancel_url).searchParams.get("checkout_id");
    assert.equal((await cancelCheckout(token)).status, "cancelled");
    assert.equal(session.status, "expired");
    assert.doesNotThrow(() => assertItemUnlocked(p.id, "tent"));
    assert.equal((await confirmCheckout(checkout.id)).status, "cancelled");

    session.status = "open";
    const second = await createCheckout(p.id, ["tent"]);
    client.checkout.sessions.expire = async () => {
      session.payment_status = "paid";
      session.amount_total = 12999;
      session.currency = "usd";
      throw new Error("payment already completed");
    };
    const paid = await cancelCheckout(second.id);
    assert.equal(paid.status, "paid");
    assert.equal(paid.receipt.amount, 12999);
    assert.equal(paid.plan.items[0].order.amount, 12999);
    await rejects(createCheckout(p.id, ["tent"]), 409);
  });
});

describe("cumulative OrbiCart trip budget", () => {
  function trip(budget) {
    const p = plan();
    p.source = "orbicart_catalog";
    p.preferences = { budgetMax: budget };
    return p;
  }

  it("includes prior paid snapshots when checking a later subset", async () => {
    const p = trip(150);
    const first = await createCheckout(p.id, ["tent"]);
    await confirmCheckout(first.id);
    await rejects(createCheckout(p.id, ["stove"]), 409);
    assert.equal(p.items[0].order.amount, 12999);
    assert.equal(p.items[1].purchased, false);
  });

  it("reserves budget across disjoint pending carts and cancellation releases it", async () => {
    const p = trip(150);
    const first = await createCheckout(p.id, ["tent"]);
    await rejects(createCheckout(p.id, ["stove"]), 409);
    assert.equal((await cancelCheckout(first.id)).status, "cancelled");
    const second = await createCheckout(p.id, ["stove"]);
    assert.equal(second.amount, 4550);
    await rejects(createCheckout(p.id, ["tent"]), 409);
  });

  it("counts a pending session once despite its cancellation alias", async () => {
    const p = trip(200);
    p.items.push(item("filter", 30));
    const first = await createCheckout(p.id, ["tent"]);
    const second = await createCheckout(p.id, ["stove"]);
    assert.equal(first.amount + second.amount, 17549);
    await rejects(createCheckout(p.id, ["filter"]), 409);
    await confirmCheckout(first.id);
    await rejects(createCheckout(p.id, ["filter"]), 409);
    await cancelCheckout(second.id);
    assert.equal((await createCheckout(p.id, ["filter"])).amount, 3000);
  });

  it("reserves budget while a disjoint Stripe session is still being created", async () => {
    const p = trip(150);
    const client = fakeStripe();
    let release;
    const blocked = new Promise((resolve) => { release = resolve; });
    const create = client.checkout.sessions.create;
    client.checkout.sessions.create = async (...args) => { await blocked; return create(...args); };
    configureStripe({ client });
    const first = createCheckout(p.id, ["tent"]);
    await rejects(createCheckout(p.id, ["stove"]), 409);
    release();
    assert.ok((await first).id);
  });
});

describe("cart across plans retains checkout protections", () => {
  it("pays one immutable order for two plans and returns every updated plan", async () => {
    const a = plan();
    const b = plan();
    const original = structuredClone(b.items[1].synthesis);
    const checkout = await createCartCheckout([{ planId: a.id, itemIds: ["tent"] }, { planId: b.id, itemIds: ["stove"] }]);
    assert.equal(checkout.amount, 17549);
    await rejects(createCheckout(a.id, ["tent"]), 409);
    await rejects(createCheckout(b.id, ["stove"]), 409);
    b.items[1] = await pickListing(b.items[1], "stove-alt");
    const paid = await confirmCheckout(checkout.id);
    assert.deepEqual(paid.plans.map((entry) => entry.id), [a.id, b.id]);
    assert.equal(paid.plan.id, a.id);
    assert.equal(a.items[0].purchased, true);
    assert.equal(b.items[1].purchased, true);
    assert.equal(b.items[0].purchased, false);
    assert.equal(b.items[1].synthesis.totalPrice, original.totalPrice);
    assert.equal(b.items[1].order.listing.id, original.best.id);
    assert.deepEqual(paid.receipt.lines.map((line) => [line.planId, line.itemId]), [[a.id, "tent"], [b.id, "stove"]]);
  });

  it("rejects invalid or mixed carts atomically and cancellation unlocks every plan", async () => {
    const a = plan();
    const b = plan();
    await rejects(createCartCheckout([]), 400);
    await rejects(createCartCheckout([{ planId: "missing", itemIds: ["tent"] }]), 404);
    await rejects(createCartCheckout([{ planId: a.id, itemIds: ["tent"] }, { planId: a.id, itemIds: ["stove"] }]), 400);
    b.items[1].synthesis.currency = "EUR";
    b.items[1].synthesis.best.currency = "EUR";
    await rejects(createCartCheckout([{ planId: a.id, itemIds: ["tent"] }, { planId: b.id, itemIds: ["stove"] }]), 409);
    assert.doesNotThrow(() => assertItemUnlocked(a.id, "tent"));
    b.items[1].synthesis.currency = "USD";
    b.items[1].synthesis.best.currency = "USD";
    const checkout = await createCartCheckout([{ planId: a.id, itemIds: ["tent"] }, { planId: b.id, itemIds: ["stove"] }]);
    const cancelled = await cancelCheckout(checkout.id);
    assert.equal(cancelled.plans.length, 2);
    assert.doesNotThrow(() => assertItemUnlocked(a.id, "tent"));
    assert.doesNotThrow(() => assertItemUnlocked(b.id, "stove"));
    assert.equal((await confirmCheckout(checkout.id)).status, "cancelled");
  });

  it("accounts paid and pending amounts against each trip's own budget", async () => {
    const a = plan();
    const b = plan();
    a.source = b.source = "orbicart_catalog";
    a.preferences = { budgetMax: 130 };
    b.preferences = { budgetMax: 50 };
    b.items.push(item("filter", 3));
    const checkout = await createCartCheckout([{ planId: a.id, itemIds: ["tent"] }, { planId: b.id, itemIds: ["stove"] }]);
    await rejects(createCheckout(a.id, ["stove"]), 409);
    await confirmCheckout(checkout.id);
    await rejects(createCheckout(a.id, ["stove"]), 409);
    assert.equal((await createCheckout(b.id, ["filter"])).amount, 300);
  });

  it("uses multi-plan Stripe metadata while confirming only server-captured prices", async () => {
    const a = plan();
    const b = plan();
    const client = fakeStripe({ payment_status: "paid", amount_total: 17549, currency: "usd" });
    configureStripe({ client });
    const checkout = await createCartCheckout([{ planId: a.id, itemIds: ["tent"] }, { planId: b.id, itemIds: ["stove"] }]);
    assert.equal(client.calls[0].metadata.cart_0, `${a.id}|tent`);
    assert.equal(client.calls[0].metadata.cart_1, `${b.id}|stove`);
    const result = await confirmCheckout(checkout.id);
    assert.equal(result.plans.length, 2);
    assert.equal(result.receipt.amount, 17549);
    assert.equal(result.receipt.orderId, checkout.id);
  });
});
