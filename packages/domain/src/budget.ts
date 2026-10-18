/**
 * What a budget buys from a kit. A whole camping kit rarely fits a small budget, so instead of
 * splitting the money thinly, buy the destination-specific and small essentials first and list
 * the big shelter and sleep items to rent, borrow or budget for. Pure and deterministic.
 */

export interface Pick {
  itemId: string;
  name: string;
  unitPrice: number;
  quantity: number;
  /** "conditions" items exist because of the destination's evidence. */
  priority: "essential" | "conditions";
}

export interface BudgetPlan {
  budget: number | null;
  buy: Pick[];
  later: Pick[];
  total: number;
  fullKitTotal: number;
  remaining: number | null;
}

/** Shelter and sleep gear: the items people most often rent or borrow. */
export const BIG_TICKET = new Set(["tent", "sleeping-bag", "sleeping-pad"]);

/** Destination items that add comfort rather than protection from cold, sun, rain, snow or smoke. */
export const COMFORT = new Set(["dry-bags", "boot-care", "gaiters", "guylines", "trekking-poles"]);

/** Essentials to buy before anything else that is not destination-specific, most important first. */
export const SAFETY = ["first-aid", "water-filter", "headlamp"];

const cost = (pick: Pick) => Math.round(pick.unitPrice * pick.quantity * 100) / 100;

export function planBudget(picks: Pick[], budget: number | null): BudgetPlan {
  const fullKitTotal = Math.round(picks.reduce((sum, pick) => sum + cost(pick), 0) * 100) / 100;
  if (budget === null) return { budget, buy: picks, later: [], total: fullKitTotal, fullKitTotal, remaining: null };
  // Protective destination items first, then safety essentials, then comfort items the conditions
  // suggest, then other small essentials, then shelter and sleep gear. Kit order breaks ties.
  const rankOf = (pick: Pick) =>
    BIG_TICKET.has(pick.itemId) ? 4
      : pick.priority === "conditions" ? (COMFORT.has(pick.itemId) ? 2 : 0)
      : SAFETY.includes(pick.itemId) ? 1 : 3;
  const position = (pick: Pick) => (SAFETY.includes(pick.itemId) ? SAFETY.indexOf(pick.itemId) : picks.indexOf(pick));
  const order = [...picks].sort((a, b) => rankOf(a) - rankOf(b) || position(a) - position(b));
  const buy: Pick[] = [];
  const later: Pick[] = [];
  let total = 0;
  for (const pick of order) {
    if (total + cost(pick) <= budget + 1e-9) { buy.push(pick); total += cost(pick); }
    else later.push(pick);
  }
  total = Math.round(total * 100) / 100;
  return { budget, buy, later, total, fullKitTotal, remaining: Math.round((budget - total) * 100) / 100 };
}
