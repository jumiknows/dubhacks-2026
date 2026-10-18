import { randomUUID } from "node:crypto";
import Stripe from "stripe";
import { getPlan } from "../store.js";
import { placeMockOrder } from "./mockOrder.js";
import { quotePlan } from "./pipeline.js";
import { MAX_MONEY_CENTS, normalizeCurrency, parseCents, validQuantity } from "./synthesizeBot.js";

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

const CLIENT_URL = (process.env.CLIENT_URL || process.env.APP_ORIGIN || "http://localhost:3001").replace(/\/$/, "");
// Stripe caps each metadata value at 500 characters; item ids are UUIDs.
const METADATA_MAX = 500;
const MAX_GROUPS = 20;

let stripe = makeClient(process.env.STRIPE_SECRET_KEY);
let webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || "";
let mockOrderOptions = {};
const checkoutSessions = new Map();

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
  checkoutSessions.clear();
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
  if (!Array.isArray(itemIds) || itemIds.length === 0 || itemIds.length > 100) {
    throw new CheckoutError(400, "Select at least one item to buy.");
  }
  if (itemIds.some((id) => typeof id !== "string") || new Set(itemIds).size !== itemIds.length) {
    throw new CheckoutError(400, "itemIds must be unique strings.");
  }

  const lines = itemIds.map((id) => {
    const item = plan.items.find((row) => row.id === id);
    if (!item) throw new CheckoutError(404, "An item in the cart is no longer on this plan.");
    if (item.purchased || item.order) throw new CheckoutError(409, `${item.name} is already purchased.`);
    if (item.owned) throw new CheckoutError(409, `${item.name} is already owned.`);
    const currency = normalizeCurrency(item.synthesis?.currency);
    const amount = parseCents(item.synthesis?.totalPrice, currency);
    const best = item.synthesis?.best;
    const unitAmount = parseCents(best?.price, best?.currency);
    if (amount === null || amount <= 0 || !validQuantity(item.quantity) || !best || best.inStock !== true ||
        currency !== normalizeCurrency(best.currency) || unitAmount === null ||
        BigInt(unitAmount) * BigInt(item.quantity) !== BigInt(amount)) {
      throw new CheckoutError(409, `${item.name} has no price yet.`);
    }
    return {
      itemId: item.id,
      name: item.name,
      description: item.synthesis.summary || null,
      image: typeof best?.image === "string" && best.image.startsWith("https://") ? best.image : null,
      amount,
      currency: currency.toLowerCase(),
      quantity: item.quantity,
      listing: best ? { id: best.id, source: best.source ?? null } : null,
    };
  });

  if (new Set(lines.map((line) => line.currency)).size > 1) {
    throw new CheckoutError(409, "Items in one checkout must share a currency.");
  }
  if (lines.reduce((sum, line) => sum + BigInt(line.amount), 0n) > MAX_MONEY_CENTS) {
    throw new CheckoutError(409, "Checkout amount exceeds the supported safe amount.");
  }
  return lines;
}

/** Reject edits while a checkout can still be paid, including provider creation. */
export function assertItemUnlocked(planId, itemId) {
  const pending = [...new Set(checkoutSessions.values())].find((entry) =>
    entry.cart.some((group) => group.planId === planId && group.itemIds.includes(itemId)) && ["creating", "open", "confirming"].includes(entry.state));
  if (pending) throw new CheckoutError(409, "This item has a pending checkout. Finish or cancel it before changing the cart.");
}

function committedTripCents(plan) {
  let total = 0n;
  const paidSessions = new Set();
  const amountFor = (amount, currency) => {
    if (!Number.isSafeInteger(amount) || amount < 0 || String(currency).toLowerCase() !== "usd") {
      throw new CheckoutError(409, "The trip's previous payment or pending amount cannot be compared with its USD budget.");
    }
    return BigInt(amount);
  };
  // Session id and local cancellation token point to the same object. Count it once.
  for (const entry of new Set(checkoutSessions.values())) {
    if (!entry.cart.some((group) => group.planId === plan.id)) continue;
    const planAmount = entry.lines.filter((line) => line.planId === plan.id).reduce((sum, line) => sum + line.amount, 0);
    if (entry.state === "paid") {
      if (entry.cart.length > 1 && (entry.completedReceipt.amount !== entry.amount || entry.completedReceipt.currency !== entry.currency)) {
        throw new CheckoutError(409, "The multi-plan payment needs reconciliation before its trip budgets can be reused.");
      }
      total += amountFor(entry.cart.length === 1 ? entry.completedReceipt.amount : planAmount, entry.completedReceipt.currency);
      paidSessions.add(entry.id);
    } else if (["creating", "open", "confirming"].includes(entry.state)) {
      total += amountFor(planAmount, entry.currency);
    }
  }
  // Retain paid-order accounting if a snapshot was restored without its session map.
  for (const item of plan.items) {
    if (item.order && !paidSessions.has(item.order.checkoutSessionId)) {
      total += amountFor(item.order.amount, item.order.currency);
    }
  }
  return total;
}

export function createCheckout(planId, itemIds) {
  return createCartCheckout([{ planId, itemIds }]);
}

/** One atomically reserved order across one or more stored plans. */
export async function createCartCheckout(groups) {
  if (!Array.isArray(groups) || groups.length < 1 || groups.length > MAX_GROUPS ||
      groups.some((group) => !group || typeof group !== "object" || Array.isArray(group) ||
        Object.keys(group).some((key) => !["planId", "itemIds"].includes(key)))) {
    throw new CheckoutError(400, "Select items from 1-20 plans.");
  }
  if (new Set(groups.map((group) => group.planId)).size !== groups.length) {
    throw new CheckoutError(400, "Combine each plan's selected items into one cart group.");
  }
  const lines = [];
  const snapshots = [];
  for (const group of groups) {
    const plan = typeof group.planId === "string" ? getPlan(group.planId) : null;
    if (!plan) throw new CheckoutError(404, "plan not found");
    const groupLines = cartLines(plan, group.itemIds).map((line) => ({ ...line, planId: plan.id }));
    for (const id of group.itemIds) assertItemUnlocked(plan.id, id);
    const groupAmount = groupLines.reduce((sum, line) => sum + BigInt(line.amount), 0n);
    if (plan.source === "orbicart_catalog" && plan.preferences?.budgetMax != null) {
      const budget = parseCents(plan.preferences.budgetMax, "USD");
      if (budget === null || groupLines[0].currency !== "usd" || committedTripCents(plan) + groupAmount > BigInt(budget)) {
        throw new CheckoutError(409, "Paid, pending and selected camping items exceed the trip budget. Cancel another checkout, choose a smaller cart or update the trip budget.");
      }
    }
    lines.push(...groupLines);
    snapshots.push({ planId: plan.id, items: structuredClone(plan.items.filter((item) => group.itemIds.includes(item.id))) });
  }
  if (lines.length > 100) throw new CheckoutError(400, "Select at most 100 items in one checkout.");
  if (new Set(lines.map((line) => line.currency)).size !== 1) throw new CheckoutError(409, "Items in one checkout must share a currency.");
  const total = lines.reduce((sum, line) => sum + BigInt(line.amount), 0n);
  if (total > MAX_MONEY_CENTS) throw new CheckoutError(409, "Checkout amount exceeds the supported safe amount.");
  const amount = Number(total);
  const currency = lines[0].currency;
  const mock = !stripe;
  const reference = `co_${randomUUID()}`;
  const cart = groups.map((group) => ({ planId: group.planId, itemIds: [...group.itemIds] }));
  const pending = {
    reference, id: null, planId: cart[0].planId, itemIds: cart[0].itemIds, cart, snapshots,
    lines: structuredClone(lines), amount, currency, state: "creating", mock, receipt: null,
  };
  // Reserve before the first provider await so two requests cannot charge a cart twice.
  checkoutSessions.set(reference, pending);
  try {
    if (mock) {
      pending.id = `cs_mock_${randomUUID()}`;
      pending.url = successUrl(pending.id);
    } else {
      const metadata = { checkout_reference: reference };
      cart.forEach((group, index) => {
        const value = `${group.planId}|${group.itemIds.join(",")}`;
        if (value.length > METADATA_MAX) throw new CheckoutError(400, "Too many items for one checkout. Pay for fewer at a time.");
        metadata[`cart_${index}`] = value;
      });
      if (cart.length === 1) {
        metadata.plan_id = cart[0].planId;
        metadata.item_ids = cart[0].itemIds.join(",");
      }
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
        // This is an application token, with no dependence on Stripe URL interpolation.
        cancel_url: `${CLIENT_URL}/?checkout=cancel&plan_id=${encodeURIComponent(cart[0].planId)}&checkout_id=${reference}`,
      });
      pending.id = session.id;
      pending.url = session.url;
    }
    pending.state = "open";
    checkoutSessions.set(pending.id, pending);
    return { id: pending.id, url: pending.url, amount, currency, mock, cart: structuredClone(cart), priceScope: "items_only", fullTotal: null };
  } catch (err) {
    pending.state = "failed";
    checkoutSessions.delete(reference);
    throw err;
  }
}

/** Called when the browser lands back on success_url. */
export async function confirmCheckout(sessionId) {
  const pending = checkoutFor(sessionId);
  if (pending.state === "paid") return paidResult(pending);
  if (["cancelled", "expired", "failed"].includes(pending.state)) return cancelledResult(pending);
  if (pending.state === "creating") throw new CheckoutError(409, "Checkout is still being created.");
  if (pending.mock) {
    pending.state = "confirming";
    // Keep the promise so a double confirm cannot place two sandbox orders.
    pending.receipt ??= placeMockOrder(
      { lines: pending.lines, amount: pending.amount, currency: pending.currency }, mockOrderOptions
    );
    const receipt = await pending.receipt;
    return settlePaid(pending, null, receipt);
  }
  if (!stripe) throw new CheckoutError(503, "Stripe is not configured on this server.");
  let session;
  try { session = await stripe.checkout.sessions.retrieve(pending.id); }
  catch { throw new CheckoutError(502, "Could not check payment status. Try again before changing the cart."); }
  if (isPaid(session)) return settlePaid(pending, session);
  if (session.status === "expired") {
    pending.state = "expired";
    return cancelledResult(pending);
  }
  return { status: session.payment_status || "unpaid", mock: false, ...currentPlans(pending) };
}

/** Expire the old payable session before allowing a different cart. */
export async function cancelCheckout(sessionId) {
  const pending = checkoutFor(sessionId);
  if (pending.state === "paid") return paidResult(pending);
  if (["cancelled", "expired", "failed"].includes(pending.state)) return cancelledResult(pending);
  if (["creating", "confirming"].includes(pending.state)) throw new CheckoutError(409, "Checkout is processing. Check its status before changing the cart.");
  if (pending.mock) {
    pending.state = "cancelled";
    return cancelledResult(pending);
  }
  if (!stripe) throw new CheckoutError(503, "Stripe is not configured on this server.");
  let session;
  try {
    session = await stripe.checkout.sessions.retrieve(pending.id);
    if (isPaid(session)) return settlePaid(pending, session);
    if (session.status !== "expired") session = await stripe.checkout.sessions.expire(pending.id);
  } catch {
    // A payment can finish between retrieve and expire. Record it instead of
    // opening another checkout for something that has already been paid for.
    try { session = await stripe.checkout.sessions.retrieve(pending.id); }
    catch { throw new CheckoutError(502, "Could not cancel checkout. Try again before changing the cart."); }
    if (isPaid(session)) return settlePaid(pending, session);
    if (session.status !== "expired") throw new CheckoutError(409, "Checkout is still active or processing. Retry its status before changing the cart.");
  }
  if (session.status !== "expired") throw new CheckoutError(409, "Checkout is still active.");
  pending.state = "cancelled";
  return cancelledResult(pending);
}

/** Stripe webhook. rawBody must be the unparsed request Buffer. */
export function handleWebhook(rawBody, signature) {
  if (!stripe || !webhookSecret) throw new CheckoutError(503, "Stripe webhooks are not configured.");
  let event;
  try { event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret); }
  catch { throw new CheckoutError(400, "Invalid Stripe signature."); }
  const session = event.data.object;
  const pending = checkoutSessions.get(session.id) || checkoutSessions.get(session.metadata?.checkout_reference);
  if (pending && !pending.mock) {
    const paid = event.type === "checkout.session.async_payment_succeeded" ||
      (event.type === "checkout.session.completed" && isPaid(session));
    if (paid) settlePaid(pending, session);
    else if (["checkout.session.expired", "checkout.session.async_payment_failed"].includes(event.type) && pending.state !== "paid") {
      pending.state = "expired";
    }
  }
  // A restart loses plans and snapshots together. Unknown sessions never mark
  // an unrelated current cart purchased based only on mutable metadata IDs.
  return { received: true, type: event.type };
}

function checkoutFor(id) {
  if (typeof id !== "string" || !id) throw new CheckoutError(400, "session_id is required");
  const pending = checkoutSessions.get(id);
  if (!pending) throw new CheckoutError(404, "checkout session not found");
  return pending;
}

function isPaid(session) {
  return session.payment_status === "paid" || session.payment_status === "no_payment_required";
}

function currentPlans(pending) {
  const plans = pending.cart.map((group) => getPlan(group.planId)).filter(Boolean);
  return { plan: plans[0] ?? null, plans };
}

function cancelledResult(pending) {
  return { status: "cancelled", mock: pending.mock, ...currentPlans(pending) };
}

function paidResult(pending) {
  return { status: "paid", mock: pending.mock, ...currentPlans(pending), receipt: pending.completedReceipt };
}

/** Record the captured paid offer even if an older caller changed the current row. */
function settlePaid(pending, session, receipt) {
  if (pending.state === "paid") return paidResult(pending);
  pending.state = "paid";
  const paidAt = new Date().toISOString();
  pending.completedReceipt = receipt ? { ...receipt, lines: structuredClone(pending.lines) } : {
    orderId: session?.id ?? pending.id,
    placedAt: paidAt,
    amount: session?.amount_total ?? pending.amount,
    currency: session?.currency ?? pending.currency,
    lines: structuredClone(pending.lines),
    mock: false,
  };
  for (const snapshot of pending.snapshots) {
    const plan = getPlan(snapshot.planId);
    if (!plan) continue;
    plan.items = plan.items.map((current) => {
      const captured = snapshot.items.find((item) => item.id === current.id);
      if (!captured) return current;
      const line = pending.lines.find((entry) => entry.planId === plan.id && entry.itemId === current.id);
      return {
        ...current,
        quantity: captured.quantity,
        synthesis: structuredClone(captured.synthesis),
        selectedListingId: captured.synthesis.best.id,
        purchased: true,
        order: {
          checkoutSessionId: pending.id,
          orderId: pending.completedReceipt.orderId,
          paidAt,
          amount: line.amount,
          currency: line.currency,
          quantity: captured.quantity,
          listing: structuredClone(captured.synthesis.best),
        },
      };
    });
    plan.quote = quotePlan(plan.items, plan.preferences);
  }
  return paidResult(pending);
}

function successUrl(sessionId) {
  return `${CLIENT_URL}/?checkout=success&session_id=${sessionId}`;
}
