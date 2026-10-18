import { describe, expect, it } from "vitest";
import { planBudget, type Pick } from "./budget";

const pick = (itemId: string, unitPrice: number, priority: Pick["priority"] = "essential", quantity = 1): Pick => ({ itemId, name: itemId, unitPrice, quantity, priority });

describe("planBudget", () => {
  const picks = [pick("tent", 150), pick("sleeping-bag", 60), pick("headlamp", 24), pick("first-aid", 23), pick("water-filter", 18), pick("rain-jacket", 104, "conditions"), pick("dry-bags", 16, "conditions")];

  it("buys destination items in kit order, then safety essentials, and defers shelter and sleep gear", () => {
    const plan = planBudget([pick("tent", 150), pick("sleeping-bag", 60), pick("headlamp", 24), pick("first-aid", 23), pick("water-filter", 18), pick("rain-jacket", 104, "conditions"), pick("dry-bags", 16, "conditions")], 200);
    expect(plan.buy.map((p) => p.itemId)).toEqual(["rain-jacket", "first-aid", "water-filter", "headlamp", "dry-bags"]);
    expect(plan.later.map((p) => p.itemId)).toEqual(["tent", "sleeping-bag"]);
    expect(plan.total).toBe(185);
    expect(plan.remaining).toBe(15);
    expect(plan.fullKitTotal).toBe(395);
  });

  it("keeps the most important destination item even when a cheaper one comes later", () => {
    const plan = planBudget([pick("rain-jacket", 104, "conditions"), pick("dry-bags", 65, "conditions"), pick("warm-layer", 72, "conditions")], 200);
    expect(plan.buy.map((p) => p.itemId)).toEqual(["rain-jacket", "warm-layer"]);
  });

  it("buys protection and safety before comfort items, whatever their price", () => {
    const moab = [pick("gaiters", 115, "conditions"), pick("warm-layer", 72, "conditions"), pick("sun-kit", 11.49, "conditions"), pick("trekking-poles", 100, "conditions"),
      pick("tent", 150), pick("headlamp", 24), pick("stove", 35), pick("water-filter", 38), pick("first-aid", 14)];
    const plan = planBudget(moab, 200);
    expect(plan.buy.map((p) => p.itemId)).toEqual(["warm-layer", "sun-kit", "first-aid", "water-filter", "headlamp", "stove"]);
    expect(plan.later.map((p) => p.itemId)).toEqual(["gaiters", "trekking-poles", "tent"]);
  });

  it("puts safety essentials ahead of other small essentials", () => {
    const plan = planBudget([pick("stove", 35), pick("headlamp", 24), pick("first-aid", 23)], 50);
    expect(plan.buy.map((p) => p.itemId)).toEqual(["first-aid", "headlamp"]);
    expect(plan.later.map((p) => p.itemId)).toEqual(["stove"]);
  });

  it("counts quantity and keeps everything without a budget", () => {
    const plan = planBudget([pick("headlamp", 24, "essential", 2)], null);
    expect(plan.total).toBe(48);
    expect(plan.later).toEqual([]);
  });

  it("skips an item that does not fit but keeps filling with cheaper ones", () => {
    const plan = planBudget([pick("rain-jacket", 150, "conditions"), pick("headlamp", 24), pick("first-aid", 23)], 60);
    expect(plan.buy.map((p) => p.itemId)).toEqual(["first-aid", "headlamp"]);
    expect(plan.remaining).toBe(13);
    expect(plan.later.map((p) => p.itemId)).toEqual(["rain-jacket"]);
  });
});
