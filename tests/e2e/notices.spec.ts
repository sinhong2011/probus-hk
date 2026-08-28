import { expect, test } from "@playwright/test";
import { mockTransit } from "./support/mock";

test("lists the department's service notices", async ({ page }) => {
  await mockTransit(page);
  await page.goto("/notices");

  await expect(page.getByText("通告").first()).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText("珀麗灣客運有限公司")).toBeVisible();
  await expect(page.getByText("龍翔道", { exact: false })).toBeVisible();
});

test("repairs the feed's Kangxi characters", async ({ page }) => {
  await mockTransit(page);
  await page.goto("/notices");

  // The feed sends 8⽉ (U+2F49) and ⾺灣; both must read normally on screen.
  await expect(page.getByText("2026年8月28日", { exact: false })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText("⽉", { exact: false })).toHaveCount(0);
});

test("names the routes a notice affects", async ({ page }) => {
  await mockTransit(page);
  await page.goto("/notices");

  await expect(page.getByText("涉及路線")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText("NR338S", { exact: true })).toBeVisible();
});

test("does not print a one-line notice twice", async ({ page }) => {
  await mockTransit(page);
  await page.goto("/notices");
  await expect(page.getByText("龍翔道", { exact: false })).toBeVisible({ timeout: 10_000 });

  // The reopening notice is a single line, so it is its own heading and
  // nothing more.
  expect(await page.getByText("龍翔道近廣播道的行車線現已解封。", { exact: false }).count()).toBe(1);
});

test("credits the source rather than passing it off as its own", async ({ page }) => {
  await mockTransit(page);
  await page.goto("/notices");
  await expect(page.getByText("運輸署", { exact: false }).first()).toBeVisible({ timeout: 10_000 });
});

test("offers a retry when the feed is down", async ({ page }) => {
  await mockTransit(page, { noticesFail: true });
  await page.goto("/notices");

  await expect(page.getByText("未能載入通告")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("button", { name: "重試" })).toBeVisible();
});
