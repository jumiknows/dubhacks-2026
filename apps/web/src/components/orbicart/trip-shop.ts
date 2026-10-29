/** The trip's shopping state against the DubHacks backend. The backend plan is the single source of
 * truth for offers, the chosen listing, owned items and paid orders. The page only adds a cart toggle. */
import { planBudget, type BudgetPlan, type Kit, type Pick } from "@emberready/domain";
import { api, valued, type Listing, type PlanItem, type ShoppingPlan } from "../esper/api";
import type { OfferComparison } from "../esper/shopping";
import { remainingTripBudget } from "../../lib/trip-budget";

export class Superseded extends Error { name = "Superseded"; }
export const isSuperseded = (error: unknown) => error instanceof Superseded;

/** Hands out tickets. Only the newest ticket's result may land. */
export class Latest {
  private n = 0;
  next(): () => void {
    const id = ++this.n;
    return () => { if (id !== this.n) throw new Superseded("A newer request replaced this one."); };
  }
  cancel() { this.n += 1; }
}

export const inStock = (listing?: Listing | null) => (listing?.inStock ?? listing?.in_stock) === true;
export const chosenIndex = (item: PlanItem) => Math.max(0, item.products.findIndex((row) => row.id === item.synthesis?.best?.id));

/** An item can be bought when its chosen offer is a known, in-stock USD price and the user has not opted out. */
export function cartPicks(plan: ShoppingPlan | null, kit: Kit | null, inCart: Record<string, boolean>): Pick[] {
  return (plan?.items || []).flatMap((item) => {
    const total = item.synthesis?.totalPrice;
    const kitItem = kit?.items.find((row) => row.id === item.id);
    const ok = typeof total === "number" && Number.isFinite(total) && total > 0 && item.quantity > 0 && inStock(item.synthesis?.best)
      && item.synthesis?.currency === "USD" && !item.owned && !item.purchased && inCart[item.id] !== false;
    return ok ? [{ itemId: item.id, name: item.name, unitPrice: total! / item.quantity, quantity: item.quantity, priority: kitItem?.priority || "essential" }] : [];
  });
}

export interface CartState { funds: ReturnType<typeof remainingTripBudget>; allocation: BudgetPlan }

/** Paid orders come off the trip budget first, then the planner decides what the rest buys. */
export function cartState(plan: ShoppingPlan | null, kit: Kit | null, inCart: Record<string, boolean>, budget: number | null): CartState {
  const funds = remainingTripBudget(budget, (plan?.items || []).flatMap((item) => item.order ? [item.order] : []));
  return { funds, allocation: planBudget(cartPicks(plan, kit, inCart), funds.available) };
}

/** Slider order: what the budget buys (in plan order), then rent or borrow, then everything else. */
export function sliderOrder(items: PlanItem[], allocation: BudgetPlan): PlanItem[] {
  const rank = (item: PlanItem) => {
    const bought = allocation.buy.findIndex((row) => row.itemId === item.id);
    if (bought >= 0) return bought;
    const later = allocation.later.findIndex((row) => row.itemId === item.id);
    if (later >= 0) return 100 + later;
    return item.owned || item.purchased ? 300 : 200;
  };
  return items.map((item, index) => ({ item, index })).sort((a, b) => rank(a.item) - rank(b.item) || a.index - b.index).map((row) => row.item);
}

/** Two different offers in the same known currency, defaulting to the chosen one and the next. */
export function comparePair(item: PlanItem, leftId?: string, rightId?: string): [Listing, Listing] {
  const chosen = item.products[chosenIndex(item)];
  const left = leftId ? item.products.find((row) => row.id === leftId) : chosen;
  const right = rightId ? item.products.find((row) => row.id === rightId) : item.products.find((row) => row.id !== left?.id);
  if (!left || !right || left.id === right.id) throw new Error("Choose two different available offers to compare.");
  if (!left.currency || left.currency !== right.currency) throw new Error("Compare offers in the same known currency.");
  return [left, right];
}

const path = (planId: string, itemId?: string) => `/api/plans/${encodeURIComponent(planId)}${itemId ? `/items/${encodeURIComponent(itemId)}` : ""}`;

export interface ProductPlan { plan: ShoppingPlan; recommendations: { itemId: string; message: string | null }[] }

export const shopApi = {
  create: (kit: Kit, title: string, budget: number | null) => api<ProductPlan>("/api/orbicart/plans", "POST", {
    items: kit.items.map(({ id, name, spec, quantity }) => ({ id, name, spec, quantity })), title, budget,
  }),
  refresh: (planId: string) => api<ShoppingPlan>(path(planId)),
  choose: (planId: string, itemId: string, listingId: string) => api<ShoppingPlan>(`${path(planId, itemId)}/listing`, "PUT", { listingId }),
  setOwned: (planId: string, itemId: string, owned: boolean) => api<ShoppingPlan>(path(planId, itemId), "PATCH", { owned }),
  compare: (left: Listing, right: Listing) => api<OfferComparison>("/api/compare", "POST", { left: valued(left), right: valued(right), trust_floor: 0.5 }),
};
