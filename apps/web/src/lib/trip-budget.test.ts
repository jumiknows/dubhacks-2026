import { describe, expect, it } from "vitest";
import { planBudget } from "@emberready/domain";
import { remainingTripBudget } from "./trip-budget";
describe("settled camping budget", () => {
  it("defers another $80 item after an $80 purchase from a $100 budget", () => {
    const paid = remainingTripBudget(100, [{ amount: 8000, currency: "usd" }]);
    const plan = planBudget([{ itemId: "tent", name: "Tent", quantity: 1, unitPrice: 80, priority: "essential" }], paid.available);
    expect(paid).toEqual({ known: true, original: 100, spent: 80, available: 20 });
    expect(plan.buy).toEqual([]); expect(plan.later.map((item) => item.name)).toEqual(["Tent"]);
  });
  it("adds paid line snapshots once each using exact cents", () => {
    expect(remainingTripBudget(10.3, [{ amount: 101, currency: "USD" }, { amount: 202, currency: "usd" }])).toEqual({ known: true, original: 10.3, spent: 3.03, available: 7.27 });
  });
  it("holds unknown-currency and invalid paid amounts", () => {
    expect(remainingTripBudget(100, [{ amount: 8000, currency: "CAD" }])).toMatchObject({ known: false, available: 0 });
    expect(remainingTripBudget(100, [{ amount: NaN, currency: "usd" }])).toMatchObject({ known: false, available: 0 });
  });
  it("retains uncapped trips and never makes an overspent remainder negative", () => {
    expect(remainingTripBudget(null, [{ amount: 8000, currency: "usd" }])).toMatchObject({ known: true, spent: 80, available: null });
    expect(remainingTripBudget(50, [{ amount: 8000, currency: "usd" }])).toMatchObject({ known: true, spent: 80, available: 0 });
  });
});
