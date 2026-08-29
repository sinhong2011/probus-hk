import { expect, test } from "@playwright/test";
import { mockTransit } from "./support/mock";

/**
 * A stop card is a name of any length beside a distance of a fixed one.
 *
 * The distance sits in a fixed-height pill, so a value that wraps does not make
 * the pill taller - it spills out of it, which is what "52" over "m" was. Flex
 * shrinks both children of the row, and "52 m" has a break opportunity at the
 * space, so a few pixels of pressure were enough.
 *
 * Every stop in the fixture is short-named, so the pressure is applied here.
 */
test("a long stop name never breaks the distance out of its pill", async ({ page }) => {
  await mockTransit(page);
  await page.goto("/");
  // The radius buttons also read "400 m", so wait for a real card.
  await expect(page.locator('a[href^="/stop/"]').first()).toBeVisible({ timeout: 15_000 });

  const pill = await page.evaluate(() => {
    const row = document.querySelector('a[href^="/stop/"]') as HTMLElement;
    const [zh, en] = row.querySelectorAll("span");

    // A real Choi Wan kerb, in both languages.
    if (zh) zh.textContent = "豐盛街, 近彩雲(一)邨觀日樓";
    if (en) en.textContent = "Fung Shing Street, Near Koon Yat House, Choi Wan (1) Estate";

    const value = row.querySelector("span.tnum") as HTMLElement;
    const box = value.parentElement as HTMLElement;
    return { scrollHeight: box.scrollHeight, clientHeight: box.clientHeight };
  });

  expect(pill.scrollHeight).toBeLessThanOrEqual(pill.clientHeight);
});
