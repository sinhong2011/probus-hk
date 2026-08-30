import { expect, test } from "@playwright/test";
import { mockTransit } from "./support/mock";

test.beforeEach(async ({ page }) => {
  await mockTransit(page);
});

/**
 * The keypad's letters were hand-written and happened to omit every letter an
 * MTR line code needs, so ten lines of railway were unreachable and nothing in
 * the suite noticed. The fixture now carries a real line.
 */
test("a line code can be typed on the keypad", async ({ page }) => {
  await page.goto("/search");

  for (const key of ["T", "W", "L"]) {
    await page.getByRole("button", { name: key, exact: true }).click();
  }

  await expect(page.locator('a[href^="/route/"]').first()).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText("荃灣").first()).toBeVisible();
});

test("a line carries its own colour rather than one plate for the whole railway", async ({
  page,
}) => {
  await page.goto("/route/TWL%2B1%2BCentral%2BTsuen%20Wan");

  await expect(page.getByText("往 荃灣").first()).toBeVisible({ timeout: 15_000 });

  // Tsuen Wan line red, the value MTR prints on its own maps. Riders navigate
  // by these; one maroon plate for all ten lines said nothing.
  const background = await page
    .getByText("TWL", { exact: true })
    .first()
    .evaluate((el) => getComputedStyle(el.parentElement as HTMLElement).background);
  expect(background).toContain("rgb(230, 0, 18)");
});

test("a rail arrival says which platform", async ({ page }) => {
  await page.goto("/route/TWL%2B1%2BCentral%2BTsuen%20Wan");
  await expect(page.locator("[data-stop-seq]").first()).toBeVisible({ timeout: 15_000 });

  // Minutes alone are half an answer on a railway: the train may be leaving
  // from the other side of the island.
  await expect(page.getByText(/月台\s*\d/).first()).toBeVisible({ timeout: 15_000 });
});

/**
 * The railway had no front door. It was reachable only as fifty entries in a
 * category list sorted by route number, which put all twenty-seven light rail
 * routes above the ten MTR lines - so in practice the underground was missing.
 */
test("the railway has a screen of its own, organised as lines", async ({ page }) => {
  await page.goto("/rail");

  // A line, not a pair of routes: "Central to Tsuen Wan" is not what anyone
  // calls it.
  await expect(page.getByText("荃灣綫")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("16 個站")).toBeVisible();

  const tabs = page.getByRole("navigation", { name: "導覽" });
  await expect(tabs.getByRole("link", { name: "鐵路" })).toHaveAttribute("aria-current", "page");
});

test("a line's direction opens that direction's route", async ({ page }) => {
  await page.goto("/rail");
  await expect(page.getByText("荃灣綫")).toBeVisible({ timeout: 15_000 });

  await page
    .getByRole("link", { name: /往 荃灣/ })
    .first()
    .click();
  await expect(page).toHaveURL(/\/route\/TWL/);
  await expect(page.getByText("往 荃灣").first()).toBeVisible();
});

test("a station can be bookmarked like any other stop", async ({ page }) => {
  await page.goto("/route/TWL%2B1%2BCentral%2BTsuen%20Wan");
  await expect(page.locator("[data-stop-seq]").first()).toBeVisible({ timeout: 15_000 });

  await page.locator("[data-stop-seq]").nth(2).getByRole("button").first().click();
  const pin = page.locator('[data-open="true"]').getByRole("button", { name: "pin" });
  await pin.click();
  await page
    .getByRole("dialog", { name: "分組" })
    .getByRole("button", { name: "加入收藏" })
    .click();
  await expect(pin).toHaveAttribute("aria-pressed", "true");

  // Bookmarks are route-agnostic, but a railway station is the one place where
  // that had never actually been exercised.
  await page.goto("/saved");
  await expect(page.getByText("往 荃灣").first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("TWL").first()).toBeVisible();
});

/**
 * A railway line is a place you stand and two ways it can take you, which the
 * direction-first route page could only answer by being visited twice.
 */
test("a line has a screen of its own, and a station answers both directions", async ({ page }) => {
  await page.goto("/rail");
  await expect(page.getByText("荃灣綫")).toBeVisible({ timeout: 15_000 });

  await page
    .getByRole("link", { name: /荃灣綫/ })
    .first()
    .click();
  await expect(page).toHaveURL(/\/rail\/TWL/);

  // The stations, in order, on the line's own colour.
  await expect(page.getByRole("button", { name: /中環/ }).first()).toBeVisible({
    timeout: 15_000,
  });

  await page
    .getByRole("button", { name: /中環/ })
    .first()
    .click();
  await expect(page.getByText(/月台\s*\d/).first()).toBeVisible({ timeout: 15_000 });
});

test("plans a journey between two stations from the link", async ({ page }) => {
  // Central to Tsuen Wan is one train: fifteen stations, a little over half
  // an hour with the wait for it.
  await page.goto("/rail?from=CEN&to=TSW");
  const card = page.locator("[data-rail-journey]").first();
  await expect(card).toBeVisible({ timeout: 10_000 });
  await expect(card).toContainText("直達");
  await expect(card).toContainText("32");
  // The suggestion opens showing its legs, and the leg links to the line.
  await expect(page.getByText("往 荃灣").first()).toBeVisible();
  await expect(page.locator('[data-rail-planner] a[href^="/route/"]').first()).toBeVisible();
});

test("picks both stations from a sheet, and swaps them", async ({ page }) => {
  await page.goto("/rail");
  await page.locator('[data-rail-end="from"]').click();
  await page.getByLabel("選擇車站").fill("中環");
  await page.locator('[data-rail-station="CEN"]').click();

  await page.locator('[data-rail-end="to"]').click();
  await page.locator('[data-rail-station="TSW"]').click();
  await expect(page).toHaveURL(/from=CEN/);
  await expect(page).toHaveURL(/to=TSW/);
  await expect(page.locator("[data-rail-journey]").first()).toContainText("直達");

  await page.locator("[data-rail-swap]").click();
  await expect(page).toHaveURL(/from=TSW/);
  await expect(page.getByText("往 中環").first()).toBeVisible();
});

/**
 * A rail fare exists only between two stations, so the route database - which
 * stores one fare per boarding stop - carries none at all for the MTR. The
 * railway's own table is shipped instead, and this is the trip it prices.
 */
test("two stations on a line price the ride between them", async ({ page }) => {
  await page.goto("/rail/TWL");

  const station = (name: string) => page.getByRole("button", { name: new RegExp(name) }).first();
  await expect(station("旺角")).toBeVisible({ timeout: 15_000 });

  // One tap is a station: both directions and their platforms, as before.
  await station("旺角").click();
  await expect(page.getByText(/月台\s*\d/).first()).toBeVisible({ timeout: 15_000 });

  // The second tap is a destination, and turns the pair into a fare.
  await station("長沙灣").click();
  const fare = page.locator("[data-rail-fare]");
  await expect(fare).toBeVisible();
  await expect(fare).toContainText("旺角");
  await expect(fare).toContainText("長沙灣");

  // The amounts move with the fare revisions; that there is an Octopus fare
  // and a single-journey one beside it does not.
  await expect(fare).toContainText("八達通", { timeout: 10_000 });
  await expect(fare).toContainText("單程票");
  await expect(fare).toContainText(/\$\d+(\.\d)?/);

  await fare.getByRole("button", { name: "取消" }).click();
  await expect(fare).toBeHidden();
});

/**
 * The map pans itself when it opens - to the station you are standing at, or
 * to the hub - and it measures its own container to decide how far. A click
 * taken before that settles lands wherever the station used to be, which is
 * why these read the position only once the view has stopped moving.
 */
async function settled(page: import("@playwright/test").Page) {
  const svg = page.locator("svg[role=application]");
  await expect(svg).toBeVisible({ timeout: 15_000 });
  let last = "";
  await expect
    .poll(
      async () => {
        const now = (await svg.getAttribute("viewBox")) ?? "";
        const still = now === last && now !== "";
        last = now;
        return still;
      },
      { timeout: 15_000 },
    )
    .toBe(true);
}

/**
 * Tapping a station on the diagram used to clear the selection instead of
 * making one: the SVG took pointer capture on `pointerdown`, which redirects
 * the rest of the gesture to itself, so the `pointerup` that decides what was
 * tapped was delivered to the background every time. It is invisible in code
 * review and total in effect, so it is pinned here.
 */
test("a station tapped on the network map opens it", async ({ page }) => {
  await page.goto("/rail/map");

  await settled(page);

  // The map opens on the station the fixture's location puts you at, so this
  // one is centred and certain to be under the viewport.
  const station = page.locator('g[aria-label^="油麻地"] circle').first();
  const box = await station.boundingBox();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.mouse.up();

  await expect(page.getByRole("heading", { name: "油麻地" }).first()).toBeVisible();

  // Every line through it is the way on: its row opens the line in the same
  // sheet, stations and all, without leaving the map.
  await page.getByRole("button", { name: "荃灣綫" }).first().click();
  await expect(page.getByRole("heading", { name: /荃灣綫/ }).first()).toBeVisible();
  await expect(page.getByText("沿線車站")).toBeVisible();
  await expect(page.getByRole("button", { name: "尖沙咀" }).first()).toBeVisible();
});

test("dragging the network map pans it rather than picking a station", async ({ page }) => {
  await page.goto("/rail/map");

  await settled(page);

  const station = page.locator('g[aria-label^="油麻地"] circle').first();
  const before = await page.locator("svg[role=application]").getAttribute("viewBox");

  const box = await station.boundingBox();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.mouse.move(box!.x + 130, box!.y + 90, { steps: 8 });
  await page.mouse.up();

  await expect(page.getByRole("heading", { name: "油麻地" }).first()).toBeHidden();
  expect(await page.locator("svg[role=application]").getAttribute("viewBox")).not.toBe(before);
});

/**
 * The light rail is the map's second layer: always drawn as a network, but its
 * sixty-eight stops appear only once the rider has zoomed into it - and the
 * key's entry for it is the way in.
 */
test("the light rail unfolds when you go into it", async ({ page }) => {
  await page.goto("/rail/map");
  await settled(page);

  // The tram stops are there but folded: the ferry pier is drawn at nothing.
  // By id, because the test fixture carries no light rail names.
  const pier = page.locator('g[data-station="LR1"]');
  await expect(pier).toHaveAttribute("opacity", "0");

  await page.getByRole("button", { name: "輕鐵", exact: true }).click();
  await settled(page);

  await expect(pier).toHaveAttribute("opacity", "1");
  await expect(pier.locator("text").first()).toBeVisible();
});
