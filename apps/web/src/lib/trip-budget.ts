/** Paid snapshots use integer cents. Missing or mixed-currency evidence cannot expand a USD budget. */
export function remainingTripBudget(budget: number | null, orders: { amount: number; currency: string }[]) {
  let spentCents = 0;
  for (const order of orders) {
    if (typeof order.currency !== "string" || order.currency.toUpperCase() !== "USD" || !Number.isSafeInteger(order.amount) || order.amount < 0 || !Number.isSafeInteger(spentCents + order.amount)) return { known: false, original: budget, spent: null, available: 0 };
    spentCents += order.amount;
  }
  if (budget === null) return { known: true, original: null, spent: spentCents / 100, available: null };
  const cents = Math.round(budget * 100);
  if (!Number.isSafeInteger(cents) || budget < 0 || Math.abs(budget * 100 - cents) > 1e-7) return { known: false, original: budget, spent: spentCents / 100, available: 0 };
  return { known: true, original: budget, spent: spentCents / 100, available: Math.max(0, cents - spentCents) / 100 };
}
