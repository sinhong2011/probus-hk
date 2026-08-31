import { expect, test } from "@playwright/test";
import { mockTransit } from "./support/mock";

/**
 * Every other spec runs against the production build - which is exactly where
 * Solid's development assertions have been compiled away.
 *
 * Two real bugs shipped past the whole suite that way: a signal written during
 * component setup, and the route database read outside a tracking scope. Both
 * crashed the app to a blank screen in `vp dev` while every production test
 * stayed green. This spec walks the app in development mode purely to catch
 * that class of mistake.
 */
const ROUTES = [
  "/",
  "/search",
  "/plan",
  "/notices",
  "/rail",
  "/rail/TWL",
  "/browse",
  "/browse/overnight",
  "/saved",
  "/settings",
  `/route/${encodeURIComponent("1+1+CHUK YUEN ESTATE+STAR FERRY")}`,
  // An unknown path must fall through to the catch-all, not explode.
  "/dashboard",
];

for (const path of ROUTES) {
  test(`renders ${path} with no development warnings`, async ({ page }) => {
    const problems: string[] = [];
    page.on("pageerror", (e) => problems.push(String(e)));
    page.on("console", (m) => {
      // The mock deliberately aborts fonts and map tiles, and the browser logs
      // each one. Those are ours, not the app's.
      const text = m.text();
      const ourOwnMock = text.includes("Failed to load resource");
      if (m.type() === "error" && !ourOwnMock) problems.push(text);
    });

    await mockTransit(page);
    await page.goto(path);

    // Something must actually render; a Solid assertion halts the reactive
    // system and leaves the root empty.
    await expect(page.locator("#root")).not.toBeEmpty({ timeout: 20_000 });

    expect(problems, `development warnings on ${path}`).toEqual([]);
  });
}

test("a page transition leaves nothing behind that could trap fixed children", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("navigation", { name: "導覽" }).getByRole("link", { name: "搜尋" }).click();
  await expect(page).toHaveURL(/\/search/);

  // The entrance animation has no fill mode on purpose: a transform or an
  // opacity left applied would make the shell the containing block for every
  // fixed element under it, which is how a sticky keypad ends up in the wrong
  // place.
  const shell = page.locator("div.mx-auto.w-full").first();
  await expect
    .poll(async () => shell.evaluate((el) => getComputedStyle(el).transform), { timeout: 10_000 })
    .toBe("none");
  expect(await shell.evaluate((el) => getComputedStyle(el).opacity)).toBe("1");
});

test("the saved screen renders its cards with no development warnings", async ({ page }) => {
  const problems: string[] = [];
  page.on("pageerror", (e) => problems.push(String(e)));
  page.on("console", (m) => {
    const text = m.text();
    if (m.type() === "error" && !text.includes("Failed to load resource")) problems.push(text);
  });

  await mockTransit(page);
  // The route dev.spec walks /saved empty; the cards, the sortable grid and
  // the drag wiring only exist once there are bookmarks to draw.
  await page.addInitScript(() => {
    if (!localStorage.getItem("probus:db:bookmarks")) {
      localStorage.setItem(
        "probus:saved",
        JSON.stringify([
          {
            id: "1+1+CHUK YUEN ESTATE+STAR FERRY@9ED7E93749ABAE67",
            routeKey: "1+1+CHUK YUEN ESTATE+STAR FERRY",
            co: "kmb",
            stopId: "9ED7E93749ABAE67",
            seq: 2,
            group: "返工",
          },
          {
            id: "102+1+MEI FOO+SHAU KEI WAN@001436",
            routeKey: "102+1+MEI FOO+SHAU KEI WAN",
            co: "ctb",
            stopId: "001436",
            seq: 2,
            group: "",
          },
        ]),
      );
    }
  });
  await page.goto("/saved");
  await expect(page.locator("[data-bookmark-id]")).toHaveCount(2, { timeout: 20_000 });
  expect(problems, "development warnings on /saved with bookmarks").toEqual([]);
});
