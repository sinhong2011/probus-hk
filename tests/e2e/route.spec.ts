import { expect, test } from "@playwright/test";
import { mockTransit } from "./support/mock";

const KMB_1 = encodeURIComponent("1+1+CHUK YUEN ESTATE+STAR FERRY");

/** Every stop on the route is a row you can open. */
const stopRows = (page: import("@playwright/test").Page) =>
  page.locator("button[aria-expanded]");

test.beforeEach(async ({ page }) => {
  await mockTransit(page);
});

test("shows the route, its operator and its whole stop list", async ({ page }) => {
  await page.goto(`/route/${KMB_1}`);

  await expect(page.getByText("往 尖沙咀碼頭").first()).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText("九巴", { exact: false }).first()).toBeVisible();

  // Every stop, with nothing folded away: the ones behind you are still part of
  // the route, and hiding them put half the answer behind a control.
  expect(await stopRows(page).count()).toBeGreaterThan(20);
  await expect(page.getByRole("button", { name: /較早車站/ })).toHaveCount(0);
});

test("numbers the stops so a position on the route is legible", async ({ page }) => {
  await page.goto(`/route/${KMB_1}`);
  await expect(stopRows(page).first()).toBeVisible({ timeout: 10_000 });

  // The first row carries its sequence number.
  await expect(stopRows(page).first()).toContainText("1");
});

test("shows the full fare and the concession on every stop", async ({ page }) => {
  await page.goto(`/route/${KMB_1}`);
  await expect(stopRows(page).first()).toBeVisible({ timeout: 10_000 });

  await expect(page.getByText(/車費 \$\d/).first()).toBeVisible();
  await expect(page.getByText("樂悠車費 $2.0", { exact: false }).first()).toBeVisible();
});

test("shows the next arrival on every stop without tapping", async ({ page }) => {
  await page.goto(`/route/${KMB_1}`);
  await expect(stopRows(page).first()).toBeVisible({ timeout: 10_000 });

  // The list is the answer, not a menu of questions: a rider should be able to
  // read the whole route without opening anything.
  await expect
    .poll(async () => page.locator("[data-eta-state]").count(), { timeout: 10_000 })
    .toBeGreaterThan(3);
});

test("opening a stop reveals the departures after the next one", async ({ page }) => {
  await page.goto(`/route/${KMB_1}`);
  await expect(stopRows(page).first()).toBeVisible({ timeout: 10_000 });

  const row = stopRows(page).nth(3);
  await expect(row).toHaveAttribute("aria-expanded", "false");
  await row.click();

  await expect(row).toHaveAttribute("aria-expanded", "true");
  // The row keeps the next bus; the ones after it live in the panel it opens,
  // as bare times - two more times under a time need no label.
  const later = page.locator('[data-open="true"]').getByLabel(/分鐘$/);
  await expect(later.first()).toBeVisible({ timeout: 10_000 });
});

test("closing a stop puts its later departures away again", async ({ page }) => {
  await page.goto(`/route/${KMB_1}`);
  const row = stopRows(page).nth(3);
  await expect(row).toBeVisible({ timeout: 10_000 });

  await row.click();
  await expect(row).toHaveAttribute("aria-expanded", "true");
  await row.click();
  await expect(row).toHaveAttribute("aria-expanded", "false");
  // The panel stays mounted so the collapse can animate, so "away" has to mean
  // out of reach, not merely out of the layout.
  await expect(page.locator('[data-open="true"]')).toHaveCount(0);
});

test("survives a basemap that will not load", async ({ page }) => {
  // Tiles are blocked by the mock; the page must still be fully usable and
  // must not leave a blank rectangle where the map would be.
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));

  await page.goto(`/route/${KMB_1}`);
  await expect(page.getByText("往 尖沙咀碼頭").first()).toBeVisible({ timeout: 10_000 });
  // The stop list is what matters, and it must be there without a map.
  expect(await stopRows(page).count()).toBeGreaterThan(0);

  expect(errors).toEqual([]);
});

test("pinning a stop puts it on the saved screen", async ({ page }) => {
  await page.goto(`/route/${KMB_1}`);
  await expect(stopRows(page).first()).toBeVisible({ timeout: 10_000 });

  await stopRows(page).nth(2).click();
  const pin = page.locator('[data-open="true"]').getByRole("button", { name: "pin" });
  await expect(pin).toHaveAttribute("aria-pressed", "false");
  await pin.click();
  await expect(pin).toHaveAttribute("aria-pressed", "true");

  await page.goto("/saved");
  await expect(page.getByText("往 尖沙咀碼頭").first()).toBeVisible({ timeout: 10_000 });
});

test("an open stop links through to its own page", async ({ page }) => {
  await page.goto(`/route/${KMB_1}`);
  await expect(stopRows(page).first()).toBeVisible({ timeout: 10_000 });

  await stopRows(page).nth(2).click();
  // Every row carries its own panel so the collapse can animate both ways, so
  // the link has to be taken from the row that is actually open.
  await page.locator('[data-open="true"] a[href^="/stop/"]').first().click();

  await expect(page).toHaveURL(/\/stop\//);
  await expect(page.getByText("途經路線", { exact: false })).toBeVisible({ timeout: 10_000 });
});

test("the trail names the tab you came from, and that tab stays lit", async ({ page }) => {
  await page.goto("/search");
  await page.getByRole("button", { name: "1", exact: true }).click();
  await page.locator('a[href^="/route/"]').first().click();
  await expect(page).toHaveURL(/\/route\//);
  // Wait for the page to actually be there, as a person would: the router
  // re-asserts the URL when a pending lazy navigation settles.
  await expect(page.getByText("往 尖沙咀碼頭").first()).toBeVisible({ timeout: 10_000 });

  // A route is not a tab, so nothing in the bar would light up on its own; it
  // belongs to whichever tab you reached it from.
  const tabs = page.getByRole("navigation", { name: "導覽" });
  await expect(tabs.getByRole("link", { name: "搜尋" })).toHaveAttribute("aria-current", "page");

  await page.getByRole("navigation", { name: "breadcrumb" }).getByText("搜尋").click();
  await expect(page).toHaveURL(/\/search/);
});

test("the tab bar stays reachable from a route page", async ({ page }) => {
  await page.goto(`/route/${KMB_1}`);
  await expect(page.getByText("往 尖沙咀碼頭").first()).toBeVisible({ timeout: 10_000 });

  await page.getByRole("link", { name: "搜尋" }).click();
  await expect(page).toHaveURL(/\/search/);
});

test("a stop opened from a route says which route it came through", async ({ page }) => {
  await page.goto("/search");
  await page.getByRole("button", { name: "1", exact: true }).click();
  await page.locator('a[href^="/route/"]').first().click();
  await expect(page.getByText("往 尖沙咀碼頭").first()).toBeVisible({ timeout: 10_000 });

  await stopRows(page).nth(2).click();
  await page.locator('[data-open="true"] a[href^="/stop/"]').first().click();
  await expect(page).toHaveURL(/\/stop\//);

  // The whole way back, not just the tab: a stop reached through a route is a
  // different place from one opened straight off the nearby list.
  const crumbs = page.getByRole("navigation", { name: "breadcrumb" });
  await expect(crumbs.getByText("搜尋")).toBeVisible({ timeout: 10_000 });
  await expect(crumbs.getByText("路線 1")).toBeVisible();

  await crumbs.getByText("路線 1").click();
  await expect(page).toHaveURL(/\/route\//);
});

test("the timetable opens as a dialog and closes with Escape", async ({ page }) => {
  await page.goto(`/route/${KMB_1}`);
  await expect(page.getByText("往 尖沙咀碼頭").first()).toBeVisible({ timeout: 10_000 });

  const timetable = page.getByRole("dialog");
  // Mounted the whole time so the close can animate, so "shut" has to mean out
  // of reach rather than merely invisible.
  await expect(timetable).toBeHidden();

  await page.getByRole("button", { name: "路線資料" }).click();
  await expect(timetable).toBeVisible();
  await expect(timetable.getByText("星期一至五")).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(timetable).toBeHidden();
});

test("the nearest stop is named, and jumps to itself", async ({ page, context }) => {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: 22.3396, longitude: 114.1949 });
  await page.goto(`/route/${KMB_1}`);

  // "You are here" answered nothing on a page that is a whole route; the chip
  // has to say which stop it means.
  const nearest = page.getByRole("button", { name: /最近車站/ });
  await expect(nearest).toBeVisible({ timeout: 15_000 });
  await expect(nearest).toContainText("步行");

  await nearest.click();
  await expect(page.locator('[data-open="true"]')).toHaveCount(1);
});
