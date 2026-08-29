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
  expect(await page.getByText("龍翔道近廣播道的行車線現已解封。", { exact: false }).count()).toBe(
    1,
  );
});

test("says when each notice was published", async ({ page }) => {
  await mockTransit(page);
  await page.goto("/notices");

  // 下午 07:48 Hong Kong time, and the page runs in Asia/Hong_Kong. The time
  // sits in the feed's own margin, the date under it, so both are checked
  // inside the notice rather than against the screen's "updated at" line.
  const ferry = page.locator("article", { hasText: "珀麗灣客運有限公司" });
  await expect(ferry.getByText("19:48")).toBeVisible({ timeout: 10_000 });
  await expect(ferry.getByText("08-28")).toBeVisible();
});

test("names the screen once", async ({ page }) => {
  await mockTransit(page);
  await page.goto("/notices");
  await expect(page.getByText("珀麗灣客運有限公司")).toBeVisible({ timeout: 10_000 });

  // The heading and a section label directly under it both said 通告, which is
  // a row of screen height spent repeating the title. The tab bar says it too,
  // and legitimately, so only the page's own copies are counted.
  const inPage = await page.evaluate(() => {
    // Two of them: the phone's bottom bar and the desktop sidebar, only one of
    // which is ever on screen.
    const navs = [...document.querySelectorAll("nav")];
    return [...document.querySelectorAll("span, h1, p")].filter(
      (el) => el.textContent?.trim() === "通告" && !navs.some((nav) => nav.contains(el)),
    ).length;
  });
  expect(inPage).toBe(1);
});

test("credits the source rather than passing it off as its own", async ({ page }) => {
  await mockTransit(page);
  await page.goto("/notices");
  await expect(page.getByText("運輸署", { exact: false }).first()).toBeVisible({ timeout: 10_000 });
});

test("offers a retry when the feed is down", async ({ page }) => {
  await mockTransit(page, { noticesFail: true });
  await page.goto("/notices");

  await expect(page.getByText("載唔到通告")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("button", { name: "重試" })).toBeVisible();
});

/**
 * The department publishes twice, and the two feeds do not carry the same
 * things. The register is the structured one: it names the incident's category
 * and where it happened rather than leaving both inside the prose.
 */
test("carries the incident register as well as the announcements", async ({ page }) => {
  await mockTransit(page);
  await page.goto("/notices");

  // From the announcements feed.
  await expect(page.getByText("龍翔道近廣播道", { exact: false })).toBeVisible({
    timeout: 10_000,
  });

  // And from the register, with the heading and location it publishes itself
  // rather than a first line pulled out of the body.
  const incident = page.locator("article", { hasText: "西貢萬宜路交通預計比較繁忙" });
  await expect(incident.getByText("道路事故")).toBeVisible();
  await expect(incident.getByText("西貢萬宜路", { exact: true })).toBeVisible();
});
