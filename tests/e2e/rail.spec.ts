import { expect, test } from "@playwright/test";
import { mockTransit } from "./support/mock";

test.beforeEach(async ({ page }) => {
  await mockTransit(page);
});

/**
 * The keypad's letters were hand-written and happened to omit every letter an
 * MTR line code needs, so ten lines of railway were unreachable and nothing in
 * the suite noticed. The fixture now carries a real line.
 */
test("a line code can be typed on the keypad", async ({ page }) => {
  await page.goto("/search");

  for (const key of ["T", "W", "L"]) {
    await page.getByRole("button", { name: key, exact: true }).click();
  }

  await expect(page.locator('a[href^="/route/"]').first()).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText("荃灣").first()).toBeVisible();
});

test("a line carries its own colour rather than one plate for the whole railway", async ({
  page,
}) => {
  await page.goto("/route/TWL%2B1%2BCentral%2BTsuen%20Wan");

  await expect(page.getByText("往 荃灣").first()).toBeVisible({ timeout: 15_000 });

  // Tsuen Wan line red, the value MTR prints on its own maps. Riders navigate
  // by these; one maroon plate for all ten lines said nothing.
  const background = await page
    .getByText("TWL", { exact: true })
    .first()
    .evaluate((el) => getComputedStyle(el.parentElement as HTMLElement).background);
  expect(background).toContain("rgb(230, 0, 18)");
});

test("a rail arrival says which platform", async ({ page }) => {
  await page.goto("/route/TWL%2B1%2BCentral%2BTsuen%20Wan");
  await expect(page.locator("[data-stop-seq]").first()).toBeVisible({ timeout: 15_000 });

  // Minutes alone are half an answer on a railway: the train may be leaving
  // from the other side of the island.
  await expect(page.getByText(/月台\s*\d/).first()).toBeVisible({ timeout: 15_000 });
});

/**
 * The railway had no front door. It was reachable only as fifty entries in a
 * category list sorted by route number, which put all twenty-seven light rail
 * routes above the ten MTR lines - so in practice the underground was missing.
 */
test("the railway has a screen of its own, organised as lines", async ({ page }) => {
  await page.goto("/rail");

  // A line, not a pair of routes: "Central to Tsuen Wan" is not what anyone
  // calls it.
  await expect(page.getByText("荃灣綫")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("16 個站")).toBeVisible();

  const tabs = page.getByRole("navigation", { name: "導覽" });
  await expect(tabs.getByRole("link", { name: "鐵路" })).toHaveAttribute("aria-current", "page");
});

test("a line's direction opens that direction's route", async ({ page }) => {
  await page.goto("/rail");
  await expect(page.getByText("荃灣綫")).toBeVisible({ timeout: 15_000 });

  await page.getByRole("link", { name: /往 荃灣/ }).first().click();
  await expect(page).toHaveURL(/\/route\/TWL/);
  await expect(page.getByText("往 荃灣").first()).toBeVisible();
});

test("a station can be bookmarked like any other stop", async ({ page }) => {
  await page.goto("/route/TWL%2B1%2BCentral%2BTsuen%20Wan");
  await expect(page.locator("[data-stop-seq]").first()).toBeVisible({ timeout: 15_000 });

  await page.locator("[data-stop-seq]").nth(2).getByRole("button").first().click();
  const pin = page.locator('[data-open="true"]').getByRole("button", { name: "pin" });
  await pin.click();
  await expect(pin).toHaveAttribute("aria-pressed", "true");

  // Bookmarks are route-agnostic, but a railway station is the one place where
  // that had never actually been exercised.
  await page.goto("/saved");
  await expect(page.getByText("往 荃灣").first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("TWL").first()).toBeVisible();
});
