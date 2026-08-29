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
  await expect(page.getByText("$6.7 · $2.0").first()).toBeVisible();
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

test("learns which routes you keep opening", async ({ page }) => {
  // Visit the same route twice; a single visit is not yet a habit.
  for (let i = 0; i < 2; i++) {
    await page.goto("/search");
    await page.getByRole("button", { name: "1", exact: true }).click();
    await page.locator('a[href^="/route/"]').first().click();
    await expect(page.getByText("往 尖沙咀碼頭").first()).toBeVisible({ timeout: 10_000 });
  }

  await page.goto("/search");
  await expect(page.getByText("常用", { exact: false }).first()).toBeVisible({ timeout: 10_000 });
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
  const shell = page.locator("[class*='max-w-[110rem]']");
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
