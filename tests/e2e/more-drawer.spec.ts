import { expect, test } from "@playwright/test";
import { mockTransit } from "./support/mock";

test.beforeEach(async ({ page }) => {
  await mockTransit(page);
});

const ROUTES = ["/", "/starred", "/search", "/rail", "/notices"] as const;

for (const route of ROUTES) {
  test(`more drawer hides the bottom tab bar on ${route}`, async ({ page }) => {
    await page.goto(route);
    await expect(page.getByRole("button", { name: "更多" })).toBeVisible({ timeout: 10_000 });

    const phoneBar = page.locator("nav.lg\\:hidden").first();
    await expect(phoneBar).toBeVisible();

    await page.getByRole("button", { name: "更多" }).click();
    await expect(page.getByRole("dialog", { name: "更多" })).toBeVisible();

    await expect
      .poll(async () => phoneBar.evaluate((el) => el.classList.contains("hidden")))
      .toBe(true);

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
      .poll(async () => phoneBar.evaluate((el) => !el.classList.contains("hidden")))
      .toBe(true);
  });
}

test("starred sort sheet hides the bottom tab bar", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      "probus:saved",
      JSON.stringify([
        {
          id: "1+1+CHUK YUEN ESTATE+STAR FERRY@9ED7E93749ABAE67",
          routeKey: "1+1+CHUK YUEN ESTATE+STAR FERRY",
          co: "kmb",
          stopId: "9ED7E93749ABAE67",
          seq: 2,
          group: "返工",
        },
      ]),
    );
  });

  await page.goto("/starred");
  await expect(page.getByRole("button", { name: "排序" })).toBeVisible({ timeout: 10_000 });

  const phoneBar = page.locator("nav.lg\\:hidden").first();
  await page.getByRole("button", { name: "排序" }).click();
  await expect(page.getByRole("dialog", { name: "排序" })).toBeVisible();

  await expect
    .poll(async () => phoneBar.evaluate((el) => el.classList.contains("hidden")))
    .toBe(true);
});
