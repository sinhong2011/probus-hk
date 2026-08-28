import { expect, test } from "@playwright/test";
import { mockTransit } from "./support/mock";

/**
 * The planner hides routes that are not running, so these tests would pass in
 * the afternoon and fail after midnight. Pin the clock to a Wednesday
 * mid-morning in Hong Kong so the result depends on the data, not the hour.
 */
const WEDNESDAY_MORNING = new Date("2026-03-04T02:00:00Z");

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(WEDNESDAY_MORNING);
  await mockTransit(page);
  await page.goto("/plan");
});

/**
 * Picks a destination by typing into the destination field itself. The field is
 * the search box - there is no second one - so it carries a real accessible
 * name rather than only a placeholder.
 */
async function chooseDestination(page: import("@playwright/test").Page, name: string) {
  const destination = page.getByLabel("目的地");
  await destination.click();
  await destination.fill(name);
  await page.locator(`button:has-text("${name}")`).first().click();
}

test("starts from your location and asks only for a destination", async ({ page }) => {
  // Both ends are fields now rather than buttons, so the origin's value is
  // read off the input the same way a screen reader would.
  await expect(page.getByLabel("起點")).toHaveValue("我的位置", { timeout: 10_000 });
  await expect(page.getByLabel("目的地")).toBeVisible();
});

test("plans a journey between two stops", async ({ page }) => {
  await expect(page.getByLabel("目的地")).toBeVisible({ timeout: 10_000 });
  await chooseDestination(page, "尖沙咀");

  // Whatever it finds, each journey names its routes and a total time.
  await expect(page.getByText("全程約", { exact: false }).first()).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('a[href^="/route/"]').first()).toBeVisible();
});

test("marks a journey as direct or as one change", async ({ page }) => {
  await expect(page.getByLabel("目的地")).toBeVisible({ timeout: 10_000 });
  await chooseDestination(page, "尖沙咀");

  await expect(page.getByText(/直達|轉乘一次/).first()).toBeVisible({ timeout: 15_000 });
});

test("shows the walk at each end, because that is part of the journey", async ({ page }) => {
  await expect(page.getByLabel("目的地")).toBeVisible({ timeout: 10_000 });
  await chooseDestination(page, "尖沙咀");

  await expect(page.getByText("步行", { exact: false }).first()).toBeVisible({ timeout: 15_000 });
});

test("a leg links through to the route it belongs to", async ({ page }) => {
  await expect(page.getByLabel("目的地")).toBeVisible({ timeout: 10_000 });
  await chooseDestination(page, "尖沙咀");
  await expect(page.locator('a[href^="/route/"]').first()).toBeVisible({ timeout: 15_000 });

  await page.locator('a[href^="/route/"]').first().click();
  await expect(page).toHaveURL(/\/route\//);
});

test("says so plainly when there is no way to get there", async ({ page }) => {
  await expect(page.getByLabel("目的地")).toBeVisible({ timeout: 10_000 });
  // Tai O is on Lantau; the fixture has no service to it from Kowloon.
  await chooseDestination(page, "大澳");

  await expect(page.getByText("找不到合適路線")).toBeVisible({ timeout: 15_000 });
});

test("swapping the ends re-plans in the other direction", async ({ page }) => {
  await expect(page.getByLabel("目的地")).toBeVisible({ timeout: 10_000 });
  await chooseDestination(page, "尖沙咀");
  await expect(page.getByText("全程約", { exact: false }).first()).toBeVisible({ timeout: 15_000 });

  const origin = page.getByLabel("起點");
  const destination = page.getByLabel("目的地");
  await expect(origin).toHaveValue("我的位置");

  await page.getByRole("button", { name: "對調" }).click();

  // The two ends trade places: the chosen stop becomes where you start from,
  // and your own location becomes where you are going.
  await expect(origin).not.toHaveValue("我的位置");
  await expect(destination).toHaveValue("我的位置");
});

test("planning and searching share one tab", async ({ page }) => {
  await page.goto("/search");

  const tabs = page.getByRole("navigation", { name: "導覽" });
  // The planner used to be its own tab, which made a rider choose what kind of
  // question they were asking before they could ask it.
  await expect(tabs.getByRole("link", { name: "規劃" })).toHaveCount(0);

  await page.getByRole("tab", { name: "規劃" }).click();
  await expect(page).toHaveURL(/\/plan/);
  await expect(tabs.getByRole("link", { name: "搜尋" })).toHaveAttribute("aria-current", "page");

  await page.getByRole("tab", { name: "搜尋" }).click();
  await expect(page).toHaveURL(/\/search/);
});
