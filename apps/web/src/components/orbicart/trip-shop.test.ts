import { afterEach, describe, expect, it, vi } from "vitest";
import type { Kit } from "@emberready/domain";
import type { PlanItem, ShoppingPlan } from "../esper/api";
import { Latest, cartState, chosenIndex, comparePair, isSuperseded, shopApi, sliderOrder } from "./trip-shop";

const offer = (id: string, price: number, extra = {}) => ({ id, title: id, store: "REI", price, currency: "USD", inStock: true, ...extra });
const item = (id: string, price: number, extra: Partial<PlanItem> = {}): PlanItem => ({
  id, name: id, quantity: 1, products: [offer(`${id}-a`, price), offer(`${id}-b`, price + 10)],
  synthesis: { best: offer(`${id}-a`, price), totalPrice: price, currency: "USD" }, ...extra,
});
const plan = (items: PlanItem[]): ShoppingPlan => ({ id: "p1", title: "Kit", items });
const kit = { items: [{ id: "tent", priority: "essential" }, { id: "headlamp", priority: "essential" }, { id: "rain-jacket", priority: "conditions" }], skipped: [] } as unknown as Kit;

afterEach(() => vi.unstubAllGlobals());

describe("request tickets", () => {
  it("lets only the newest request land", () => {
    const latest = new Latest();
    const first = latest.next(); const second = latest.next();
    expect(second).not.toThrow();
    let caught: unknown; try { first(); } catch (error) { caught = error; }
    expect(isSuperseded(caught)).toBe(true);
    latest.cancel(); expect(() => second()).toThrow();
  });
});

describe("cart and budget", () => {
  it("buys protective and safety items first and defers big tickets", () => {
    const { allocation } = cartState(plan([item("tent", 150), item("headlamp", 30), item("rain-jacket", 60)]), kit, {}, 100);
    expect(allocation.buy.map((row) => row.itemId)).toEqual(["rain-jacket", "headlamp"]);
    expect(allocation.later.map((row) => row.itemId)).toEqual(["tent"]);
  });
  it("skips owned, purchased, opted-out and out-of-stock items", () => {
    const items = [item("tent", 50, { owned: true }), item("headlamp", 30, { purchased: true }), item("rain-jacket", 60),
      item("stove", 40, { synthesis: { best: offer("stove-a", 40, { inStock: false }), totalPrice: 40, currency: "USD" } })];
    expect(cartState(plan(items), kit, { "rain-jacket": false }, null).allocation.buy).toEqual([]);
  });
  it("takes paid orders off the budget", () => {
    const items = [item("tent", 80, { purchased: true, order: { amount: 8000, currency: "usd" } }), item("headlamp", 30)];
    const state = cartState(plan(items), kit, {}, 100);
    expect(state.funds).toMatchObject({ spent: 80, available: 20 });
    expect(state.allocation.later.map((row) => row.itemId)).toEqual(["headlamp"]);
  });
  it("orders the slider by what the budget buys", () => {
    const items = [item("tent", 150), item("headlamp", 30, { owned: true }), item("rain-jacket", 60)];
    const { allocation } = cartState(plan(items), kit, {}, 100);
    expect(sliderOrder(items, allocation).map((row) => row.id)).toEqual(["rain-jacket", "tent", "headlamp"]);
  });
});

describe("offers", () => {
  it("finds the chosen offer and compares it with the next one", () => {
    const row = item("tent", 100, { synthesis: { best: offer("tent-b", 110), totalPrice: 110, currency: "USD" } });
    expect(chosenIndex(row)).toBe(1);
    expect(comparePair(row).map((listing) => listing.id)).toEqual(["tent-b", "tent-a"]);
    expect(() => comparePair(row, "tent-a", "tent-a")).toThrow(/two different/);
  });
  it("calls the backend routes with encoded IDs", async () => {
    const fetch = vi.fn(async (_url: string, _init: RequestInit) => new Response(JSON.stringify({ id: "p 1", title: "Kit", items: [] }), { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    await shopApi.choose("p 1", "tent/x", "L1");
    await shopApi.setOwned("p 1", "tent", true);
    expect(fetch.mock.calls.map(([url, init]) => [url, init.method, init.body])).toEqual([
      ["/api/plans/p%201/items/tent%2Fx/listing", "PUT", JSON.stringify({ listingId: "L1" })],
      ["/api/plans/p%201/items/tent", "PATCH", JSON.stringify({ owned: true })],
    ]);
  });
  it("surfaces backend error messages", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: { message: "Stores did not respond." } }), { status: 502 })));
    await expect(shopApi.create(kit, "Kit", 100)).rejects.toThrow("Stores did not respond.");
  });
});
