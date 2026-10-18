import { post, request } from "./integration/transport.js";
export { request } from "./integration/transport.js";

export function createPlan(prompt, category) { return post("/api/plans", { prompt, category, async: true }); }
export function getPlans() { return request("/api/plans"); }
export function getPlan(planId) { return request(`/api/plans/${encodeURIComponent(planId)}`); }
export function updateItem(planId, itemId, changes) { return request(`/api/plans/${encodeURIComponent(planId)}/items/${encodeURIComponent(itemId)}`, { method: "PATCH", body: JSON.stringify(changes) }); }
export function setPurchased(planId, itemId, purchased) { return updateItem(planId, itemId, { purchased }); }
export function compareItems(left, right, trustFloor = 0.5) { return post("/api/compare", { left, right, trust_floor: trustFloor }); }
export function topItems(items, { limit = 10, trustFloor = 0.5 } = {}) { return post("/api/top", { items, limit, trust_floor: trustFloor }); }
export function chooseListing(planId, itemId, listingId) { return request(`/api/plans/${encodeURIComponent(planId)}/items/${encodeURIComponent(itemId)}/listing`, { method: "PUT", body: JSON.stringify({ listingId }) }); }
export function startCheckout(planId, itemIds) { return post("/api/checkout", { planId, itemIds }); }
export function cancelCheckout(sessionId) { return post(`/api/checkout/${encodeURIComponent(sessionId)}/cancel`); }
export function confirmCheckout(sessionId) { return request(`/api/checkout/${encodeURIComponent(sessionId)}`); }
export function getMe() { return request("/api/me", { signal: AbortSignal.timeout(3000) }); }
export function saveProfile(profile) { return request("/api/me/profile", { method: "PUT", body: JSON.stringify(profile) }); }
export function getCalendarSuggestions() { return request("/api/calendar/suggestions"); }
export function signOut() { return post("/api/auth/logout"); }
export const GOOGLE_SIGN_IN_URL = "/api/auth/google/start";
export function deleteAccount() { return request("/api/me", { method: "DELETE" }); }
export async function voiceAvailable() {
  try { const body = await request("/api/voice-health", { signal: AbortSignal.timeout(2500) }); return ["configured", "live"].includes(body?.integrations?.gemini_live); }
  catch { return false; }
}
