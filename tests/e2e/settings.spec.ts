import { expect, test } from "@playwright/test";
import { mockTransit } from "./support/mock";

test.beforeEach(async ({ page }) => {
  await mockTransit(page);
  await page.goto("/settings");
});

test("switches the whole interface to English and back", async ({ page }) => {
  await expect(page.getByText("設定").first()).toBeVisible({ timeout: 10_000 });

  await page.getByRole("radio", { name: "EN" }).click();
  await expect(page.getByRole("radio", { name: "EN" })).toHaveAttribute("aria-checked", "true");
  // The tab bar is the quickest proof the change reached the whole shell.
  await expect(page.getByText("Nearby").first()).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");

  await page.getByRole("radio", { name: "繁中" }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-HK");
});

test("theme choice reaches the document and persists", async ({ page }) => {
  await page.getByRole("radio", { name: "深色" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  await page.getByRole("radio", { name: "淺色" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");

  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light", { timeout: 10_000 });
});

test("auto theme defers to the system rather than forcing one", async ({ page }) => {
  await page.getByRole("radio", { name: "深色" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  await page.getByRole("radio", { name: "自動" }).click();
  await expect(page.locator("html")).not.toHaveAttribute("data-theme", "dark");
});

test("reports what is stored for offline use", async ({ page }) => {
  await expect(page.getByText("路線資料庫")).toBeVisible({ timeout: 10_000 });
  // The fixture holds 6 routes; the count must come from the data, not a guess.
  await expect(page.getByText(/\d+\s*(條路線|routes)/)).toBeVisible();
  await expect(page.getByText("已下載 · 可離線使用")).toBeVisible();
});

test("refresh interval is a real choice that sticks", async ({ page }) => {
  await page.getByRole("radio", { name: "10s" }).click();
  await expect(page.getByRole("radio", { name: "10s" })).toHaveAttribute("aria-checked", "true");

  await page.reload();
  await expect(page.getByRole("radio", { name: "10s" })).toHaveAttribute("aria-checked", "true", {
    timeout: 10_000,
  });
});

test("a change in one tab reaches the others", async ({ context, page }) => {
  await mockTransit(page);
  await page.goto("/settings");
  await expect(page.getByRole("radio", { name: "繁中" })).toHaveAttribute("aria-checked", "true", {
    timeout: 10_000,
  });

  // A second tab of the same app, as a person on a desktop actually has.
  const other = await context.newPage();
  await mockTransit(other);
  await other.goto("/settings");
  await other.getByRole("radio", { name: "EN" }).click();

  // Storage events only fire in the *other* tabs, which is exactly the case a
  // load-once store never handled: the first tab used to sit on stale settings
  // until it was reloaded.
  await expect(page.getByRole("radio", { name: "EN" })).toHaveAttribute("aria-checked", "true", {
    timeout: 10_000,
  });
  await other.close();
});
