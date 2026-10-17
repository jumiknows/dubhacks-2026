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
