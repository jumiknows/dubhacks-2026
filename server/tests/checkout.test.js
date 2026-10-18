import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import Stripe from "stripe";
import { savePlan } from "../store.js";
import { pickListing, quotePlan } from "../services/pipeline.js";
import {
  CheckoutError, cartLines, configureStripe, confirmCheckout, createCartCheckout, createCheckout, handleWebhook, stripeMode,
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
    products: [{ id: `${id}-alt`, title: `Cheap ${id}`, store: "REI", price: 10.25, currency: "USD" }],
    synthesis: totalPrice == null ? null : { summary: `${id} from REI`, totalPrice, currency: "USD", best },
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
    assert.deepEqual(params.metadata, { cart_0: `${p.id}|tent,stove` });
    assert.deepEqual(params.line_items.map((l) => l.price_data.unit_amount), [12999, 4550]);
    assert.deepEqual(params.line_items[1].price_data.product_data.images, ["https://img.example/stove.jpg"]);
    assert.match(params.success_url, /session_id=\{CHECKOUT_SESSION_ID\}$/);
  });

  it("does not mark items purchased until Stripe says paid", async () => {
    const p = plan();
    const metadata = { plan_id: p.id, item_ids: "stove" };
    configureStripe({ client: fakeStripe({ payment_status: "unpaid", metadata }) });
    const pending = await confirmCheckout("cs_test_123");
    assert.equal(pending.status, "unpaid");
    assert.equal(pending.plan.items.find((i) => i.id === "stove").purchased, false);

    configureStripe({ client: fakeStripe({ payment_status: "paid", metadata }) });
    const paid = await confirmCheckout("cs_test_123");
    assert.equal(paid.plan.items.find((i) => i.id === "stove").purchased, true);
  });
});

describe("cart across plans", () => {
  it("charges one order for items from two plans and marks both", async () => {
    const a = plan();
    const b = plan();
    const started = await createCartCheckout([{ planId: a.id, itemIds: ["tent"] }, { planId: b.id, itemIds: ["stove"] }]);
    assert.equal(started.amount, 12999 + 4550);
    const done = await confirmCheckout(started.id);
    assert.equal(done.plans.length, 2);
    assert.equal(a.items.find((i) => i.id === "tent").purchased, true);
    assert.equal(b.items.find((i) => i.id === "stove").purchased, true);
    assert.equal(b.items.find((i) => i.id === "tent").purchased, false);
  });

  it("reads multi-plan Stripe metadata on return", async () => {
    const a = plan();
    const b = plan();
    configureStripe({
      client: fakeStripe({ payment_status: "paid", metadata: { cart_0: `${a.id}|tent`, cart_1: `${b.id}|stove` } }),
    });
    const done = await confirmCheckout("cs_test_123");
    assert.deepEqual(done.plans.map((p) => p.id), [a.id, b.id]);
    assert.equal(b.items.find((i) => i.id === "stove").purchased, true);
  });

  it("rejects an empty or oversized cart", async () => {
    await rejects(createCartCheckout([]), 400);
    await rejects(createCartCheckout([{ planId: "missing", itemIds: ["x"] }]), 404);
  });
});

describe("webhook", () => {
  const secret = "whsec_test_secret";
  const stripe = new Stripe("sk_test_dummy");

  function signed(object, type = "checkout.session.completed") {
    const payload = JSON.stringify({ id: "evt_1", object: "event", type, data: { object } });
    return [Buffer.from(payload), stripe.webhooks.generateTestHeaderString({ payload, secret })];
  }

  it("marks items purchased on a signed checkout.session.completed", () => {
    configureStripe({ client: stripe, secret });
    const p = plan();
    const [body, sig] = signed({ id: "cs_test_9", payment_status: "paid", metadata: { plan_id: p.id, item_ids: "tent" } });
    assert.deepEqual(handleWebhook(body, sig), { received: true, type: "checkout.session.completed" });
    assert.equal(p.items.find((i) => i.id === "tent").purchased, true);
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
  it("reprices from the item's own listing and ignores foreign ids", () => {
    const tent = { ...item("tent", 129.99), quantity: 2 };
    const picked = pickListing(tent, "tent-alt");
    assert.equal(picked.synthesis.totalPrice, 20.5);
    assert.equal(picked.synthesis.best.store, "REI");
    assert.equal(pickListing(tent, "someone-elses"), null);
  });
});
