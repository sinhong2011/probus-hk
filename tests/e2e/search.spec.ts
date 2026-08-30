import { expect, test } from "@playwright/test";
import { mockTransit } from "./support/mock";

test.beforeEach(async ({ page }) => {
  await mockTransit(page);
  await page.goto("/search");
});

test("offers something to browse instead of a blank screen", async ({ page }) => {
  await expect(page.getByText("路線分類", { exact: false }).first()).toBeVisible({
    timeout: 10_000,
  });
  // Categories are the way in when you know the kind of trip, not the number.
  await expect(page.locator('a[href^="/browse/"]').first()).toBeVisible();
});

test("typing on the keypad finds matching routes", async ({ page }) => {
  await page.getByRole("button", { name: "1", exact: true }).click();

  await expect(page.locator('a[href^="/route/"]').first()).toBeVisible({ timeout: 10_000 });
  // KMB leads a shared route number, ahead of the other operators' route 1.
  await expect(page.locator('a[href^="/route/"]').first()).toContainText("竹園邨");
});

test("dims keys that cannot lead to a real route", async ({ page }) => {
  await page.getByRole("button", { name: "5", exact: true }).click();

  // The fixture has 505 but no 51x, so "0" stays live and "1" goes dead.
  await expect(page.getByRole("button", { name: "0", exact: true })).toBeEnabled();
  await expect(page.getByRole("button", { name: "1", exact: true })).toBeDisabled();
});

test("shows the fare and the two-dollar concession together", async ({ page }) => {
  await page.getByRole("button", { name: "1", exact: true }).click();
  await expect(page.locator('a[href^="/route/"]').first()).toBeVisible({ timeout: 10_000 });

  // KMB 1 costs $6.7, which is under the ten-dollar flat-rate threshold.
  // Each amount is its own tag on the row.
  const first = page.locator('a[href^="/route/"]').first();
  await expect(first.getByText("$6.7", { exact: true })).toBeVisible();
  await expect(first.getByText("$2.0", { exact: true })).toBeVisible();
});

test("finds stops by name, not just routes by number", async ({ page }) => {
  await page.getByLabel(/路線、車站|Route, stop/).fill("彌敦道");

  // The stop results, reached through their own link rather than through a
  // heading: the keypad's hint carries the same words and sits earlier in the
  // DOM even while hidden.
  await expect(
    page
      .getByRole("heading", { name: "車站" })
      .or(page.getByText("車站", { exact: true }))
      .first(),
  ).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.locator('a[href^="/stop/"]').first()).toBeVisible();
});

test("finds the one stop whose pole carries the code you typed", async ({ page }) => {
  // The code on the flag - "WT916" - is the only thing at a stop that names
  // that pole and no other, so typing it should land on exactly one stop.
  await page.getByLabel(/路線、車站|Route, stop/).fill("WT916");

  const results = page.locator('a[href^="/stop/"]');
  await expect(results).toHaveCount(1, { timeout: 10_000 });
  await expect(results.first()).toContainText("竹園邨總站");
  await expect(results.first()).toContainText("WT916");
});

test("backspace and clear both undo the query", async ({ page }) => {
  await page.getByRole("button", { name: "5", exact: true }).click();
  await page.getByRole("button", { name: "0", exact: true }).click();
  await expect(page.locator('a[href^="/route/"]').first()).toBeVisible();

  await page.getByRole("button", { name: "backspace" }).click();
  await page.getByRole("button", { name: "clear" }).click();
  await expect(page.getByText("路線分類", { exact: false }).first()).toBeVisible();
});

test("opening a result navigates to that route", async ({ page }) => {
  await page.getByRole("button", { name: "1", exact: true }).click();
  await page.locator('a[href^="/route/"]').first().click();

  await expect(page).toHaveURL(/\/route\//);
  await expect(page.getByText("往 尖沙咀碼頭").first()).toBeVisible({ timeout: 10_000 });
});

test("remembers what you opened, under 最近搜尋", async ({ page }) => {
  await page.getByRole("button", { name: "1", exact: true }).click();
  await page.locator('a[href^="/route/"]').first().click();
  await expect(page.getByText("往 尖沙咀碼頭").first()).toBeVisible({ timeout: 10_000 });

  await page.goto("/search");
  // The recent tab is the one the page opens on, and it holds the visit.
  await expect(page.locator("[data-recent]")).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('[data-recent] a[href^="/route/"]')).toHaveCount(1);
});

/*
 * The router claims every link it renders and writes its own `data-active` on
 * the current one - an empty string, not "true". The travelling pill used to
 * read that attribute, so it agreed with the router on the first paint and lost
 * the argument on the first navigation: switching to 規劃 and back left the
 * switch with no pill at all, and nothing said which half you were looking at.
 */
test("the pill still marks the half you are on after switching", async ({ page }) => {
  const pill = page.locator('[role="tablist"] [data-ready]');
  const plan = page.locator('[role="tab"][href="/plan"]');
  const search = page.locator('[role="tab"][href="/search"]');
  const box = async () => {
    const rect = await pill.boundingBox();
    return { x: Math.round(rect?.x ?? -1), width: Math.round(rect?.width ?? 0) };
  };

  await expect(search).toHaveAttribute("data-pill-active", "true");
  const onSearch = await box();
  expect(onSearch.width).toBeGreaterThan(0);

  await plan.click();
  await expect(page).toHaveURL(/\/plan$/);
  await expect(plan).toHaveAttribute("data-pill-active", "true");
  await expect(pill).toHaveAttribute("data-ready", "true");
  // The same pill travelling into the other half, not a second one blinking
  // on - so it is polled, the travel being the whole point of the component.
  await expect.poll(async () => (await box()).x).toBeGreaterThan(onSearch.x);
  expect((await box()).width).toBeGreaterThan(0);

  await search.click();
  await expect(page).toHaveURL(/\/search$/);
  await expect(pill).toHaveAttribute("data-ready", "true");
  await expect.poll(async () => (await box()).x).toBe(onSearch.x);
});

/*
 * The page-enter animation says "you have arrived somewhere else". Searching
 * and planning are two halves of one screen, so replaying it on the switch
 * faded the title, the switch itself and both columns back in from nothing -
 * pressing a control on a page should not look like the page reloading.
 */
test("switching halves does not replay the page entrance", async ({ page }) => {
  const shell = page.locator("[data-page-shell]");
  await shell.evaluate((el) => {
    (window as unknown as { __replays: number }).__replays = 0;
    new MutationObserver(() => {
      if (el.classList.contains("mb-page-in"))
        (window as unknown as { __replays: number }).__replays += 1;
    }).observe(el, { attributes: true, attributeFilter: ["class"] });
  });
  const replays = () => page.evaluate(() => (window as unknown as { __replays: number }).__replays);

  await page.locator('[role="tab"][href="/plan"]').click();
  await expect(page).toHaveURL(/\/plan$/);
  await page.locator('[role="tab"][href="/search"]').click();
  await expect(page).toHaveURL(/\/search$/);
  expect(await replays()).toBe(0);

  // Leaving for a screen that really is elsewhere still announces itself.
  await page.locator('a[href="/saved"]').first().click();
  await expect(page).toHaveURL(/\/saved$/);
  await expect.poll(replays).toBeGreaterThan(0);
});

test("shows only the letters that could still follow", async ({ page }) => {
  // The fixture's route numbers use L, T and W, and only T starts one. A
  // blank field offers T; nothing else earns a key.
  // The same pad is in the DOM twice - docked for the phone, in the aside for
  // the desktop - and only one of them is on at any width, so count that one.
  const letters = page.locator("[data-keypad-letters]:visible button");
  await expect(letters).toHaveCount(1, { timeout: 10_000 });
  await expect(letters.first()).toHaveText("T");

  // After "1" nothing but a digit can follow, so the column empties while
  // the digits stay where the thumb learned them.
  await page.getByRole("button", { name: "1", exact: true }).click();
  await expect(letters).toHaveCount(0);
  await expect(page.getByRole("button", { name: "0", exact: true })).toBeEnabled();
});

test("lists every route under 全部, and one kind under its tab", async ({ page }) => {
  // Nothing typed: the tabs are the list. 全部 is everything there is, and a
  // kind is that list cut down; both are there to browse, not only to filter.
  const tabs = page.locator("[data-search-tabs]");
  const results = page.locator('a[href^="/route/"]');
  await tabs.getByRole("tab", { name: "全部" }).click();
  await expect(results.first()).toBeVisible({ timeout: 10_000 });
  const all = await results.count();
  expect(all).toBeGreaterThan(4);

  await tabs.getByRole("tab", { name: "小巴" }).click();
  await expect(results).toHaveCount(1);
  await expect(results.first()).toContainText("小巴");

  // Typing narrows whichever list is up: "1" is one green minibus.
  await page.getByRole("button", { name: "1", exact: true }).click();
  await expect(results).toHaveCount(1);
  await tabs.getByRole("tab", { name: "全部" }).click();
  await expect.poll(() => results.count()).toBeGreaterThan(1);
  await expect(results.count()).resolves.toBeLessThan(all);
});

test("a number typed on the recent tab falls through to every route", async ({ page }) => {
  // Nothing has been looked up yet, so the recent list cannot answer "1";
  // the page answers from the whole list rather than showing an empty card.
  await page.getByRole("button", { name: "1", exact: true }).click();
  await expect(page.locator('a[href^="/route/"]').first()).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('[data-search-tabs] [aria-selected="true"]')).toHaveText("全部");

  // And clearing the field brings the recent tab back.
  await page.getByRole("button", { name: "清除" }).click();
  await expect(page.locator('[data-search-tabs] [aria-selected="true"]')).toHaveText("最近搜尋");
});

test("reads each route as its number, its operator and where it is going", async ({ page }) => {
  await page.getByRole("button", { name: "1", exact: true }).click();
  const first = page.locator('a[href^="/route/"]').first();
  await expect(first).toBeVisible({ timeout: 10_000 });
  await expect(first).toContainText("九巴");
  await expect(first).toContainText("往");
  await expect(first).toContainText("尖沙咀碼頭");
  await expect(first).toContainText("竹園邨");
});

test("the dial stays put when the text field is in use", async ({ page }) => {
  const field = page.getByLabel(/路線、車站|Route, stop/);
  await field.fill("彌敦道");
  await expect(page.locator('a[href^="/stop/"]').first()).toBeVisible({ timeout: 10_000 });
  // Typing a place did not take the dial away; it is the screen's fixture.
  await expect(page.getByRole("button", { name: "5", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "backspace" })).toBeVisible();
});

test("keeps the dial pinned to the bottom of a short page", async ({ page }) => {
  const dial = page.getByRole("button", { name: "5", exact: true });
  await expect(dial).toBeVisible({ timeout: 10_000 });
  const viewport = page.viewportSize()!;
  const box = (await dial.boundingBox())!;
  // Under the thumb: in the lower third of the screen, not under the last card.
  expect(box.y).toBeGreaterThan(viewport.height * 0.55);
});

test("remembers what you opened last, and forgets it on request", async ({ page }) => {
  await page.getByRole("button", { name: "1", exact: true }).click();
  await page.locator('a[href^="/route/"]').first().click();
  await expect(page.getByText("往 尖沙咀碼頭").first()).toBeVisible({ timeout: 10_000 });

  await page.goto("/search");
  const recent = page.locator("[data-recent]");
  await expect(recent).toBeVisible({ timeout: 10_000 });
  await expect(recent.locator('a[href^="/route/"]')).toHaveCount(1);

  await recent.getByRole("button", { name: "從最近搜尋移除" }).click();
  await expect(recent).toHaveCount(0);
});
