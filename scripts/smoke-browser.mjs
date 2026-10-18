import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium, expect } from "@playwright/test";

/** Exercise the built frontend against actual local Express/Python services. */
export async function smokeBrowser(base, cookie) {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
    const split = cookie.indexOf("=");
    await context.addCookies([{ name: cookie.slice(0, split), value: cookie.slice(split + 1), url: base, httpOnly: true }]);
    await context.route("**/*", route => new URL(route.request().url()).origin === new URL(base).origin ? route.continue() : route.abort());
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(base);
    await expect(page.getByRole("heading", { name: "Be ready for what’s next." })).toBeVisible();
    const hints = page.getByRole("dialog", { name: "How to use gestures" });
    if (await hints.count()) await hints.getByRole("button", { name: "Got it", exact: true }).click();
    await page.getByRole("textbox", { name: "Plan prompt" }).fill("I need to prepare for camping.");
    const created = page.waitForResponse(response => new URL(response.url()).pathname === "/api/plans" && response.request().method() === "POST");
    await page.getByRole("button", { name: "Build list", exact: true }).click();
    const plan = await (await created).json();
    await page.locator(`[data-group-id="${plan.id}"]`).getByRole("button", { name: "Open Camping kit", exact: true }).click();
    await page.getByRole("button", { name: /2-person tent/ }).click();
    const dialog = page.getByRole("dialog", { name: "2-person tent", exact: true });
    const add = dialog.getByRole("button", { name: "Add to cart", exact: true }).first();
    await expect(add).toBeEnabled({ timeout: 20000 });
    const comparisons = dialog.getByRole("checkbox", { name: "Compare", exact: true });
    await comparisons.nth(0).check();
    await comparisons.nth(1).check();
    await expect(dialog.getByRole("region", { name: "Item comparison" })).toBeVisible();
    await add.click();
    await dialog.getByRole("button", { name: "Close 2-person tent" }).click();
    await page.getByRole("button", { name: /Review checkout/ }).click();
    await expect(page.getByText("Demo checkout · no real payment", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Place mock order", exact: true }).click();
    await expect(page.getByRole("status", { name: "Order receipt" })).toBeVisible();
    const updated = await page.request.get(`${base}/api/plans/${plan.id}`);
    assert((await updated.json()).items.find(item => item.name === "2-person tent").purchased);
    await page.getByRole("button", { name: "Shopping assistant", exact: true }).click();
    await page.getByRole("textbox", { name: "Ask the assistant", exact: true }).fill("Find a fragrance-free moisturizer for dry skin under $40.");
    await page.getByRole("button", { name: "Ask", exact: true }).click();
    await expect(page.getByRole("button", { name: "Find store offers", exact: true }).first()).toBeVisible({ timeout: 20000 });
    await page.getByText("Signed shopping rules & demo cart", { exact: true }).click();
    await page.getByRole("button", { name: "Sign these shopping rules", exact: true }).click();
    await expect(page.getByText(/Active signed rules:/)).toBeVisible();
    await page.getByRole("button", { name: "Propose demo cart", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Review proposed demo cart", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Sign demo cart", exact: true }).click();
    await expect(page.getByText(/Simulated authorization for/)).toBeVisible();
    await page.getByRole("button", { name: "Reviews & website safety", exact: true }).click();
    await expect(page.getByRole("region", { name: "Review insights", exact: true })).toBeVisible();
    await expect(page.getByRole("region", { name: "Website safety", exact: true })).toBeVisible();
    await page.getByRole("button", { name: /My plans/ }).click();
    await mkdir(new URL("../client/test-results/", import.meta.url), { recursive: true });
    await page.screenshot({ path: new URL("../client/test-results/integrated-app.png", import.meta.url).pathname, fullPage: true });
    assert.deepEqual(errors, [], "Built application emitted browser errors");
    console.log("PASS: built app in Chromium, pricing/comparison/checkout, assistant stream, browser-signed authorization and evidence workspace");
  } finally {
    await browser.close();
  }
}
