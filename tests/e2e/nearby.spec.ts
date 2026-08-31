import { expect, test } from "@playwright/test";
import { mockTransit } from "./support/mock";

test.beforeEach(async ({ page }) => {
  await mockTransit(page);
});

/** Any stop card on the nearby list. */
const stopLinks = (page: import("@playwright/test").Page) => page.locator('a[href^="/stop/"]');

test("opens on the nearby screen and lists the stops around you", async ({ page }) => {
  await page.goto("/");

  // One language at a time: the screen names itself in the one being read.
  await expect(page.getByText("附近").first()).toBeVisible();
  // Geolocation is pinned to Yau Ma Tei, so several fixture stops are in range.
  await expect(stopLinks(page).first()).toBeVisible({ timeout: 15_000 });
  expect(await stopLinks(page).count()).toBeGreaterThan(1);
});

test("shows how far away each stop is", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText(/^\d+ m$/).first()).toBeVisible({ timeout: 15_000 });
});

test("shows a live countdown rather than a placeholder", async ({ page }) => {
  await page.goto("/");

  const live = page.locator('[data-eta-state="minutes"]').first();
  await expect(live).toBeVisible({ timeout: 15_000 });
  // The stub puts the next arrival 3.5 minutes out, and countdowns round down.
  await expect(live).toHaveAttribute("aria-label", /^3 /);
});

test("never renders a bus that has already gone", async ({ page }) => {
  await page.goto("/");
  await expect(stopLinks(page).first()).toBeVisible({ timeout: 15_000 });

  // A negative countdown would mean a departed bus leaked into the UI.
  await expect(page.getByText(/-\d+/)).toHaveCount(0);
});

test("shows a joint route once, naming both operators", async ({ page }) => {
  await page.goto("/");
  await expect(stopLinks(page).first()).toBeVisible({ timeout: 15_000 });

  // Route 102 is run by KMB and Citybus together - one line to a passenger.
  await expect(page.getByText("聯營 KMB · CTB", { exact: false }).first()).toBeVisible();

  // No stop card may list the same route twice, which is what happens if a
  // joint route is indexed once per operator.
  const cards = await page.locator("section a[href^='/stop/']").evaluateAll((anchors) =>
    anchors.map((anchor) => {
      const card = anchor.parentElement;
      const routes = card ? [...card.querySelectorAll("a[href^='/route/']")] : [];
      return routes.map((r) => r.getAttribute("href"));
    }),
  );
  for (const routeHrefs of cards) {
    expect(new Set(routeHrefs).size).toBe(routeHrefs.length);
  }
});

test("changing the search radius takes effect and survives a reload", async ({ page }) => {
  await page.goto("/");
  await expect(stopLinks(page).first()).toBeVisible({ timeout: 15_000 });

  // The header wears the current range; tapping it opens the range sheet.
  await page.getByRole("button", { name: /400 m/ }).click();
  await expect(page.getByText("自訂搜尋範圍")).toBeVisible();

  // Every notch of the slider is also a button.
  await page.getByRole("button", { name: "200 m", exact: true }).click();
  await expect(page.getByRole("slider")).toHaveAttribute("aria-valuetext", "200 m");

  await page.keyboard.press("Escape");
  await page.reload();
  await expect(page.getByRole("button", { name: /200 m/ })).toBeVisible({ timeout: 15_000 });
});

test("falls back to the timetable when every arrival feed is down", async ({ page }) => {
  await mockTransit(page, { etaFails: true });
  await page.goto("/");

  await expect(stopLinks(page).first()).toBeVisible({ timeout: 15_000 });
  // The screen must stay useful: a timetable estimate or an honest "no service",
  // never a blank row or a spinner that never resolves.
  await expect(
    page.locator('[data-eta-state="scheduled"], [data-eta-state="none"]').first(),
  ).toBeVisible({
    timeout: 15_000,
  });
});

test("offers a retry when the route database cannot be fetched", async ({ page }) => {
  await mockTransit(page, { databaseFails: true });
  await page.goto("/");

  await expect(page.getByText("載唔到路線資料")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("button", { name: "重試" })).toBeVisible();
});

/*
 * A rider who has hit the error screen is standing somewhere with a phone that
 * is not working. Asking them to keep pressing a button is the one thing the
 * screen must not do, so it counts down and goes again by itself.
 */
test("tries again on its own without being pressed", async ({ page }) => {
  let attempts = 0;
  await mockTransit(page, { databaseFails: true });
  // Registered after the stub, so it wins - and counts.
  await page.route("**/routeFareList.min.json", (route) => {
    attempts += 1;
    return route.fulfill({ status: 500, body: "nope" });
  });

  await page.goto("/");
  await expect(page.getByText("載唔到路線資料")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("會自動再試")).toBeVisible();

  const first = attempts;
  // The first wait is five seconds; give the retry room to land after it.
  await expect.poll(() => attempts, { timeout: 15_000 }).toBeGreaterThan(first);
});

/*
 * Coming up out of a tunnel should be enough. Being offline is a different
 * problem from being told no by a working connection, and it gets its own
 * sentence - then answers itself the moment the connection is back.
 */
test("names being offline, and loads itself when the connection returns", async ({
  page,
  context,
}) => {
  await mockTransit(page, { databaseFails: true });
  await page.goto("/");
  await expect(page.getByText("載唔到路線資料")).toBeVisible({ timeout: 20_000 });

  await context.setOffline(true);
  await expect(page.getByText("而家冇網絡")).toBeVisible();
  await expect(page.getByText("等緊網絡")).toBeVisible();
  // Nothing to retry against a dead network, so nothing counts down at it.
  await expect(page.getByText("會自動再試")).toBeHidden();

  // The database is reachable again by the time the connection is.
  await mockTransit(page);
  await context.setOffline(false);

  // No tap: the screen takes itself from here.
  await expect(page.locator('a[href^="/stop/"]').first()).toBeVisible({ timeout: 20_000 });
});

/**
 * Grouping by stop answers "what is at this kerb". A rider who does not mind
 * which kerb they walk to is asking "what leaves first", and a list of cards
 * cannot be read that way.
 */
test("nearby can be read as one queue of departures instead of a list of stops", async ({
  page,
}) => {
  await page.goto("/");
  await expect(stopLinks(page).first()).toBeVisible({ timeout: 15_000 });

  await page.getByRole("radio", { name: "全部路線" }).click();
  await expect(page.locator('a[href^="/route/"]').first()).toBeVisible({ timeout: 15_000 });
  // The per-kerb headings are what the merged list replaces.
  await expect(stopLinks(page)).toHaveCount(0);

  await page.reload();
  await expect(page.getByRole("radio", { name: "全部路線" })).toHaveAttribute(
    "aria-checked",
    "true",
    { timeout: 15_000 },
  );
});

/*
 * A home screen that is blank until the location prompt is answered is not a
 * home screen. With no position - refused, or not yet given - the routes the
 * city knows by number are there to open.
 */
test("offers popular routes when there is no location", async ({ page, context }) => {
  await context.clearPermissions();
  await page.goto("/");

  await expect(page.getByText("熱門路線")).toBeVisible({ timeout: 15_000 });
  const first = page.locator('a[href^="/route/"]').first();
  await expect(first).toBeVisible();
  await first.click();
  await expect(page).toHaveURL(/\/route\//);
});
