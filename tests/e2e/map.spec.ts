import { expect, test } from "@playwright/test";
import { mockBasemap, mockRunningBuses, mockTransit } from "./support/mock";

const KMB_1 = encodeURIComponent("1+1+CHUK YUEN ESTATE+STAR FERRY");

/** Drawn buses are off until asked for - see `settings.vehiclesOnMap`. */
async function askForMapBuses(page: import("@playwright/test").Page) {
  await page.addInitScript(() => {
    localStorage.setItem(
      "probus:db:settings",
      JSON.stringify({
        "s:settings": {
          versionKey: "e2e-vehicles-map",
          data: { id: "settings", vehiclesOnMap: true },
        },
      }),
    );
  });
}

/**
 * MapLibre loads its tile-parsing worker as a separate file resolved from
 * `import.meta.url`, which does not survive bundling. When it 404s the map
 * stays blank and reports no error at all - so this guards the build output
 * rather than any behaviour in the app.
 */
test("ships the MapLibre worker the bundle cannot resolve on its own", async ({ request }) => {
  const worker = await request.get("/maplibre/maplibre-gl-worker.mjs");
  expect(worker.status()).toBe(200);
  expect(await worker.text()).toContain("maplibre-gl-shared.mjs");

  // The worker imports it as a sibling, so it has to be there too.
  const shared = await request.get("/maplibre/maplibre-gl-shared.mjs");
  expect(shared.status()).toBe(200);
});

test("starts the MapLibre worker from the URL the build emits", async ({ page }) => {
  await mockTransit(page);

  const asked: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("maplibre-gl-worker")) asked.push(r.url());
  });

  await page.goto(`/route/${KMB_1}`);
  await expect(page.getByText("往 尖沙咀碼頭").first()).toBeVisible({ timeout: 10_000 });

  /*
   * Asserting on the worker request rather than on tile traffic: it is the
   * thing that actually regressed, and it does not depend on WebGL finishing
   * its first frame, which is slow and flaky when the whole suite runs at once.
   */
  await expect.poll(() => asked.length, { timeout: 30_000 }).toBeGreaterThan(0);
  expect(asked[0]).toContain("/maplibre/maplibre-gl-worker.mjs");
});

/**
 * The map is only worth its space if it is an index into the list rather than
 * a picture of one. These cover the two directions of that link.
 */
test("offers a way back to your position and to the whole route", async ({ page, context }) => {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: 22.3396, longitude: 114.1949 });
  await mockTransit(page);

  await page.goto(`/route/${KMB_1}`);
  await expect(page.getByText("往 尖沙咀碼頭").first()).toBeVisible({ timeout: 15_000 });

  const fit = page.getByRole("button", { name: "全程" });
  const locate = page.getByRole("button", { name: "我嘅位置" });
  const degraded = page.getByText("呢部機顯示唔到地圖");

  /*
   * WebGL is not guaranteed - a blocklisted GPU, or simply a machine running
   * the whole suite at once and missing the map's few-second budget - so the
   * contract is the pair, not the map: either it painted and both ways back
   * are there, or it collapsed and said so. What must never happen is a map
   * you can pan with no way to return.
   */
  await expect
    .poll(async () => (await fit.count()) > 0 || (await degraded.count()) > 0, {
      timeout: 20_000,
    })
    .toBe(true);

  if (await fit.count()) {
    await expect(locate).toBeVisible();
    await fit.click();
    await locate.click();
    // Nothing should have navigated or crashed; the route page is still here.
    await expect(page.getByText("往 尖沙咀碼頭").first()).toBeVisible();
  }
});

test("keeps the map and the stop list pointing at the same stop", async ({ page }) => {
  await mockTransit(page);
  await page.goto(`/route/${KMB_1}`);

  const row = page.locator("[data-stop-seq]").nth(3);
  await expect(row).toBeVisible({ timeout: 15_000 });

  await row.getByRole("button").first().click();
  await expect(row.locator('[aria-expanded="true"]')).toHaveCount(1);

  // Exactly one stop is ever the selected one, which is what the map draws.
  await expect(page.locator('[aria-expanded="true"]')).toHaveCount(1);
});

/**
 * The buses on the map are not position reports - nobody publishes those here -
 * so the contract is that they appear at all, and that they never appear
 * without the line saying what they are.
 */
test("puts the buses on the map, and says they are estimates", async ({ page }) => {
  await mockTransit(page);

  // Two buses already on the road, so there is something to place.
  await mockRunningBuses(page);

  await mockBasemap(page);
  await askForMapBuses(page);

  await page.goto(`/route/${KMB_1}`);

  const legend = page.getByText("巴士位置係估計");
  const find = page.getByRole("button", { name: "架車喺邊" });
  const degraded = page.getByText("呢部機顯示唔到地圖");

  /*
   * Same pairing as the controls above: either the map painted and the buses
   * are on it, or there is no map to put them on. The control is what is
   * waited for rather than the note, because a badge somewhere on a forty-stop
   * line is not findable on a phone by panning - buses a rider cannot get to
   * are only half drawn.
   */
  await expect
    .poll(async () => (await find.count()) > 0 || (await degraded.count()) > 0, {
      timeout: 25_000,
    })
    .toBe(true);

  if (await find.count()) {
    // The note and the control are driven by the same count, so neither ever
    // turns up alone: no unexplained badges, and no button to nowhere.
    await expect(legend).toBeVisible();
    await find.click();
    await expect(page.getByText("往 尖沙咀碼頭").first()).toBeVisible();
  }
});

/**
 * The other half of the same contract, and the harder half.
 *
 * An empty map is the same picture whether the answer is still coming, nothing
 * is running, or the feed is down - and a rider cannot tell those apart by
 * looking. Silence reads as broken, so the corner of the map says which it is
 * even when there is nothing to draw.
 */
test("says why there are no buses, instead of saying nothing", async ({ page }) => {
  await mockTransit(page, { etaFails: true });
  await mockBasemap(page);
  await askForMapBuses(page);
  await page.goto(`/route/${KMB_1}`);

  const note = page.getByText("攞唔到實時位置");
  const degraded = page.getByText("呢部機顯示唔到地圖");

  // Paired with the degraded case like every other map test here: a machine
  // running the whole suite at once can miss the map's few-second budget.
  await expect
    .poll(async () => (await note.count()) > 0 || (await degraded.count()) > 0, {
      timeout: 25_000,
    })
    .toBe(true);

  if (await note.count()) {
    // And no control offering to take the rider to buses that are not there.
    await expect(page.getByRole("button", { name: "架車喺邊" })).toHaveCount(0);
  }
});

test("tells a timetable from a tracked bus", async ({ page }) => {
  await mockTransit(page);
  await mockBasemap(page);
  await askForMapBuses(page);
  await page.route("**/data.etabus.gov.hk/v1/transport/kmb/route-eta/**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "access-control-allow-origin": "*" },
      body: JSON.stringify({
        type: "RouteETA",
        version: "1.0",
        data: [
          {
            co: "KMB",
            route: "1",
            dir: "O",
            service_type: 1,
            seq: 5,
            eta_seq: 1,
            // KMB marks timetable-derived departures; they are not tracked, so
            // there is no vehicle to draw and the map has to say so.
            eta: `${new Date(Date.now() + 8 * 60_000 + 8 * 3_600_000).toISOString().slice(0, 19)}+08:00`,
            rmk_tc: "原定班次",
            rmk_en: "Scheduled Bus",
            dest_tc: "尖沙咀碼頭",
            dest_en: "STAR FERRY",
          },
        ],
      }),
    }),
  );

  await page.goto(`/route/${KMB_1}`);

  const note = page.getByText("時間表班次,冇實時位置");
  const degraded = page.getByText("呢部機顯示唔到地圖");
  await expect
    .poll(async () => (await note.count()) > 0 || (await degraded.count()) > 0, {
      timeout: 25_000,
    })
    .toBe(true);
});

/**
 * Opening the map out used to take the arrivals off screen with it, which are
 * the reason the rider is on the page at all - so a full-window map answered
 * "where" by refusing to answer "when".
 */
test("an opened-out map keeps the arrivals in reach", async ({ page }) => {
  await mockTransit(page);
  await mockBasemap(page);
  await page.goto(`/route/${KMB_1}`);

  const expand = page.getByRole("button", { name: "放大地圖" });
  const degraded = page.getByText("呢部機顯示唔到地圖");
  await expect
    .poll(async () => (await expand.count()) > 0 || (await degraded.count()) > 0, {
      timeout: 25_000,
    })
    .toBe(true);

  if (await expand.count()) {
    await expand.click();

    // Everything below is inside the full-window map, not the page behind it.
    const overlay = page.locator("div.z-50.bg-map");
    await expect(overlay.getByRole("button", { name: "關閉地圖" })).toBeVisible();
    // The stop the page is about, and the wait at it, without closing the map.
    // `.first()`: the sheet names it at the top and again in the stop list
    // under it, which the sheet pulls up into.
    await expect(overlay.getByText("油麻地永星里").first()).toBeVisible({ timeout: 15_000 });
    await expect(overlay.getByText("分鐘").first()).toBeVisible();
  }
});
