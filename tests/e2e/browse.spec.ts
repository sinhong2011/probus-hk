import { expect, test } from "@playwright/test";
import { mockTransit } from "./support/mock";

test.beforeEach(async ({ page }) => {
  await mockTransit(page);
});

test("lists every category with a real count", async ({ page }) => {
  await page.goto("/browse");

  await expect(page.getByText("路線分類").first()).toBeVisible({ timeout: 10_000 });

  const tiles = page.locator('a[href^="/browse/"]');
  expect(await tiles.count()).toBeGreaterThan(8);
  // Counts come from the data, so they must be numbers, not placeholders.
  await expect(page.getByText(/\d+\s*條路線/).first()).toBeVisible();
});

test("opening a category lists the routes in it", async ({ page }) => {
  await page.goto("/browse/minibus");

  await expect(page.getByText("專線小巴").first()).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('a[href^="/route/"]').first()).toBeVisible();
});

test("classifies outlying-island routes by operator", async ({ page }) => {
  await page.goto("/browse/islands");

  // NLB route 1 (Mui Wo to Tai O) is in the fixture and belongs here.
  await expect(page.getByText("大澳").first()).toBeVisible({ timeout: 10_000 });
});

test("finds cross-harbour routes from stop coordinates", async ({ page }) => {
  await page.goto("/browse/crossHarbour");

  // Route 102 runs Mei Foo to Shau Kei Wan, so it crosses the harbour even
  // though nothing in its number says so.
  await expect(page.getByText("102").first()).toBeVisible({ timeout: 10_000 });
});

test("a category with nothing in it says so plainly", async ({ page }) => {
  // The fixture has no cross-boundary routes.
  await page.goto("/browse/crossBoundary");
  await expect(page.getByText("揾唔到呢條路線")).toBeVisible({ timeout: 10_000 });
});

test("the trail names the way back out of a category", async ({ page }) => {
  await page.goto("/browse");
  await page.locator('a[href^="/browse/"]').first().click();
  await expect(
    page.locator('a[href^="/route/"]').first().or(page.getByText("揾唔到呢條路線")),
  ).toBeVisible({
    timeout: 10_000,
  });

  // The crumb names where it goes, so it works on a cold open too - unlike a
  // history-based back, which has nothing to pop.
  await page.getByRole("navigation", { name: "breadcrumb" }).getByText("路線分類").click();
  await expect(page).toHaveURL(/\/browse$/);
});
