async function request(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return data;
}

export function createPlan(prompt) {
  return request("/api/plans", {
    method: "POST",
    body: JSON.stringify({ prompt }),
  });
}

export function setPurchased(planId, itemId, purchased) {
  return request(`/api/plans/${planId}/items/${itemId}`, {
    method: "PATCH",
    body: JSON.stringify({ purchased }),
  });
}

export function compareItems(left, right, trustFloor = 0.5) {
  return request("/api/compare", {
    method: "POST",
    body: JSON.stringify({ left, right, trust_floor: trustFloor }),
  });
}

export function topItems(items, { limit = 10, trustFloor = 0.5 } = {}) {
  return request("/api/top", {
    method: "POST",
    body: JSON.stringify({ items, limit, trust_floor: trustFloor }),
  });
}

export function getPlan(planId) {
  return request(`/api/plans/${planId}`);
}

export function chooseListing(planId, itemId, listingId) {
  return request(`/api/plans/${planId}/items/${itemId}/listing`, {
    method: "PUT",
    body: JSON.stringify({ listingId }),
  });
}

// cart = [{ planId, itemIds }]. Returns { id, url, amount, currency, mock }.
// Stripe: send the browser to url. Mock: confirm in place to place the demo order.
export function startCheckout(cart) {
  return request("/api/checkout", {
    method: "POST",
    body: JSON.stringify({ cart }),
  });
}

// After Stripe redirects back, or the mock sheet confirms. Returns { status, mock, plans, receipt? }.
export function confirmCheckout(sessionId) {
  return request(`/api/checkout/${encodeURIComponent(sessionId)}`);
}

// Typed assistant. Returns { reply, events: UI_UPDATE[], source: "llm" | "rules" }.
export function plannerChat(body) {
  return request("/api/conjure/planner/chat", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

// Express health: { ok, stripe: "mock" | "test" }. Never throws.
export async function serverHealth() {
  try {
    return await request("/api/health");
  } catch {
    return null;
  }
}

// Which integrations the Python API has configured (voice, LLM). Never throws.
export async function assistantHealth() {
  try {
    return await request("/api/conjure/health");
  } catch {
    return null;
  }
}
