import { expect, test } from "@playwright/test";
import { mockTransit } from "./support/mock";

test.beforeEach(async ({ page }) => {
  await mockTransit(page);
  await page.goto("/search");
});

test("offers something to browse instead of a blank screen", async ({ page }) => {
  await expect(page.getByText("路線分類", { exact: false }).first()).toBeVisible({
    timeout: 10_000,
  });
  // Categories are the way in when you know the kind of trip, not the number.
  await expect(page.locator('a[href^="/browse/"]').first()).toBeVisible();
});

test("typing on the keypad finds matching routes", async ({ page }) => {
  await page.getByRole("button", { name: "1", exact: true }).click();

  await expect(page.locator('a[href^="/route/"]').first()).toBeVisible({ timeout: 10_000 });
  // KMB leads a shared route number, ahead of the other operators' route 1.
  await expect(page.locator('a[href^="/route/"]').first()).toContainText("竹園邨");
});

test("dims keys that cannot lead to a real route", async ({ page }) => {
  await page.getByRole("button", { name: "5", exact: true }).click();

  // The fixture has 505 but no 51x, so "0" stays live and "1" goes dead.
  await expect(page.getByRole("button", { name: "0", exact: true })).toBeEnabled();
  await expect(page.getByRole("button", { name: "1", exact: true })).toBeDisabled();
});

test("shows the fare and the two-dollar concession together", async ({ page }) => {
  await page.getByRole("button", { name: "1", exact: true }).click();
  await expect(page.locator('a[href^="/route/"]').first()).toBeVisible({ timeout: 10_000 });

  // KMB 1 costs $6.7, which is under the ten-dollar flat-rate threshold.
  await expect(page.getByText("$6.7 · $2.0").first()).toBeVisible();
});

test("finds stops by name, not just routes by number", async ({ page }) => {
  await page.getByLabel(/路線號碼|Route number/).fill("彌敦道");

  // Match the section heading itself, not any control that happens to mention
  // stops - the desktop keypad carries the same words and sits earlier in the
  // DOM even while hidden.
  await expect(page.getByText(/車站\s+Stops/)).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('a[href^="/stop/"]').first()).toBeVisible();
});

test("backspace and clear both undo the query", async ({ page }) => {
  await page.getByRole("button", { name: "5", exact: true }).click();
  await page.getByRole("button", { name: "0", exact: true }).click();
  await expect(page.locator('a[href^="/route/"]').first()).toBeVisible();

  await page.getByRole("button", { name: "backspace" }).click();
  await page.getByRole("button", { name: "clear" }).click();
  await expect(page.getByText("路線分類", { exact: false }).first()).toBeVisible();
});

test("opening a result navigates to that route", async ({ page }) => {
  await page.getByRole("button", { name: "1", exact: true }).click();
  await page.locator('a[href^="/route/"]').first().click();

  await expect(page).toHaveURL(/\/route\//);
  await expect(page.getByText("往 尖沙咀碼頭").first()).toBeVisible({ timeout: 10_000 });
});

test("learns which routes you keep opening", async ({ page }) => {
  // Visit the same route twice; a single visit is not yet a habit.
  for (let i = 0; i < 2; i++) {
    await page.goto("/search");
    await page.getByRole("button", { name: "1", exact: true }).click();
    await page.locator('a[href^="/route/"]').first().click();
    await expect(page.getByText("往 尖沙咀碼頭").first()).toBeVisible({ timeout: 10_000 });
  }

  await page.goto("/search");
  await expect(page.getByText("常用", { exact: false }).first()).toBeVisible({ timeout: 10_000 });
});
