import { randomUUID } from "node:crypto";
import Stripe from "stripe";
import { getPlan } from "../store.js";
import { placeMockOrder } from "./mockOrder.js";
import { quotePlan } from "./pipeline.js";

/**
 * OWNER: Checkout
 * STATUS: Stripe Checkout (test mode). Without STRIPE_SECRET_KEY it runs a labeled mock
 * that places a demo order through the sample stores' sandbox carts (mockOrder.js).
 *
 * The browser sends plan + item ids only. Names and prices come from the plan
 * the server stored, so a tampered request can't change what gets charged.
 * Items flip to purchased only after Stripe says the session is paid, either
 * from the success redirect (confirmCheckout) or the webhook (handleWebhook).
 */

const CLIENT_URL = (process.env.CLIENT_URL || "http://localhost:5173").replace(/\/$/, "");
// Stripe caps each metadata value at 500 characters; item ids are UUIDs.
const METADATA_MAX = 500;
const MAX_GROUPS = 20;

let stripe = makeClient(process.env.STRIPE_SECRET_KEY);
let webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || "";
let mockOrderOptions = {};
const mockSessions = new Map();

function makeClient(key) {
  if (!key) return null;
  if (/^(sk|rk)_live_/.test(key)) {
    throw new Error("STRIPE_SECRET_KEY is a live key. Use a test key (sk_test_...).");
  }
  return new Stripe(key);
}

/** Tests swap in a fake client (null means mock mode) and a fake fetch for the sandboxes. */
export function configureStripe({ client = null, secret = "", mockOrder = {} } = {}) {
  stripe = client;
  webhookSecret = secret;
  mockOrderOptions = mockOrder;
  mockSessions.clear();
}

export function stripeMode() {
  return stripe ? "test" : "mock";
}

export class CheckoutError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/** Server-priced line items for the chosen to-buy items. */
export function cartLines(plan, itemIds) {
  if (!Array.isArray(itemIds) || itemIds.length === 0) {
    throw new CheckoutError(400, "Select at least one item to buy.");
  }
  if (itemIds.some((id) => typeof id !== "string") || new Set(itemIds).size !== itemIds.length) {
    throw new CheckoutError(400, "itemIds must be unique strings.");
  }

  const lines = itemIds.map((id) => {
    const item = plan.items.find((row) => row.id === id);
    if (!item) throw new CheckoutError(404, "An item in the cart is no longer on this plan.");
    if (item.purchased) throw new CheckoutError(409, `${item.name} is already purchased.`);
    const price = item.synthesis?.totalPrice;
    if (typeof price !== "number" || !(price > 0)) {
      throw new CheckoutError(409, `${item.name} has no price yet.`);
    }
    const best = item.synthesis.best;
    return {
      itemId: item.id,
      name: item.name,
      description: item.synthesis.summary || null,
      image: typeof best?.image === "string" && best.image.startsWith("https://") ? best.image : null,
      amount: Math.round(price * 100),
      currency: (item.synthesis.currency || "USD").toLowerCase(),
      quantity: item.quantity > 0 ? item.quantity : 1,
      listing: best ? { id: best.id, source: best.source ?? null } : null,
    };
  });

  if (new Set(lines.map((line) => line.currency)).size > 1) {
    throw new CheckoutError(409, "Items in one checkout must share a currency.");
  }
  return lines;
}

export function createCheckout(planId, itemIds) {
  return createCartCheckout([{ planId, itemIds }]);
}

/** One order for a cart that can span several plans: groups = [{ planId, itemIds }]. */
export async function createCartCheckout(groups) {
  if (!Array.isArray(groups) || groups.length === 0 || groups.length > MAX_GROUPS) {
    throw new CheckoutError(400, "Select at least one item to buy.");
  }
  const lines = [];
  for (const group of groups) {
    const plan = typeof group?.planId === "string" ? getPlan(group.planId) : null;
    if (!plan) throw new CheckoutError(404, "plan not found");
    lines.push(...cartLines(plan, group.itemIds).map((line) => ({ ...line, planId: plan.id })));
  }
  if (new Set(lines.map((line) => line.currency)).size > 1) {
    throw new CheckoutError(409, "Items in one checkout must share a currency.");
  }
  const amount = lines.reduce((sum, line) => sum + line.amount, 0);
  const currency = lines[0].currency;
  const cart = groups.map((group) => ({ planId: group.planId, itemIds: [...group.itemIds] }));

  if (!stripe) {
    const id = `cs_mock_${randomUUID()}`;
    mockSessions.set(id, { cart, lines, amount, currency, receipt: null });
    return { id, url: successUrl(id), amount, currency, mock: true };
  }

  const metadata = {};
  cart.forEach((group, index) => {
    const value = `${group.planId}|${group.itemIds.join(",")}`;
    if (value.length > METADATA_MAX) {
      throw new CheckoutError(400, "Too many items for one checkout. Pay for fewer at a time.");
    }
    metadata[`cart_${index}`] = value;
  });

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    client_reference_id: cart[0].planId,
    line_items: lines.map((line) => ({
      quantity: 1,
      price_data: {
        currency: line.currency,
        unit_amount: line.amount,
        product_data: {
          name: line.name,
          ...(line.description ? { description: line.description } : {}),
          ...(line.image ? { images: [line.image] } : {}),
        },
      },
    })),
    metadata,
    success_url: successUrl("{CHECKOUT_SESSION_ID}"),
    cancel_url: `${CLIENT_URL}/?checkout=cancel&plan_id=${encodeURIComponent(cart[0].planId)}`,
  });
  return { id: session.id, url: session.url, amount, currency, mock: false };
}

/** Called when the browser lands back on success_url (or the in-app mock sheet confirms). */
export async function confirmCheckout(sessionId) {
  if (typeof sessionId !== "string" || !sessionId) throw new CheckoutError(400, "session_id is required");

  if (sessionId.startsWith("cs_mock_")) {
    const pending = mockSessions.get(sessionId);
    if (!pending) throw new CheckoutError(404, "checkout session not found");
    // Keep the promise so a double confirm can't place two orders.
    pending.receipt ??= placeMockOrder(
      { lines: pending.lines, amount: pending.amount, currency: pending.currency },
      mockOrderOptions
    );
    const receipt = await pending.receipt;
    const plans = markCartPaid(pending.cart, sessionId, receipt.orderId);
    return { status: "paid", mock: true, plan: plans[0] ?? null, plans, receipt };
  }

  if (!stripe) throw new CheckoutError(503, "Stripe is not configured on this server.");
  let session;
  try {
    session = await stripe.checkout.sessions.retrieve(sessionId);
  } catch {
    throw new CheckoutError(404, "checkout session not found");
  }
  const cart = fromMetadata(session);
  if (session.payment_status !== "paid" && session.payment_status !== "no_payment_required") {
    const plans = cart.map((group) => getPlan(group.planId)).filter(Boolean);
    return { status: session.payment_status || "unpaid", mock: false, plan: plans[0] ?? null, plans };
  }
  const plans = markCartPaid(cart, session.id);
  return { status: "paid", mock: false, plan: plans[0] ?? null, plans };
}

/** Stripe webhook. rawBody must be the unparsed request Buffer. */
export function handleWebhook(rawBody, signature) {
  if (!stripe || !webhookSecret) throw new CheckoutError(503, "Stripe webhooks are not configured.");
  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch {
    throw new CheckoutError(400, "Invalid Stripe signature.");
  }

  const paid =
    event.type === "checkout.session.async_payment_succeeded" ||
    (event.type === "checkout.session.completed" && event.data.object.payment_status === "paid");
  if (paid) markCartPaid(fromMetadata(event.data.object), event.data.object.id);
  return { received: true, type: event.type };
}

/** cart_N = "planId|item,item"; plan_id + item_ids is the older single-plan form. */
function fromMetadata(session) {
  const metadata = session.metadata || {};
  const cart = Object.keys(metadata)
    .filter((key) => /^cart_\d+$/.test(key))
    .sort((a, b) => Number(a.slice(5)) - Number(b.slice(5)))
    .map((key) => {
      const [planId, ids = ""] = String(metadata[key]).split("|");
      return { planId, itemIds: ids.split(",").filter(Boolean) };
    });
  if (!cart.length && (metadata.plan_id || session.client_reference_id)) {
    cart.push({
      planId: metadata.plan_id || session.client_reference_id,
      itemIds: String(metadata.item_ids || "").split(",").filter(Boolean),
    });
  }
  if (!cart.length || cart.some((group) => !group.planId || group.itemIds.length === 0)) {
    throw new CheckoutError(400, "Checkout session is missing cart metadata.");
  }
  return cart;
}

function markCartPaid(cart, sessionId, orderId = null) {
  return cart.map((group) => markPaid(group.planId, group.itemIds, sessionId, orderId)).filter(Boolean);
}

/** Idempotent: the redirect and the webhook can both land. */
function markPaid(planId, itemIds, sessionId, orderId = null) {
  const plan = getPlan(planId);
  // Plans live in memory; a restart between paying and returning loses the plan, not the payment.
  if (!plan) return null;
  const paidAt = new Date().toISOString();
  plan.items = plan.items.map((item) =>
    itemIds.includes(item.id) && !item.purchased
      ? { ...item, purchased: true, order: { checkoutSessionId: sessionId, orderId, paidAt } }
      : item
  );
  plan.quote = quotePlan(plan.items);
  return plan;
}

function successUrl(sessionId) {
  return `${CLIENT_URL}/?checkout=success&session_id=${sessionId}`;
}
