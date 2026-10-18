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

export function getMe() {
  return request("/api/me");
}

export function saveProfile(profile) {
  return request("/api/me/profile", {
    method: "PUT",
    body: JSON.stringify(profile),
  });
}

export function getCalendarSuggestions() {
  return request("/api/calendar/suggestions");
}

export function signOut() {
  return request("/api/auth/logout", { method: "POST", body: "{}" });
}

/** Full-page redirect: Google's consent screen, then back to the app. */
export const GOOGLE_SIGN_IN_URL = "/api/auth/google/start";

export function deleteAccount() {
  return request("/api/me", { method: "DELETE" });
}
