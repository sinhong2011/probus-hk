import { expect, test } from "@playwright/test";
import { mockTransit } from "./support/mock";

const KMB_1 = encodeURIComponent("1+1+CHUK YUEN ESTATE+STAR FERRY");

/** 10:00 Hong Kong time on a March morning, sun well up. */
const DAYTIME = new Date("2026-03-20T02:00:00Z");

const stopRows = (page: import("@playwright/test").Page) => page.locator("button[aria-expanded]");

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(DAYTIME);
  await mockTransit(page);
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
  await page.getByRole("button", { name: "喺呢度上車" }).click();
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

  await page.getByRole("button", { name: "試吓" }).first().click();
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
