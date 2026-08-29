import { expect, test } from "@playwright/test";
import { mockTransit } from "./support/mock";

const ROUTE = "/route/1%2B1%2BCHUK%20YUEN%20ESTATE%2BSTAR%20FERRY";

test("the list pane scrolls, the page does not", async ({ browser }) => {
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    colorScheme: "dark",
  });
  const page = await ctx.newPage();
  await mockTransit(page);
  await page.goto(ROUTE);
  await expect(page.locator("[data-stop-seq]").first()).toBeVisible({ timeout: 15_000 });

  const pane = page
    .locator("[data-stop-seq]")
    .first()
    .locator("xpath=ancestor::div[contains(@class,'overflow-y-auto')][1]");
  const before = await pane.evaluate((el) => ({
    top: el.scrollTop,
    over: el.scrollHeight > el.clientHeight,
  }));
  await pane.evaluate((el) => el.scrollBy(0, 600));
  const after = await pane.evaluate((el) => el.scrollTop);

  expect(before.over, "the stop list overflows its pane").toBe(true);
  expect(after).toBeGreaterThan(before.top);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  await ctx.close();
});

/*
 * `scrollIntoView` scrolls every scrollable ancestor, and an `overflow: hidden`
 * box is scrollable to script even though nothing can scroll it back. Jumping
 * to a stop near the end of the route used to shove the card's own list up
 * behind its rounded top and leave a hole the height of the shove under it.
 */
test("jumping to a stop scrolls the list, not the card around it", async ({ browser }) => {
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    colorScheme: "dark",
  });
  const page = await ctx.newPage();
  await mockTransit(page);
  await page.goto(ROUTE);
  const rows = page.locator("[data-stop-seq]");
  await expect(rows.first()).toBeVisible({ timeout: 15_000 });
  const last = await rows.count();

  await page.goto(`${ROUTE}?stop=${last}`);
  await expect(rows.first()).toBeVisible({ timeout: 15_000 });
  await expect(page.locator(`[data-stop-seq="${last}"]`)).toBeInViewport();

  const box = await rows.first().evaluate((row) => {
    const list = row.closest(".mb-scroll") as HTMLElement;
    const card = list.parentElement as HTMLElement;
    return {
      card: card.scrollTop,
      pane: (card.parentElement as HTMLElement).scrollTop,
      // The list fills the card it is framed by: no hole under the last stop.
      gap: card.getBoundingClientRect().bottom - list.getBoundingClientRect().bottom,
    };
  });

  expect(box.card, "the card is a frame, not a scroller").toBe(0);
  expect(box.pane, "the pane is a frame, not a scroller").toBe(0);
  expect(box.gap).toBeLessThan(4);
  await ctx.close();
});
