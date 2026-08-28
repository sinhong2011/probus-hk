import { expect, test } from "@playwright/test";
import { mockTransit } from "./support/mock";

const KMB_1 = encodeURIComponent("1+1+CHUK YUEN ESTATE+STAR FERRY");

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
  const locate = page.getByRole("button", { name: "我的位置" });
  const degraded = page.getByText("此裝置無法顯示地圖");

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
