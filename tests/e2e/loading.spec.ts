import { expect, test } from "@playwright/test";
import { mockTransit } from "./support/mock";

const ROUTE = "/route/1%2B1%2BCHUK%20YUEN%20ESTATE%2BSTAR%20FERRY";

/**
 * A stop with no answer yet is not a stop with no buses. The two were the same
 * empty array, so every row claimed 暫無班次 for as long as its request took.
 */
test("waiting looks like waiting, not like no service", async ({ page }) => {
  await mockTransit(page);
  // Registered last, so it wins: hold the arrivals back and answer directly.
  await page.route("**/route-eta/**", async (route) => {
    await new Promise((r) => setTimeout(r, 5000));
    await route.fulfill({ json: { data: [] } });
  });

  await page.goto(ROUTE);
  await expect(page.locator("[data-stop-seq]").first()).toBeVisible({ timeout: 15_000 });

  // "No service" is a lie while the answer is still in flight.
  expect(await page.locator(".mb-shimmer").count()).toBeGreaterThan(0);
  await expect(page.getByText("暫無班次").first()).toBeHidden();
});
