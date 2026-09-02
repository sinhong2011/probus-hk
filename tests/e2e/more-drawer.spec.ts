import { expect, test } from "@playwright/test";
import { mockTransit } from "./support/mock";

test.beforeEach(async ({ page }) => {
  await mockTransit(page);
});

test("mobile more drawer hides the bottom tab bar", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("link", { name: "主頁" })).toBeVisible({ timeout: 10_000 });

  const phoneBar = page.locator("nav.lg\\:hidden").first();
  await expect(phoneBar).toBeVisible();

  await expect
    .poll(async () =>
      phoneBar.evaluate((el) => {
        const rect = el.getBoundingClientRect();
        return Math.max(0, Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0));
      }),
    )
    .toBeGreaterThan(0);

  await page.getByRole("button", { name: "更多" }).click();

  // The bar must vanish on the same frame the sheet opens, not after a slide.
  await expect
    .poll(async () => phoneBar.evaluate((el) => el.classList.contains("hidden")))
    .toBe(true);

  await expect(page.getByRole("dialog", { name: "更多" })).toBeVisible();

  await expect(phoneBar).toHaveAttribute("aria-hidden", "true");

  await expect
    .poll(async () =>
      phoneBar.evaluate((el) => {
        const rect = el.getBoundingClientRect();
        return Math.max(0, Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0));
      }),
    )
    .toBe(0);

  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "更多" })).toBeHidden();
  await expect
    .poll(async () => phoneBar.evaluate((el) => el.classList.contains("hidden")))
    .toBe(false);
  await expect(phoneBar).not.toHaveAttribute("aria-hidden", "true");
});
