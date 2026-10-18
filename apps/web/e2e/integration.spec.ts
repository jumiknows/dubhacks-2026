import { test, expect } from "@playwright/test";

const offers = [
  { id: "shop.example:tent-a", title: "Trail tent", store: "Example Outdoors", price: 80, currency: "USD", available: true, inStock: true, source: "shopify_storefront", why: [], compareAt: null, image: null, url: "https://shop.example/products/tent-a" },
  { id: "shop.example:tent-b", title: "Camp tent", store: "Example Outdoors", price: 60, currency: "USD", available: true, inStock: true, source: "shopify_storefront", why: [], compareAt: null, image: null, url: "https://shop.example/products/tent-b" },
];
const kit = { items: [{ id: "tent", name: "Tent", quantity: 1, spec: "two person", priority: "essential", reason: "Shelter for the trip", evidence: [] }], skipped: [], warnings: [] };
function makePlan() { return { id: "trip-plan", title: "Kit for Seattle, WA", status: "ready", items: [{ id: "tent", name: "Tent", quantity: 1, purchased: false, owned: false, products: offers, synthesis: { best: offers[0], totalPrice: 80, currency: "USD", warnings: [] } }] }; }

test("SpaceX trip and budget flow uses server-owned DubHacks selection and checkout", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
  const plan = makePlan(); let chosen = "";
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/trip") return route.fulfill({ json: { trip: { destination: "Seattle", startDate: "2026-10-24", nights: 1, people: 1, budget: 200, owned: [], fireWarnings: true }, place: { name: "Seattle", region: "WA", latitude: 47.6, longitude: -122.3 }, forecastDays: [], evidence: {}, unavailable: [], kit, tookMs: 1 } });
    if (path === "/api/fires") return route.fulfill({ json: { fires: [] } });
    if (path === "/api/orbicart/plans") { const body = route.request().postDataJSON(); expect(body.items[0].id).toBe("tent"); expect(body.budget).toBe(200); expect(body.items[0]).not.toHaveProperty("products"); return route.fulfill({ json: { plan, recommendations: [{ itemId: "tent", name: "Tent", quantity: 1, status: "ok", message: null, products: offers }], failures: [] } }); }
    if (path.endsWith("/listing")) { chosen = route.request().postDataJSON().listingId; plan.items[0].synthesis = { best: offers[1], totalPrice: 60, currency: "USD", warnings: [] }; return route.fulfill({ json: plan }); }
    if (path === "/api/compare") return route.fulfill({ json: { left: offers[0], right: offers[1], pick: "right", reasons: ["Lower price"], axes: [{ name: "Price", left: "$80", right: "$60" }] } });
    if (path === "/api/checkout") { expect(route.request().postDataJSON()).toEqual({ planId: "trip-plan", itemIds: ["tent"] }); return route.fulfill({ json: { id: "mock-order", amount: 6000, currency: "usd", mock: true } }); }
    if (path === "/api/checkout/mock-order") { plan.items[0].purchased = true; return route.fulfill({ json: { status: "paid", mock: true, plan, receipt: { orderId: "MOCK-TRIP", amount: 6000, currency: "usd", placedAt: "2026-10-18T12:00:00Z", sandboxes: [] } } }); }
    if (path === "/api/plans/trip-plan") return route.fulfill({ json: plan });
    return route.fulfill({ status: 404, json: { error: `Unexpected request ${path}` } });
  });
  await page.goto("/");
  await expect(page.getByRole("navigation", { name: "Applications" })).toBeVisible();
  await page.getByLabel("Message Grok").fill("I'm camping in Seattle this weekend with $200"); await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Your kit for Seattle, WA" })).toBeVisible();
  await page.getByRole("button", { name: "Inspect Tent offers" }).click();
  const dialog = page.getByRole("dialog", { name: "Tent", exact: true });
  await dialog.getByLabel("Compare", { exact: true }).nth(0).check(); await dialog.getByLabel("Compare", { exact: true }).nth(1).check();
  await expect(dialog.getByLabel("Offer comparison")).toContainText("Camp tent");
  await dialog.getByRole("button", { name: "Choose this offer", exact: true }).nth(1).click(); expect(chosen).toBe(offers[1].id);
  await dialog.getByRole("button", { name: "Close Tent", exact: true }).click();
  await page.getByRole("button", { name: "Review checkout · $60.00" }).click(); await page.getByRole("button", { name: "Place mock order" }).click();
  await expect(page.getByLabel("Order receipt")).toContainText("MOCK-TRIP");
  expect(errors).toEqual([]);
});

test("Next shopping workspace preserves comparisons, evidence and accessible mobile inspection", async ({ page }) => {
  const plan = makePlan();
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/me") return route.fulfill({ json: { profile: { completedAt: "2026-10-18" }, google: { available: false }, user: null } });
    if (path === "/api/plans") return route.fulfill({ json: { plans: [plan] } });
    if (path === "/api/conjure/websites/assess") return route.fulfill({ json: { decision: "hold", allowed: false, origin: "https://shop.example", summary: "Reputation evidence is unavailable.", evidence: [], limitations: ["Safety is not guaranteed."] } });
    return route.fulfill({ status: 404, json: { error: path } });
  });
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto("/shop");
  await page.getByRole("button", { name: /Tent To buy/ }).click();
  const dialog = page.getByRole("dialog", { name: "Tent", exact: true }); await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape"); await expect(dialog).toHaveCount(0);
  await page.getByRole("button", { name: "Reviews and website safety", exact: true }).click();
  await page.getByLabel("Website URL").fill("https://shop.example/product"); await page.getByRole("button", { name: "Check website", exact: true }).click();
  await expect(page.getByText("Needs review", { exact: true })).toBeVisible(); await expect(page.getByRole("link", { name: "Open checked store website" })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});

test("Next hosts the existing gesture lab and synthetic expand collapse compare replays", async ({ page }) => {
  test.setTimeout(90_000); await page.goto("/gesture-lab");
  await expect(page.getByRole("heading", { name: "Objects with more beneath." })).toBeVisible();
  for (const name of ["Replay expand", "Replay collapse", "Replay compare"]) { const button = page.getByRole("button", { name, exact: true }); await button.click(); await expect(button).toBeEnabled({ timeout: 15_000 }); }
  await expect(page.getByTestId("comparison")).toBeVisible();
  await expect(page.locator(".lab-error")).toHaveCount(0);
});

test("Next gesture camera initializes its worker and releases synthetic media on stop", async ({ page }) => {
  test.setTimeout(90_000);
  await page.addInitScript(() => {
    const state = window as unknown as { gestureWorkerMessages: string[]; gestureWorkerTerminations: number };
    state.gestureWorkerMessages = []; state.gestureWorkerTerminations = 0;
    const OriginalWorker = window.Worker;
    window.Worker = class extends OriginalWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        this.addEventListener("message", (event: MessageEvent) => { if (typeof event.data?.type === "string") state.gestureWorkerMessages.push(event.data.type); });
      }
      terminate() { state.gestureWorkerTerminations += 1; super.terminate(); }
    };
  });
  await page.goto("/gesture-lab"); await page.getByRole("button", { name: "Start camera", exact: true }).click();
  await expect(page.locator(".lab-local")).toContainText("LIVE", { timeout: 60_000 });
  await expect.poll(() => page.evaluate(() => (window as unknown as { gestureWorkerMessages: string[] }).gestureWorkerMessages)).toContain("ready");
  await expect.poll(() => page.evaluate(() => (window as unknown as { gestureWorkerMessages: string[] }).gestureWorkerMessages)).toContain("result");
  await page.getByRole("button", { name: "Stop", exact: true }).click(); await expect(page.locator(".lab-local")).toContainText("Camera off");
  expect(await page.evaluate(() => (window as unknown as { gestureWorkerTerminations: number }).gestureWorkerTerminations)).toBeGreaterThan(0);
});

test("settled purchases reduce the trip budget shown for remaining kit items", async ({ page }) => {
  const base = makePlan();
  const paidPlan = { ...base, items: [
    { ...base.items[0], purchased: true, order: { amount: 8000, currency: "usd", checkoutSessionId: "paid-1" } },
    { ...base.items[0], id: "sleeping-bag", name: "Sleeping bag" },
  ] };
  const tripResult = { trip: { destination: "Seattle", startDate: "2026-10-24", nights: 1, people: 1, budget: 100, owned: [], fireWarnings: true }, place: { name: "Seattle", region: "WA", latitude: 47.6, longitude: -122.3 }, forecastDays: [], evidence: {}, unavailable: [], kit: { ...kit, items: [...kit.items, { ...kit.items[0], id: "sleeping-bag", name: "Sleeping bag" }] } };
  await page.addInitScript((saved) => sessionStorage.setItem("orbicart.trip", JSON.stringify(saved)), { result: tripResult, backendPlan: paidPlan, choice: {}, inCart: {}, recs: paidPlan.items.map((item) => ({ itemId: item.id, name: item.name, quantity: 1, status: "ok", products: offers })) });
  await page.route("**/api/plans/trip-plan", (route) => route.fulfill({ json: paidPlan }));
  await page.goto("/");
  await expect(page.locator(".oc-meter")).toContainText("$80 spent"); await expect(page.locator(".oc-meter")).toContainText("$20 available");
  await expect(page.getByRole("button", { name: "Rent or borrow", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Choose priced items for checkout", exact: true })).toBeDisabled();
  await expect(page.getByText("Whole kit fits", { exact: true })).toHaveCount(0);
});

test("an in-flight trip request keeps Send disabled until its matching offers finish", async ({ page }) => {
  let release!: () => void; const gate = new Promise<void>((resolve) => { release = resolve; }); let requests = 0;
  await page.route("**/api/trip", async (route) => { requests += 1; await gate; await route.fulfill({ json: { trip: { destination: "Seattle", startDate: "2026-10-24", nights: 1, people: 1, budget: 200, owned: [], fireWarnings: true }, place: { name: "Seattle", region: "WA", latitude: 47.6, longitude: -122.3 }, forecastDays: [], evidence: {}, unavailable: [], kit } }); });
  await page.route("**/api/fires?**", (route) => route.fulfill({ json: { fires: [] } }));
  await page.route("**/api/orbicart/plans", (route) => route.fulfill({ json: { plan: makePlan(), recommendations: [{ itemId: "tent", name: "Tent", quantity: 1, status: "ok", products: offers }], failures: [] } }));
  await page.goto("/"); await page.getByLabel("Message Grok").fill("Camping in Seattle with $200"); await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect.poll(() => requests).toBe(1); await page.getByLabel("Message Grok").fill("Camping in Moab with $100"); await expect(page.getByRole("button", { name: "Send", exact: true })).toBeDisabled();
  release(); await expect(page.getByRole("heading", { name: "Your kit for Seattle, WA" })).toBeVisible(); await expect(page.getByRole("button", { name: "Send", exact: true })).toBeEnabled(); expect(requests).toBe(1);
});
