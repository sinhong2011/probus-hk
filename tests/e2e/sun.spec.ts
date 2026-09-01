import { expect, test } from "@playwright/test";
import { mockTransit } from "./support/mock";

const KMB_1 = encodeURIComponent("1+1+CHUK YUEN ESTATE+STAR FERRY");

/** 10:00 Hong Kong time on a March morning, sun well up. */
const DAYTIME = new Date("2026-03-20T02:00:00Z");

function etaIso(minutesFromDaytime: number): string {
  const at = new Date(DAYTIME.getTime() + minutesFromDaytime * 60_000);
  const hk = new Date(at.getTime() + 8 * 60 * 60 * 1000);
  return `${hk.toISOString().slice(0, 19)}+08:00`;
}

/** Stop rows only — the tab bar's 更多 is also `aria-expanded`. */
const stopRows = (page: import("@playwright/test").Page) =>
  page.getByRole("button", { name: /^\d+\.\s/ });

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(DAYTIME);
  await mockTransit(page);
  // Arrivals must land on the frozen March morning, or the sun is scored at
  // tonight's real ETA and the chips stay dark.
  await page.route("**/data.etabus.gov.hk/**", (route) => {
    const data = [];
    for (let seq = 1; seq <= 40; seq++) {
      for (const dir of ["O", "I"]) {
        for (const [index, offset] of [3.5, 11.5, 24.5].entries()) {
          data.push({
            co: "KMB",
            route: "1",
            dir,
            service_type: 1,
            seq,
            eta_seq: index + 1,
            eta: etaIso(offset),
            rmk_tc: "",
            rmk_en: "",
            dest_tc: "尖沙咀碼頭",
            dest_en: "STAR FERRY",
          });
        }
      }
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "access-control-allow-origin": "*" },
      body: JSON.stringify({ type: "StopETA", version: "1.0", data }),
    });
  });
  await page.route("**/hkbus.github.io/route-waypoints/**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "access-control-allow-origin": "*" },
      body: JSON.stringify({
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            geometry: {
              type: "LineString",
              coordinates: [
                [114.19264, 22.34541],
                [114.16911, 22.2943],
              ],
            },
            properties: {},
          },
        ],
      }),
    }),
  );
});

async function pickARide(page: import("@playwright/test").Page) {
  await page.goto(`/route/${KMB_1}`);
  await expect(stopRows(page).first()).toBeVisible({ timeout: 15_000 });
  await stopRows(page).first().click();
  await page.getByRole("button", { name: "喺呢度上車" }).first().click();
  await stopRows(page).nth(8).click();
}

test("the ride-sun switch is off until asked for", async ({ page }) => {
  await page.goto("/settings");
  const toggle = page.getByRole("switch", { name: "行程日照" });
  await expect(toggle).toBeVisible({ timeout: 10_000 });
  await expect(toggle).toHaveAttribute("aria-checked", "false");
});

test("offers the feature on a daytime ride, once, and turning it on prints a window", async ({
  page,
}) => {
  await pickARide(page);

  const offer = page.getByText("可以睇吓呢程坐邊邊窗少曬");
  await expect(offer).toBeVisible({ timeout: 10_000 });

  await page
    .locator("[role=status]", { hasText: "可以睇吓呢程坐邊邊窗少曬" })
    .getByRole("button", { name: "試吓" })
    .click();
  await expect(offer).toHaveCount(0);
  await expect(page.getByText(/坐[左右]邊窗|頭頂好曬|兩邊都會曬/)).toBeVisible({
    timeout: 10_000,
  });
});

test("closing the offer never brings it back", async ({ page }) => {
  await pickARide(page);
  const offer = page.getByText("可以睇吓呢程坐邊邊窗少曬");
  await expect(offer).toBeVisible({ timeout: 10_000 });
  await page
    .locator("[role=status]", { hasText: "可以睇吓呢程坐邊邊窗少曬" })
    .getByRole("button", { name: "關閉" })
    .click();
  await expect(offer).toHaveCount(0);

  await page.reload();
  await pickARide(page);
  await expect(page.getByText("可以睇吓呢程坐邊邊窗少曬")).toHaveCount(0);
});

test("a sheet follows the banner on a daytime ride", async ({ page }) => {
  await pickARide(page);
  await expect(page.getByText("可以睇吓呢程坐邊邊窗少曬")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole("dialog", { name: "呢程坐邊邊窗" })).toBeVisible({
    timeout: 5_000,
  });
});

test("plan scores a picked morning clock, not only the next bus", async ({ page }) => {
  await page.goto("/settings");
  const toggle = page.getByRole("switch", { name: "行程日照" });
  await expect(toggle).toBeVisible({ timeout: 10_000 });
  await toggle.click();

  await page.goto("/plan");
  const destination = page.getByLabel("目的地");
  await expect(destination).toBeVisible({ timeout: 10_000 });
  await destination.click();
  await destination.fill("尖沙咀");
  await page.locator('button:has-text("尖沙咀")').first().click();

  await expect(page.getByText("全程大約", { exact: false }).first()).toBeVisible({
    timeout: 15_000,
  });

  const clock = page.getByRole("button", { name: "日照 · 下一班" });
  await expect(clock).toBeVisible();
  await clock.click();

  const clockSheet = page.getByRole("dialog", { name: "按邊個鐘計日照" });
  await expect(clockSheet).toBeVisible();
  await clockSheet.getByRole("tab", { name: "聽朝" }).click();
  await clockSheet.getByRole("button", { name: "關閉" }).click();

  await expect(page.getByRole("button", { name: /聽日 08:00/ })).toBeVisible();
});
