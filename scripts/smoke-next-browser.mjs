import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium, expect } from "@playwright/test";

function pathOf(response) {
  return new URL(response.url()).pathname;
}

function nextResponse(page, path, method) {
  return page.waitForResponse(response => pathOf(response) === path && response.request().method() === method);
}

async function jsonResponse(pending, label) {
  const response = await pending;
  assert(response.ok(), `${label} returned HTTP ${response.status()}`);
  return response.json();
}

function parseEvents(text) {
  return text.split(/\r?\n\r?\n/).flatMap(block => {
    const name = block.match(/^event: (.+)$/m)?.[1];
    const data = block.split(/\r?\n/).filter(line => line.startsWith("data: ")).map(line => line.slice(6)).join("\n");
    return name && data ? [[name, JSON.parse(data)]] : [];
  });
}

/** Validate built Next pages through the real Express gateway and offline Python API. */
export async function smokeBrowser(base, cookie) {
  const origin = new URL(base).origin;
  const sessionCookie = String(cookie).split(";")[0].trim();
  assert(/^pb_sid=[A-Za-z0-9_-]+$/.test(sessionCookie), "Browser smoke requires the completed onboarding session cookie");
  const browser = await chromium.launch({
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}),
    args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
  });
  const errors = [];
  const apiFailures = [];
  const blockedOrigins = new Set();
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, serviceWorkers: "block" });
    const separator = sessionCookie.indexOf("=");
    await context.addCookies([{ name: sessionCookie.slice(0, separator), value: sessionCookie.slice(separator + 1), url: origin, httpOnly: true, sameSite: "Lax" }]);
    // Keep every application/API response real. Only external browser traffic is blocked.
    await context.route("**/*", route => {
      const target = new URL(route.request().url());
      if (target.origin === origin || ["blob:", "data:"].includes(target.protocol)) return route.continue();
      blockedOrigins.add(target.origin);
      return route.abort();
    });
    const page = await context.newPage();
    page.setDefaultTimeout(20000);
    page.setDefaultNavigationTimeout(45000);
    page.on("pageerror", error => errors.push(error.message));
    page.on("response", response => {
      const url = new URL(response.url());
      if (url.origin !== origin || !url.pathname.startsWith("/api/") || response.status() < 400) return;
      // Research artifacts are optional. Their unavailable response is a supported UI state.
      if (/^\/api\/risk(?:\/|$)/.test(url.pathname) && response.status() === 503) return;
      apiFailures.push(`${response.request().method()} ${url.pathname}: HTTP ${response.status()}`);
    });

    const profile = await jsonResponse(page.request.get(`${origin}/api/me`), "Completed account profile");
    assert(profile.profile?.completedAt, "The browser session must use the completed smoke-test profile");
    await page.goto(`${origin}/shop`);
    await expect(page.getByRole("heading", { name: "OrbiCart shopping workspace", exact: true })).toBeVisible();
    await page.getByRole("textbox", { name: "Shopping plan prompt", exact: true }).fill("I need to prepare for camping.");
    const created = nextResponse(page, "/api/plans", "POST");
    await page.getByRole("button", { name: "Build list", exact: true }).click();
    const plan = await jsonResponse(created, "Browser plan creation");
    const tent = plan.items.find(item => item.name === "2-person tent");
    assert(tent && plan.id, "The actual camping template must return its tent item");
    const itemTarget = `item:${plan.id}:${tent.id}`;
    await page.locator(`[data-gesture-object="${itemTarget}"]`).click();
    const dialog = page.getByRole("dialog", { name: tent.name, exact: true });
    const choices = dialog.getByRole("button", { name: "Choose this offer", exact: true });
    await expect(choices.nth(1)).toBeEnabled({ timeout: 30000 });
    const pricedPlan = await jsonResponse(page.request.get(`${origin}/api/plans/${plan.id}`), "Background-priced plan");
    const pricedTent = pricedPlan.items.find(item => item.id === tent.id);
    const listingId = pricedTent.products[1].id;
    assert(pricedPlan.items.every(item => item.synthesis?.totalPrice > 0), "Camping fixtures should provide comparable prices for every checkout item");
    const comparison = nextResponse(page, "/api/compare", "POST");
    const compareBoxes = dialog.getByRole("checkbox", { name: "Compare", exact: true });
    await compareBoxes.nth(0).check();
    await compareBoxes.nth(1).check();
    const compared = await jsonResponse(comparison, "Real listing comparison");
    assert(compared.left && compared.right && compared.axes.length, "Python comparison must return both listings and evidence axes");
    await expect(dialog.getByRole("region", { name: "Offer comparison", exact: true })).toBeVisible();
    const selected = nextResponse(page, `/api/plans/${plan.id}/items/${tent.id}/listing`, "PUT");
    await choices.nth(1).click();
    const chosen = await jsonResponse(selected, "Server-owned offer selection");
    assert.equal(chosen.items.find(item => item.id === tent.id).synthesis.best.id, listingId);
    const persisted = await jsonResponse(page.request.get(`${origin}/api/plans/${plan.id}`), "Persisted selected offer");
    assert.equal(persisted.items.find(item => item.id === tent.id).selectedListingId, listingId);
    await dialog.getByRole("button", { name: `Close ${tent.name}`, exact: true }).click();

    const checkoutRegion = page.getByRole("region", { name: "Checkout", exact: true });
    const opening = nextResponse(page, "/api/checkout", "POST");
    await checkoutRegion.getByRole("button", { name: /^Review checkout/ }).click();
    const opened = await opening;
    const cart = opened.request().postDataJSON();
    assert.equal(cart.planId, plan.id);
    assert.deepEqual([...cart.itemIds].sort(), pricedPlan.items.map(item => item.id).sort(), "The browser must send every open priced item by ID");
    const checkout = await jsonResponse(opened, "Mock checkout creation");
    assert(checkout.mock && checkout.amount > 0, "Browser smoke must use a positive mock checkout");
    const mockDialog = page.getByRole("dialog", { name: "Mock checkout", exact: true });
    await expect(mockDialog).toContainText("No real payment");
    const confirming = nextResponse(page, `/api/checkout/${checkout.id}`, "GET");
    await mockDialog.getByRole("button", { name: "Place mock order", exact: true }).click();
    const paid = await jsonResponse(confirming, "Mock checkout confirmation");
    assert(paid.mock && paid.status === "paid" && paid.receipt?.orderId);
    await expect(page.getByRole("status", { name: "Order receipt", exact: true })).toContainText(paid.receipt.orderId);
    const purchased = await jsonResponse(page.request.get(`${origin}/api/plans/${plan.id}`), "Purchased plan");
    assert(purchased.items.every(item => item.purchased), "All priced open items selected by the workspace must be purchased");
    assert.equal(purchased.items.find(item => item.id === tent.id).synthesis.best.id, listingId);
    console.log("PASS: real Next workspace, background pricing, Python comparison, persisted offer selection and mock checkout");

    await page.getByRole("button", { name: "Shopping assistant", exact: true }).click();
    await page.getByRole("textbox", { name: "Ask the assistant", exact: true }).fill("Find a fragrance-free moisturizer for dry skin under $40.");
    const sessionCreated = nextResponse(page, "/api/conjure/session", "POST");
    const chatResponse = nextResponse(page, "/api/conjure/chat", "POST");
    await page.getByRole("button", { name: "Ask", exact: true }).click();
    const assistantSession = await jsonResponse(sessionCreated, "Assistant session");
    const chat = await chatResponse;
    assert(chat.ok() && chat.headers()["content-type"].includes("text/event-stream"));
    const events = parseEvents(await chat.text());
    const done = events.findLast(([name]) => name === "done")?.[1];
    const results = events.find(([name, data]) => name === "action" && data.action === "show_results")?.[1];
    assert(done?.source === "fallback" && done.grounded && results?.product_ids.length, "The real Python fallback must stream grounded product results");
    await expect(page.getByRole("button", { name: "Find store offers", exact: true }).first()).toBeVisible();
    await page.getByText("Signed shopping rules & demo cart", { exact: true }).click();
    const rulesRegistered = nextResponse(page, "/api/conjure/mandate/intent", "POST");
    await page.getByRole("button", { name: "Sign these shopping rules", exact: true }).click();
    const mandate = await jsonResponse(rulesRegistered, "Browser-signed shopping rules");
    assert(mandate.mandate_id, "Python must verify and register the browser's ECDSA rules signature");
    await expect(page.getByText(/Active signed rules:/)).toBeVisible();
    const stagedResponse = nextResponse(page, "/api/conjure/checkout/stage", "POST");
    await page.getByRole("button", { name: "Propose demo cart", exact: true }).click();
    const staged = await jsonResponse(stagedResponse, "Signed-rules cart proposal");
    assert(staged.policy.allowed && staged.cart_payload && staged.cart.cart_hash);
    await expect(page.getByRole("heading", { name: "Review proposed demo cart", exact: true })).toBeVisible();
    const authorizedResponse = nextResponse(page, "/api/conjure/checkout/intent", "POST");
    await page.getByRole("button", { name: "Sign demo cart", exact: true }).click();
    const authorized = await jsonResponse(authorizedResponse, "Browser-signed cart authorization");
    assert(authorized.mock && authorized.amount > 0 && authorized.cart_hash === staged.cart.cart_hash);
    await expect(page.getByRole("status").filter({ hasText: "Simulated authorization for" })).toBeVisible();
    const audit = await jsonResponse(page.request.get(`${origin}/api/conjure/audit/${assistantSession.session_id}`), "Signed-cart audit");
    assert(audit.valid && audit.entries.some(entry => entry.kind === "cart_signed") && audit.entries.some(entry => entry.kind === "payment_intent_created"));
    console.log("PASS: real Python SSE fallback and separately verified browser signatures for rules and demo authorization");

    await page.getByRole("button", { name: "Reviews and website safety", exact: true }).click();
    const reviewResponse = nextResponse(page, "/api/conjure/reviews/demo", "POST");
    await page.getByRole("button", { name: "Try synthetic review analysis", exact: true }).click();
    const review = await jsonResponse(reviewResponse, "Synthetic review evidence");
    assert(review.source.is_mock && review.analysis.provenance === "demo" && review.analysis.analyzed_count > 0);
    await expect(page.getByText("Synthetic demo reviews", { exact: true })).toBeVisible();
    await page.getByRole("textbox", { name: "Website URL", exact: true }).fill("https://example.com/");
    const safetyResponse = nextResponse(page, "/api/conjure/websites/assess", "POST");
    await page.getByRole("button", { name: "Check website", exact: true }).click();
    const safety = await jsonResponse(safetyResponse, "Unknown website assessment");
    assert(safety.decision === "hold" && !safety.allowed);
    await expect(page.getByText("Needs review", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Open checked store website", exact: true })).toHaveCount(0);

    await page.goto(`${origin}/fires`);
    await expect(page.getByRole("heading", { name: "Chelan", exact: true })).toBeVisible();
    await expect(page.locator(".briefing")).toContainText("replay mode");
    await page.goto(`${origin}/gesture-lab`);
    await expect(page.getByRole("heading", { name: "Objects with more beneath.", exact: true })).toBeVisible();
    // Restore the plan just purchased through the real backend onto the main
    // board. The trip envelope is synthetic and contains no weather claims.
    await page.evaluate(saved => sessionStorage.setItem("orbicart.trip", JSON.stringify(saved)), {
      result: {
        trip: { destination: "Seattle", startDate: "2026-10-24", nights: 1, people: 1, budget: null, owned: [], fireWarnings: true },
        place: { name: "Seattle", region: "WA", country: "US", latitude: 47.6, longitude: -122.3 },
        forecastDays: [], evidence: {}, unavailable: [{ source: "Weather", reason: "Synthetic smoke trip" }],
        kit: { items: purchased.items.map(item => ({ id: item.id, name: item.name, quantity: item.quantity, spec: "", priority: "essential", reason: "Smoke-test shopping plan", evidence: [] })), skipped: [], warnings: [] },
      },
      backendPlan: purchased, choice: {}, inCart: {},
      recs: purchased.items.map(item => ({ itemId: item.id, name: item.name, quantity: item.quantity, status: "ok", products: item.products.map(product => ({ ...product, available: product.inStock, why: [] })) })),
    });
    await page.goto(origin);
    const board = page.getByRole("region", { name: "Gesture shopping board", exact: true });
    const grok = page.getByRole("complementary", { name: "Grok shopping assistant", exact: true });
    await expect(board).toBeVisible(); await expect(grok).toBeVisible();
    await expect(page.locator(".maplibregl-map")).toHaveCount(0);
    const boardBox = await board.boundingBox(); const grokBox = await grok.boundingBox();
    assert(boardBox && grokBox && boardBox.x + boardBox.width <= grokBox.x + 2, "Grok must stay beside the shopping board on desktop");
    await board.locator(`[data-group-id="${plan.id}"]`).click();
    await board.locator(`[data-gesture-object="item:${tent.id}"]`).click();
    await expect(board.getByRole("dialog", { name: `${tent.name} product options`, exact: true })).toBeVisible();
    await expect(grok).toContainText(`Shared with Grok: ${tent.name}`);
    await mkdir(new URL("../test-results/", import.meta.url), { recursive: true });
    await page.screenshot({ path: fileURLToPath(new URL("../test-results/integrated-next.png", import.meta.url)), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "The main shopping board must fit a phone viewport");
    const mobileOptions = await board.getByRole("dialog", { name: `${tent.name} product options`, exact: true }).boundingBox();
    assert(mobileOptions && mobileOptions.x >= 0 && mobileOptions.x + mobileOptions.width <= 391, "Offer inspection must stay within the mobile board");
    await expect(grok).toBeVisible();
    await page.screenshot({ path: fileURLToPath(new URL("../test-results/integrated-next-mobile.png", import.meta.url)), fullPage: true });
    assert.deepEqual(apiFailures, [], "Required local API requests failed in the built application");
    assert.deepEqual(errors, [], "The built Next application emitted uncaught browser errors");
    console.log("PASS: evidence analysis, unknown-site hold, preserved wildfire replay and gesture lab, plus the main shopping board beside Grok");
    return { planId: plan.id, selectedListingId: listingId, purchasedItems: purchased.items.length, assistantProducts: results.product_ids.length, signedCartHash: staged.cart.cart_hash, blockedExternalOrigins: blockedOrigins.size };
  } finally {
    await browser.close();
  }
}
