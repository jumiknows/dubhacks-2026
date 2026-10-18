import { expect, test } from "@playwright/test";

for (let run = 1; run <= 3; run += 1) {
  test(`clean replay rehearsal ${run}`, async ({ page }, testInfo) => {
    await page.goto("/fires");
    await expect(page.getByRole("heading", { name: "Chelan", exact: true })).toBeVisible();
    const spokane = page.getByRole("button", { name: /Spokane city/ }); await spokane.click();
    await expect(spokane).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(".briefing")).toContainText("Spokane is shown in replay mode");
    await page.getByRole("button", { name: "All in snapshot" }).click();
    await page.locator(".observation-list button").first().click();
    await expect(page.getByRole("heading", { name: "Selected observation" })).toBeVisible();
    await page.locator("#cutoff").focus(); await page.keyboard.press("Home");
    await expect(page.locator(".timeline")).toContainText("Satellite pass 1 of");
    await expect(page.locator("#cutoff")).toHaveAttribute("aria-valuetext", /2026-10-10/);
    await expect(page.locator(".briefing")).toContainText("2026-10-10");
    await page.getByText("Source evidence", { exact: true }).click();
    await expect(page.getByRole("link", { name: "Open provenance and quality report" })).toBeVisible();
    if (run === 1) await page.screenshot({ path: testInfo.outputPath("replay-desktop.png"), fullPage: true });
  });
}

test("WebGL failure retains keyboard list, selection and briefing", async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (kind: string, ...args: unknown[]) {
      if (kind.includes("webgl")) return null;
      return original.apply(this, [kind, ...args] as Parameters<typeof original>);
    } as typeof original;
  });
  await page.goto("/fires");
  await expect(page.getByText(/WebGL could not start/)).toBeVisible();
  await page.getByRole("button", { name: /Spokane city/ }).focus(); await page.keyboard.press("Enter");
  await expect(page.locator(".briefing")).toContainText("Spokane is shown in replay mode");
  await page.getByRole("button", { name: "All in snapshot" }).click();
  await page.locator(".observation-list button").first().focus(); await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Selected observation" })).toBeVisible();
});

test("tile failure has an explicit fallback", async ({ page }) => {
  let tileRequests = 0;
  await page.route("https://tiles.openfreemap.org/**", (route) => { tileRequests += 1; return route.abort(); });
  await page.goto("/fires");
  await expect(page.getByText("Map tiles could not load.", { exact: false })).toBeVisible();
  expect(tileRequests).toBeGreaterThan(0);
  await page.getByRole("button", { name: /Wenatchee city/ }).click();
  await expect(page.locator(".briefing")).toContainText("Wenatchee is shown in replay mode");
});

test("failed live mode never labels replay as live", async ({ page }) => {
  await page.route("**/api/observations?mode=live", (route) => route.fulfill({ status: 502, json: { error: { code: "upstream-failure", message: "NASA is unavailable in this failure test." } } }));
  await page.goto("/fires"); await page.getByRole("button", { name: "Live", exact: true }).click();
  await expect(page.locator(".briefing")).toContainText("A live briefing is unavailable");
  await expect(page.locator(".observation-list button")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Play spoken briefing" })).toBeDisabled();
  await page.getByRole("button", { name: "Replay", exact: true }).click();
  await expect(page.locator(".briefing")).toContainText("replay mode");
});

test("missing Voice credentials preserve text", async ({ page }) => {
  await page.route("**/api/voice/briefing", (route) => route.fulfill({ status: 503, json: { error: { code: "missing-credential", message: "XAI_API_KEY is not configured." } } }));
  await page.goto("/fires"); await page.getByRole("button", { name: "Play spoken briefing" }).click();
  await expect(page.locator(".voice-note")).toContainText("XAI_API_KEY");
  await expect(page.locator(".briefing")).toContainText("replay mode");
});

test("context switch discards delayed speech", async ({ page }) => {
  await page.addInitScript(() => { (window as unknown as { audioPlays: number }).audioPlays = 0; HTMLMediaElement.prototype.play = async function () { (window as unknown as { audioPlays: number }).audioPlays += 1; }; });
  let finish: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => { finish = resolve; });
  await page.route("**/api/voice/briefing", async (route) => { const body = route.request().postDataJSON(); await gate; await route.fulfill({ status: 200, contentType: "audio/mpeg", headers: { "X-Context-Version": `${body.placeId}|${body.snapshotId}|${body.mode}|${body.asOf}` }, body: Buffer.from([1, 2, 3]) }).catch(() => undefined); });
  await page.goto("/fires"); await page.getByRole("button", { name: "Play spoken briefing" }).click();
  await expect(page.locator(".voice-note")).toContainText("Preparing");
  await page.getByRole("button", { name: /Spokane city/ }).click(); finish!();
  await expect(page.locator(".briefing")).toContainText("Spokane");
  expect(await page.evaluate(() => (window as unknown as { audioPlays: number }).audioPlays)).toBe(0);
});

test("mobile layout has no horizontal overflow", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto("/fires");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("replay-mobile.png"), fullPage: true });
  await page.getByRole("button", { name: /Spokane city/ }).click();
  await expect(page.locator(".briefing")).toContainText("Spokane");
});
