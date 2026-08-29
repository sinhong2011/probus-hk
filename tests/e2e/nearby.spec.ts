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

  await page.getByRole("button", { name: "200 m" }).click();
  await expect(page.getByRole("button", { name: "200 m" })).toHaveAttribute("aria-pressed", "true");

  await page.reload();
  await expect(page.getByRole("button", { name: "200 m" })).toHaveAttribute(
    "aria-pressed",
    "true",
    {
      timeout: 15_000,
    },
  );
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
