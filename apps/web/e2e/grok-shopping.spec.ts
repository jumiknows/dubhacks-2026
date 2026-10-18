import { test, expect, type Page } from "@playwright/test";
import { shopInstructions, shopTools } from "../src/lib/server/shop-voice";

interface RecordedFrame {
  type: string;
  session?: { instructions?: string; tools?: { name: string }[] };
  item?: { type: string; call_id?: string; output?: string };
}
interface GrokFixture {
  frames: RecordedFrame[];
  url: string | null;
  emit: (event: Record<string, unknown>) => void;
}
type FixtureWindow = Window & { __grokFixture: GrokFixture };
interface ShoppingSnapshot {
  plan_id: string | null;
  focus_item_id: string | null;
  items: { item_id: string; selected_product_id: string | null }[];
  comparison: { item_id: string; left_id: string; right_id: string; loading: boolean; winner_id: string | null } | null;
  cart: { item_ids: string[]; count: number; total: number };
  last_interaction: { type: string } | null;
}

const offers = [
  { id: "shop.example:tent-a", title: "Trail tent", store: "Example Outdoors", price: 80, currency: "USD", available: true, inStock: true, source: "shopify_storefront", why: [], compareAt: null, image: null, url: "https://shop.example/products/tent-a" },
  { id: "shop.example:tent-b", title: "Camp tent", store: "Example Outdoors", price: 60, currency: "USD", available: true, inStock: true, source: "shopify_storefront", why: [], compareAt: null, image: null, url: "https://shop.example/products/tent-b" },
];
const kit = { items: [{ id: "tent", name: "Tent", quantity: 1, spec: "two person", priority: "essential", reason: "Shelter for the trip", evidence: [] }], skipped: [], warnings: [] };

/** Only the provider socket is replaced. All tool handlers and board controls are production code. */
async function installGrokFixture(page: Page) {
  await page.addInitScript(() => {
    const browser = window as unknown as FixtureWindow;
    const NativeWebSocket = window.WebSocket;
    let deliver: (event: Record<string, unknown>) => void = () => { throw new Error("Grok has not connected."); };
    browser.__grokFixture = {
      frames: [], url: null,
      emit(event) { deliver(event); },
    };
    class ScriptedSocket {
      readyState: number = NativeWebSocket.CONNECTING;
      onopen: ((event: Event) => void) | null = null;
      onmessage: ((event: MessageEvent) => void) | null = null;
      onclose: ((event: CloseEvent) => void) | null = null;
      constructor(url: string) {
        browser.__grokFixture.url = url; deliver = this.emit.bind(this);
        setTimeout(() => { this.readyState = NativeWebSocket.OPEN; this.onopen?.(new Event("open")); }, 0);
      }
      send(data: string) {
        const frame = JSON.parse(data) as RecordedFrame;
        browser.__grokFixture.frames.push(frame);
        if (frame.type === "session.update") queueMicrotask(() => this.emit({ type: "session.updated" }));
      }
      emit(event: Record<string, unknown>) { this.onmessage?.(new MessageEvent("message", { data: JSON.stringify(event) })); }
      close() { this.readyState = NativeWebSocket.CLOSED; this.onclose?.(new CloseEvent("close")); }
    }
    window.WebSocket = new Proxy(NativeWebSocket, {
      construct(target, args) {
        return String(args[0]).startsWith("wss://api.x.ai/v1/realtime?")
          ? new ScriptedSocket(String(args[0]))
          : Reflect.construct(target, args);
      },
    });
    // This regression exercises typed tools. No microphone or provider audio is required.
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
      configurable: true,
      value: async () => { throw new DOMException("Fixture microphone is disabled.", "NotAllowedError"); },
    });
  });
}

async function latestSnapshot(page: Page): Promise<ShoppingSnapshot | null> {
  return page.evaluate(() => {
    const frames = (window as unknown as FixtureWindow).__grokFixture.frames;
    const instructions = frames.filter((frame) => frame.type === "session.update" && frame.session?.instructions?.includes("Current shopping board snapshot")).at(-1)?.session?.instructions;
    return instructions ? JSON.parse(instructions.slice(instructions.lastIndexOf("\n") + 1)) : null;
  });
}

async function providerTool(page: Page, name: string, args: Record<string, unknown>, callId = name): Promise<Record<string, unknown>> {
  await page.evaluate(({ name, args, callId }) => {
    (window as unknown as FixtureWindow).__grokFixture.emit({ type: "response.function_call_arguments.done", name, arguments: JSON.stringify(args), call_id: callId });
  }, { name, args, callId });
  const output = () => page.evaluate((id) => {
    const frame = (window as unknown as FixtureWindow).__grokFixture.frames.find((frame) => frame.item?.type === "function_call_output" && frame.item.call_id === id);
    return frame?.item?.output ? JSON.parse(frame.item.output) as Record<string, unknown> : null;
  }, callId);
  await expect.poll(output).not.toBeNull();
  await page.evaluate(() => (window as unknown as FixtureWindow).__grokFixture.emit({ type: "response.done" }));
  return (await output())!;
}

test("Grok shares the gesture board, saved offers and cart, while payment requires explicit clicks", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await installGrokFixture(page);
  const plan = {
    id: "trip-plan", title: "Kit for Seattle, WA", status: "ready", planType: "individual", allowBreak: false,
    items: [{ id: "tent", name: "Tent", reason: "Shelter for the trip", quantity: 1, purchased: false, owned: false, order: undefined as { amount: number; currency: string; checkoutSessionId: string } | undefined, products: offers, synthesis: { best: offers[0], totalPrice: 80, currency: "USD", warnings: [] } }],
  };
  const selections: string[] = [];
  let comparisons = 0, checkoutRequests = 0, confirmations = 0, catalogRequests = 0, planRefreshes = 0;
  await page.route("**/api/**", async (route) => {
    const request = route.request(); const path = new URL(request.url()).pathname;
    if (path === "/api/trip") return route.fulfill({ json: { trip: { destination: "Seattle", startDate: "2026-10-24", nights: 1, people: 1, budget: 200, owned: [], fireWarnings: true }, place: { name: "Seattle", region: "WA", country: "US", latitude: 47.6, longitude: -122.3 }, forecastDays: [], evidence: {}, unavailable: [], kit, tookMs: 1 } });
    if (path === "/api/fires") return route.fulfill({ json: { fires: [] } });
    if (path === "/api/orbicart/plans") {
      catalogRequests += 1;
      expect(request.postDataJSON()).toEqual({ items: [{ id: "tent", name: "Tent", spec: "two person", quantity: 1 }], title: "Kit for Seattle, WA", budget: 200 });
      return route.fulfill({ json: { plan, recommendations: [{ itemId: "tent", name: "Tent", quantity: 1, status: "ok", message: null, products: offers }], failures: [] } });
    }
    if (path === "/api/voice/shop-session") {
      expect(request.method()).toBe("POST");
      return route.fulfill({ json: { token: "fixture-ephemeral-token", model: "grok-voice-fixture", instructions: shopInstructions("2026-10-18"), tools: shopTools, sessionSeconds: 300 } });
    }
    if (path === "/api/plans/trip-plan/items/tent/listing") {
      expect(request.method()).toBe("PUT");
      const body = request.postDataJSON(); expect(Object.keys(body)).toEqual(["listingId"]);
      const chosen = offers.find((offer) => offer.id === body.listingId); expect(chosen).toBeDefined();
      selections.push(chosen!.id);
      plan.items[0].synthesis = { best: chosen!, totalPrice: chosen!.price, currency: "USD", warnings: [] };
      return route.fulfill({ json: plan });
    }
    if (path === "/api/compare") {
      comparisons += 1;
      const body = request.postDataJSON();
      const left = offers.find((offer) => offer.id === body.left.id), right = offers.find((offer) => offer.id === body.right.id);
      expect(left).toBeDefined(); expect(right).toBeDefined();
      return route.fulfill({ json: { left, right, pick: left!.price < right!.price ? "left" : "right", reasons: ["Camp tent costs $20 less for the same requested quantity."], axes: [{ name: "Price", left: `$${left!.price}`, right: `$${right!.price}` }] } });
    }
    if (path === "/api/checkout") {
      checkoutRequests += 1;
      expect(request.method()).toBe("POST"); expect(request.postDataJSON()).toEqual({ planId: plan.id, itemIds: ["tent"] });
      expect(plan.items[0].synthesis.best.id).toBe(offers[1].id);
      return route.fulfill({ json: { id: "mock-grok-order", amount: 6000, currency: "usd", mock: true } });
    }
    if (path === "/api/checkout/mock-grok-order") {
      confirmations += 1; expect(request.method()).toBe("GET"); plan.items[0].purchased = true;
      plan.items[0].order = { amount: 6000, currency: "usd", checkoutSessionId: "mock-grok-order" };
      return route.fulfill({ json: { status: "paid", mock: true, plan, receipt: { orderId: "MOCK-GROK", amount: 6000, currency: "usd", placedAt: "2026-10-18T12:00:00Z", sandboxes: [] } } });
    }
    if (path === "/api/plans/trip-plan") { planRefreshes += 1; expect(request.method()).toBe("GET"); return route.fulfill({ json: plan }); }
    return route.fulfill({ status: 404, json: { error: `Unexpected request ${path}` } });
  });

  await page.goto("/");
  await page.getByLabel("Message Grok").fill("I'm camping in Seattle this weekend with $200");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  const board = page.getByRole("region", { name: "Gesture shopping board", exact: true });
  await expect(board.getByRole("heading", { name: "Your kit for Seattle, WA" })).toBeVisible();
  await page.getByRole("button", { name: "Talk to Grok", exact: true }).click();
  await expect(page.getByRole("button", { name: "Listening · stop", exact: true })).toBeVisible();
  await expect.poll(() => latestSnapshot(page)).toMatchObject({ plan_id: plan.id, focus_item_id: null, cart: { item_ids: ["tent"], total: 80 } });

  // Mouse controls use the same native board paths as gesture controls and quietly update Grok.
  await board.locator(".shop-group[data-group-id='trip-plan']").click();
  const options = page.getByRole("dialog", { name: "Tent product options", exact: true });
  await expect(options).toBeVisible();
  await expect.poll(() => latestSnapshot(page)).toMatchObject({ focus_item_id: "tent", last_interaction: { type: "open_item" } });
  await page.screenshot({ path: testInfo.outputPath("board-and-grok-open.png"), fullPage: true });
  await board.getByRole("button", { name: "Remove Tent", exact: true }).click();
  await expect.poll(() => latestSnapshot(page)).toMatchObject({ cart: { item_ids: [], count: 0, total: 0 } });
  await options.getByRole("button", { name: "Add chosen to cart", exact: true }).click();
  await expect.poll(() => selections).toEqual([offers[0].id]);
  await expect.poll(() => latestSnapshot(page)).toMatchObject({ cart: { item_ids: ["tent"], count: 1, total: 80 } });
  await options.getByRole("button", { name: "Compare best two", exact: true }).click();
  await expect(page.getByRole("region", { name: "Offer comparison", exact: true })).toContainText("Camp tent costs $20 less");
  await expect.poll(() => latestSnapshot(page)).toMatchObject({ comparison: { left_id: offers[0].id, right_id: offers[1].id, loading: false, winner_id: offers[1].id } });
  await page.screenshot({ path: testInfo.outputPath("board-and-grok-comparison.png"), fullPage: true });
  expect(await page.evaluate(() => (window as unknown as FixtureWindow).__grokFixture.frames.filter((frame) => frame.type === "response.create").length)).toBe(0);

  // Provider tool calls read and change the same persisted selection, comparison and cart.
  const shopping = await providerTool(page, "get_shopping_state", {});
  expect(shopping).toMatchObject({ focus_item_id: "tent", items: [{ item_id: "tent", selected_product_id: offers[0].id }], comparison: { winner_id: offers[1].id }, cart: { item_ids: ["tent"], total: 80 } });
  const compared = await providerTool(page, "compare_offers", { item_id: "tent", left_id: offers[1].id, right_id: offers[0].id });
  expect(compared).toMatchObject({ comparison: { left_id: offers[1].id, right_id: offers[0].id, winner_id: offers[1].id } }); expect(comparisons).toBe(2);
  expect(await providerTool(page, "select_product", { item_id: "tent", product_id: offers[1].id })).toMatchObject({ ok: true, selected: "Camp tent", price: 60 });
  expect(selections).toEqual([offers[0].id, offers[1].id]);
  await expect(options.locator(`[data-gesture-id='product:tent:${offers[1].id}']`)).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => latestSnapshot(page)).toMatchObject({ items: [{ item_id: "tent", selected_product_id: offers[1].id }], cart: { total: 60 } });
  expect(await providerTool(page, "set_cart_item", { item_id: "tent", in_cart: false }, "remove-from-cart")).toMatchObject({ cart: { item_ids: [], count: 0 } });
  await expect(board.getByRole("button", { name: "Remove Tent", exact: true })).toHaveCount(0);
  expect(await providerTool(page, "set_cart_item", { item_id: "tent", in_cart: true }, "add-to-cart")).toMatchObject({ cart: { item_ids: ["tent"], total: 60 } });
  await expect(board.getByRole("button", { name: "Remove Tent", exact: true })).toBeVisible();

  expect(await providerTool(page, "review_checkout", {})).toMatchObject({ review_open: true, payment_authorized: false });
  const review = page.getByRole("dialog", { name: "Your cart", exact: true });
  await expect(review).toContainText("Camp tent"); await expect(review).toContainText("$60.00");
  expect(checkoutRequests).toBe(0); expect(confirmations).toBe(0); expect(plan.items[0].purchased).toBe(false);
  await review.getByRole("button", { name: "Continue to checkout", exact: true }).click();
  const checkout = page.getByRole("dialog", { name: "Mock checkout", exact: true });
  await expect(checkout).toBeVisible(); expect(checkoutRequests).toBe(1); expect(confirmations).toBe(0);
  await checkout.getByRole("button", { name: "Place mock order", exact: true }).click();
  await expect(page.getByLabel("Order receipt")).toContainText("MOCK-GROK");
  expect(confirmations).toBe(1); expect(plan.items[0].purchased).toBe(true);
  const refreshed = await providerTool(page, "find_products", {});
  expect(refreshed).toMatchObject({
    items: [{ item_id: "tent", selected: offers[1].id }],
    budget_plan: { known: true, original: 200, spent: 60, available: 140 },
    cart: { item_ids: [], count: 0 },
    shopping_state: { plan_id: plan.id, items: [{ item_id: "tent", owned: false, purchased: true, selected_product_id: offers[1].id }] },
  });
  expect(planRefreshes).toBe(1); expect(catalogRequests).toBe(1); expect(confirmations).toBe(1);
  await expect.poll(() => latestSnapshot(page)).toMatchObject({ items: [{ item_id: "tent", purchased: true }], cart: { item_ids: [], count: 0 } });
  await page.getByRole("button", { name: "Listening · stop", exact: true }).click();
  expect(errors).toEqual([]);
});
