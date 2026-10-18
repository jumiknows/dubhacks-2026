import { randomUUID } from "node:crypto";

/**
 * OWNER: Checkout
 * STATUS: Demo only. No money moves.
 *
 * Places a mock order for checkout's mock mode. Lines whose listing came from a
 * sample store (services/stores/providers/fakestore.js, dummyjson.js) are also sent
 * to that store's sandbox cart endpoint, so the receipt carries a cart id the
 * store itself issued. Neither sandbox persists anything.
 *
 *   Fake Store  POST https://fakestoreapi.com/carts    echoes the cart with an id
 *   DummyJSON   POST https://dummyjson.com/carts/add   prices the cart from its catalog
 *
 * Other lines are recorded locally. A sandbox that is down never fails the order.
 * Set MOCK_ORDER_SANDBOX=off to skip the network entirely (offline demos).
 */

const TIMEOUT_MS = 4000;
const DEMO_CARD = { brand: "visa", last4: "4242" };

const SANDBOXES = {
  fakestore: {
    label: "Fake Store API",
    url: "https://fakestoreapi.com/carts",
    body: (lines) => ({
      userId: 1,
      date: new Date().toISOString().slice(0, 10),
      products: lines.map((line) => ({ productId: line.sampleId, quantity: line.quantity })),
    }),
    read: (body) => ({ cartId: body.id ?? null, total: null }),
  },
  dummyjson: {
    label: "DummyJSON",
    url: "https://dummyjson.com/carts/add",
    body: (lines) => ({ userId: 1, products: lines.map((line) => ({ id: line.sampleId, quantity: line.quantity })) }),
    // DummyJSON silently drops ids it doesn't know, so count what it accepted.
    read: (body, lines) => ({
      cartId: body.id ?? null,
      total: typeof body.total === "number" ? body.total : null,
      accepted: Array.isArray(body.products) ? body.products.length : 0,
      rejected: lines.length - (Array.isArray(body.products) ? body.products.length : 0),
    }),
  },
};

/** "fakestore-3" → { source: "fakestore", id: 3 }, matching rawProduct() ids. */
export function sampleRef(listing) {
  const match = /^(fakestore|dummyjson)-(\d+)$/.exec(String(listing?.id ?? ""));
  if (!match) return null;
  if (listing.source && listing.source !== match[1]) return null;
  return { source: match[1], id: Number(match[2]) };
}

export async function placeMockOrder({ lines, amount, currency }, { fetchImpl = fetch, env = process.env } = {}) {
  const groups = new Map();
  const local = [];
  for (const line of lines) {
    const ref = sampleRef(line.listing);
    if (!ref) {
      local.push(line.itemId);
      continue;
    }
    if (!groups.has(ref.source)) groups.set(ref.source, []);
    groups.get(ref.source).push({ ...line, sampleId: ref.id });
  }

  const offline = env.MOCK_ORDER_SANDBOX === "off";
  const sandboxes = await Promise.all(
    [...groups].map(([source, group]) => (offline ? skipped(source, group) : submit(source, group, fetchImpl)))
  );

  return {
    orderId: `ord_mock_${randomUUID().slice(0, 8)}`,
    placedAt: new Date().toISOString(),
    amount,
    currency,
    card: DEMO_CARD,
    mock: true,
    sandboxes,
    local,
  };
}

async function submit(source, group, fetchImpl) {
  const sandbox = SANDBOXES[source];
  const base = { provider: source, label: sandbox.label, itemIds: group.map((line) => line.itemId) };
  try {
    const response = await fetchImpl(sandbox.url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(sandbox.body(group)),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) return { ...base, status: "unreachable", error: `HTTP ${response.status}` };
    return { ...base, status: "accepted", ...sandbox.read(await response.json(), group) };
  } catch (err) {
    return { ...base, status: "unreachable", error: err?.name === "TimeoutError" ? "timed out" : "network error" };
  }
}

function skipped(source, group) {
  return {
    provider: source,
    label: SANDBOXES[source].label,
    itemIds: group.map((line) => line.itemId),
    status: "skipped",
  };
}
