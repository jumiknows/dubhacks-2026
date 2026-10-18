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

export function createPlan(prompt, category) {
  return request("/api/plans", {
    method: "POST",
    body: JSON.stringify({ prompt, category }),
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
