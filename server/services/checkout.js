import { randomUUID } from "node:crypto";
import Stripe from "stripe";
import { getPlan } from "../store.js";
import { quotePlan } from "./pipeline.js";

/**
 * OWNER: Checkout
 * STATUS: Stripe Checkout (test mode). Without STRIPE_SECRET_KEY it runs a labeled mock.
 *
 * The browser sends plan + item ids only. Names and prices come from the plan
 * the server stored, so a tampered request can't change what gets charged.
 * Items flip to purchased only after Stripe says the session is paid, either
 * from the success redirect (confirmCheckout) or the webhook (handleWebhook).
 */

const CLIENT_URL = (process.env.CLIENT_URL || "http://localhost:5173").replace(/\/$/, "");
// Stripe caps each metadata value at 500 characters; item ids are UUIDs.
const METADATA_MAX = 500;

let stripe = makeClient(process.env.STRIPE_SECRET_KEY);
let webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || "";
const mockSessions = new Map();

function makeClient(key) {
  if (!key) return null;
  if (/^(sk|rk)_live_/.test(key)) {
    throw new Error("STRIPE_SECRET_KEY is a live key. Use a test key (sk_test_...).");
  }
  return new Stripe(key);
}

/** Tests swap in a fake client; null means mock mode. */
export function configureStripe({ client = null, secret = "" } = {}) {
  stripe = client;
  webhookSecret = secret;
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
    };
  });

  if (new Set(lines.map((line) => line.currency)).size > 1) {
    throw new CheckoutError(409, "Items in one checkout must share a currency.");
  }
  return lines;
}

export async function createCheckout(planId, itemIds) {
  const plan = getPlan(planId);
  if (!plan) throw new CheckoutError(404, "plan not found");
  const lines = cartLines(plan, itemIds);
  const amount = lines.reduce((sum, line) => sum + line.amount, 0);
  const currency = lines[0].currency;

  if (!stripe) {
    const id = `cs_mock_${randomUUID()}`;
    mockSessions.set(id, { planId, itemIds: [...itemIds] });
    return { id, url: successUrl(id), amount, currency, mock: true };
  }

  const metadataIds = itemIds.join(",");
  if (metadataIds.length > METADATA_MAX) {
    throw new CheckoutError(400, "Too many items for one checkout. Pay for fewer at a time.");
  }

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    client_reference_id: planId,
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
    metadata: { plan_id: planId, item_ids: metadataIds },
    success_url: successUrl("{CHECKOUT_SESSION_ID}"),
    cancel_url: `${CLIENT_URL}/?checkout=cancel&plan_id=${encodeURIComponent(planId)}`,
  });
  return { id: session.id, url: session.url, amount, currency, mock: false };
}

/** Called when the browser lands back on success_url. */
export async function confirmCheckout(sessionId) {
  if (typeof sessionId !== "string" || !sessionId) throw new CheckoutError(400, "session_id is required");

  if (sessionId.startsWith("cs_mock_")) {
    const pending = mockSessions.get(sessionId);
    if (!pending) throw new CheckoutError(404, "checkout session not found");
    return { status: "paid", mock: true, plan: markPaid(pending.planId, pending.itemIds, sessionId) };
  }

  if (!stripe) throw new CheckoutError(503, "Stripe is not configured on this server.");
  let session;
  try {
    session = await stripe.checkout.sessions.retrieve(sessionId);
  } catch {
    throw new CheckoutError(404, "checkout session not found");
  }
  const { planId, itemIds } = fromMetadata(session);
  if (session.payment_status !== "paid" && session.payment_status !== "no_payment_required") {
    return { status: session.payment_status || "unpaid", mock: false, plan: getPlan(planId) };
  }
  return { status: "paid", mock: false, plan: markPaid(planId, itemIds, session.id) };
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
  if (paid) {
    const { planId, itemIds } = fromMetadata(event.data.object);
    markPaid(planId, itemIds, event.data.object.id);
  }
  return { received: true, type: event.type };
}

function fromMetadata(session) {
  const planId = session.metadata?.plan_id || session.client_reference_id;
  const itemIds = (session.metadata?.item_ids || "").split(",").filter(Boolean);
  if (!planId || itemIds.length === 0) throw new CheckoutError(400, "Checkout session is missing cart metadata.");
  return { planId, itemIds };
}

/** Idempotent: the redirect and the webhook can both land. */
function markPaid(planId, itemIds, sessionId) {
  const plan = getPlan(planId);
  // Plans live in memory; a restart between paying and returning loses the plan, not the payment.
  if (!plan) return null;
  const paidAt = new Date().toISOString();
  plan.items = plan.items.map((item) =>
    itemIds.includes(item.id) && !item.purchased
      ? { ...item, purchased: true, order: { checkoutSessionId: sessionId, paidAt } }
      : item
  );
  plan.quote = quotePlan(plan.items);
  return plan;
}

function successUrl(sessionId) {
  return `${CLIENT_URL}/?checkout=success&session_id=${sessionId}`;
}
