export interface Listing {
  id: string; title: string; store: string; price: number | null; currency: string | null;
  url?: string | null; image?: string | null; inStock?: boolean | null; in_stock?: boolean | null;
  isMock?: boolean; source?: string; warnings?: string[]; trust?: number | null;
  shippingDays?: number | null; shipping_days?: number | null; [key: string]: unknown;
}
export interface PlanItem {
  id: string; name: string; quantity: number; reason?: string; owned?: boolean; purchased?: boolean;
  products: Listing[]; synthesis?: { best?: Listing; totalPrice?: number | null; currency?: string | null; warnings?: string[]; summary?: string }; order?: { amount: number; currency: string; checkoutSessionId?: string; orderId?: string };
}
export interface ShoppingPlan { id: string; title: string; prompt?: string; status?: string; items: PlanItem[]; }
export interface Checkout { id: string; mock: boolean; amount: number; currency: string; url?: string; itemIds?: string[]; }
export interface Receipt { orderId: string; amount: number; currency: string; placedAt: string; sandboxes?: { label: string; status: string; cartId?: string | number }[]; }
export interface CheckoutResult { status: string; mock: boolean; plan: ShoppingPlan; receipt?: Receipt; }
export async function api<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const response = await fetch(path, { method, headers: { "Content-Type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const value = await response.json().catch(() => null);
  if (!response.ok) throw new Error(typeof value?.error === "string" ? value.error : value?.error?.message || (typeof value?.detail === "string" ? value.detail : null) || `Request failed (${response.status})`);
  if (value == null) throw new Error("The server returned an unreadable response.");
  return value as T;
}
export const money = (amount: number | null | undefined, currency: string | null | undefined = "USD") => {
  if (amount == null || !Number.isFinite(amount)) return "Unavailable";
  if (!currency) return `${amount.toFixed(2)} (currency unknown)`;
  try { return new Intl.NumberFormat("en-US", { style: "currency", currency: currency.toUpperCase() }).format(amount); }
  catch { return `${amount.toFixed(2)} (currency unknown)`; }
};
export function valued(product: Listing) {
  return { ...product, in_stock: product.in_stock ?? product.inStock ?? false, bang_per_buck: product.bang_per_buck ?? 0, relevancy: product.relevancy ?? 1, trust: product.trust ?? 0, flags: product.flags ?? [], specs: Object.fromEntries(Object.entries((product.specs || {}) as Record<string, unknown>).map(([key, value]) => [key, String(value)])), review_count: product.review_count ?? product.reviewCount ?? 0, condition: product.condition ?? "new", prime: product.prime ?? false };
}
