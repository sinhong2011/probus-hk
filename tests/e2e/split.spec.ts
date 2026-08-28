import { expect, test } from "@playwright/test";
import { mockTransit } from "./support/mock";

const ROUTE = "/route/1%2B1%2BCHUK%20YUEN%20ESTATE%2BSTAR%20FERRY";

test("the list pane scrolls, the page does not", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "dark" });
  const page = await ctx.newPage();
  await mockTransit(page);
  await page.goto(ROUTE);
  await expect(page.locator("[data-stop-seq]").first()).toBeVisible({ timeout: 15_000 });

  const pane = page.locator("[data-stop-seq]").first().locator("xpath=ancestor::div[contains(@class,'overflow-y-auto')][1]");
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
