import { expect, test } from "@playwright/test";
import { mockBasemap, mockRainRadar, mockTransit } from "./support/mock";

const KMB_1 = encodeURIComponent("1+1+CHUK YUEN ESTATE+STAR FERRY");

/** 10:00 Hong Kong time on a March morning, sun well up. */
const DAYTIME = new Date("2026-03-20T02:00:00Z");

function etaIso(minutesFromDaytime: number): string {
  const at = new Date(DAYTIME.getTime() + minutesFromDaytime * 60_000);
  const hk = new Date(at.getTime() + 8 * 60 * 60 * 1000);
  return `${hk.toISOString().slice(0, 19)}+08:00`;
}

const stopRows = (page: import("@playwright/test").Page) =>
  page.getByRole("button", { name: /^\d+\.\s/ });

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(DAYTIME);
  await mockTransit(page, { weatherWet: true });
  await mockRainRadar(page);
  await mockBasemap(page);
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
  await page.addInitScript(() => {
    localStorage.setItem(
      "probus:db:settings",
      JSON.stringify({
        "s:settings": {
          versionKey: "e2e-overlays",
          data: { id: "settings", tripSun: true, walkRain: true },
        },
      }),
    );
  });
});

test("route map draws rain radar and the chosen ride's sun", async ({ page }) => {
  const rainZooms: number[] = [];
  page.on("request", (request) => {
    const match = request.url().match(/\/256\/(\d+)\//);
    if (match && request.url().includes("rainviewer.com")) {
      rainZooms.push(Number(match[1]));
    }
  });

  await page.goto(`/route/${KMB_1}`);
  await expect(stopRows(page).first()).toBeVisible({ timeout: 15_000 });

  const degraded = page.getByText("呢部機顯示唔到地圖");
  await expect
    .poll(
      async () =>
        (await page.locator(".maplibregl-canvas").count()) > 0 || (await degraded.count()) > 0,
      {
        timeout: 25_000,
      },
    )
    .toBe(true);
  expect(await degraded.count(), "the route map has to paint for overlays to show").toBe(0);

  await expect
    .poll(async () => page.locator(".maplibregl-map[data-rain=on]").count(), { timeout: 20_000 })
    .toBeGreaterThan(0);
  await expect(page.locator(".maplibregl-map[data-rain-maxzoom='7']")).toHaveCount(1);

  await stopRows(page).first().click();
  await page.getByRole("button", { name: "喺呢度上車" }).first().click();
  await stopRows(page).nth(8).click();

  await expect(page.getByText(/坐[左右]邊窗|頭頂好曬|兩邊都會曬/)).toBeVisible({
    timeout: 10_000,
  });

  await expect
    .poll(async () => page.locator(".maplibregl-map[data-sun-ride]").count(), { timeout: 15_000 })
    .toBeGreaterThan(0);
  await expect(page.locator(".maplibregl-map[data-sun-ride]")).toHaveAttribute(
    "data-sun-ride",
    /shade|sun|overhead/,
  );

  expect(rainZooms.length, "radar tiles must actually be requested").toBeGreaterThan(0);
  expect(
    rainZooms.every((zoom) => zoom <= 7),
    `RainViewer was asked for zoom ${rainZooms.join(",")}`,
  ).toBe(true);

  const expand = page.getByRole("button", { name: "放大地圖" });
  if (await expand.count()) await expand.click();
  await page.locator(".maplibregl-canvas").first().screenshot({
    path: "/tmp/route-overlays.png",
  });
});
