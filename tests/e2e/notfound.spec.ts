import { expect, test } from "@playwright/test";
import { mockTransit } from "./support/mock";

test.beforeEach(async ({ page }) => {
  await mockTransit(page);
});

/**
 * An address that names nothing used to fall through to the nearby screen,
 * so a stale link looked like it had worked and a mistyped one showed the
 * wrong page with no word about why.
 */
test("a path that is nothing says so, and offers the way back", async ({ page }) => {
  await page.goto("/this/is/not/a/page");
  await expect(page.getByText("冇呢一頁")).toBeVisible({ timeout: 15_000 });

  await page.getByRole("link", { name: "返去主頁" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator('a[href^="/stop/"]').first()).toBeVisible({ timeout: 15_000 });
});

test("a route, a stop and a line that do not exist each say which", async ({ page }) => {
  await page.goto("/route/NOPE%2B1%2BNowhere%2BNowhere");
  await expect(page.getByText("冇呢條路線")).toBeVisible({ timeout: 15_000 });

  await page.goto("/stop/NOPE");
  await expect(page.getByText("冇呢個車站")).toBeVisible({ timeout: 15_000 });

  await page.goto("/rail/NOPE");
  await expect(page.getByText("冇呢條綫")).toBeVisible({ timeout: 15_000 });
});
