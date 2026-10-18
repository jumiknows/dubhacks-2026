import { expect, test } from "@playwright/test";

test("replay briefing follows the selected community", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "What was observed near this community?" })).toBeVisible();
  await expect(page.getByText("Washington observation replay")).toBeVisible();
  const spokane = page.getByRole("button", { name: /Spokane/ });
  await spokane.click();
  await expect(spokane).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("heading", { name: "Spokane" }).first()).toBeVisible();
  await page.getByRole("button", { name: "Live" }).click();
  await expect(page.getByText(/FIRMS_MAP_KEY|Live observations|live response/i)).toBeVisible();
  await page.getByRole("button", { name: "Play spoken briefing" }).click();
  await expect(page.locator(".voice-note")).toContainText("XAI_API_KEY");
});
