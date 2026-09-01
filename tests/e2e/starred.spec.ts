import { expect, test } from "@playwright/test";
import { mockTransit } from "./support/mock";

test.beforeEach(async ({ page }) => {
  await mockTransit(page);
});

/** Opens a stop on route 1 and stars it, which is the only way in. */
async function star(page: import("@playwright/test").Page, nth: number, group?: string) {
  await page.goto("/route/1%2B1%2BCHUK%20YUEN%20ESTATE%2BSTAR%20FERRY");
  await expect(page.locator("[data-stop-seq]").first()).toBeVisible({ timeout: 15_000 });

  await page.locator("[data-stop-seq]").nth(nth).getByRole("button").first().click();
  const toggle = page
    .locator(".app-reveal[data-open='true']")
    .getByRole("button", { name: /加入收藏|已收藏/ });
  await toggle.click();

  // The star is not made until the sheet says where it goes.
  const sheet = page.getByRole("dialog", { name: "分組" });
  await expect(sheet).toBeVisible();
  await expect(toggle).toHaveAttribute("aria-pressed", "false");

  if (group !== undefined) {
    await sheet.getByRole("textbox", { name: "新增分組" }).fill(group);
    await sheet.getByRole("button", { name: "新增分組" }).click();
    await expect(sheet.getByRole("radio", { name: group })).toHaveAttribute("aria-checked", "true");
  }

  await sheet.getByRole("button", { name: "加入收藏" }).click();
  await expect(sheet).toBeHidden();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
}

test("a star can be put in a new group as it is made", async ({ page }) => {
  await star(page, 1, "返工");

  // A group chosen at the stop is the group the list files it under.
  await page.goto("/starred");
  await expect(page.getByText("返工").first()).toBeVisible({ timeout: 15_000 });

  // The card's own group button also says 返工 now, so the filter chip is
  // told apart by the pressed state only a filter carries.
  const chip = page.getByRole("button", { name: "返工" }).and(page.locator("[aria-pressed]"));
  await chip.click();
  await expect(chip).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator('a[href^="/route/"]').first()).toBeVisible();
});

test("backing out of the group sheet makes no star", async ({ page }) => {
  await page.goto("/route/1%2B1%2BCHUK%20YUEN%20ESTATE%2BSTAR%20FERRY");
  await expect(page.locator("[data-stop-seq]").first()).toBeVisible({ timeout: 15_000 });

  await page.locator("[data-stop-seq]").nth(1).getByRole("button").first().click();
  const toggle = page
    .locator(".app-reveal[data-open='true']")
    .getByRole("button", { name: /加入收藏|已收藏/ });
  await toggle.click();

  const sheet = page.getByRole("dialog", { name: "分組" });
  await sheet.getByRole("button", { name: "關閉" }).click();
  await expect(sheet).toBeHidden();
  await expect(toggle).toHaveAttribute("aria-pressed", "false");

  await page.goto("/starred");
  await expect(page.getByText("仲未收藏過路線")).toBeVisible({ timeout: 15_000 });
});

test("stars can be ordered by something other than the hand-dragged order", async ({ page }) => {
  await star(page, 1);
  await page.goto("/starred");

  // The trigger names the question, not the answer, so it never resizes.
  // Which order is on lives in the sheet.
  const sort = page.locator('button[aria-haspopup="dialog"]');
  await expect(sort).toContainText("排序", { timeout: 15_000 });
  await sort.click();
  await expect(page.getByRole("radio", { name: "自訂" })).toHaveAttribute("aria-checked", "true");
  await page.getByRole("radio", { name: "路線號" }).click();
  await expect(sort).toContainText("排序");

  // The choice is part of how the screen is read, so it outlives the visit.
  await page.reload();
  await page.locator('button[aria-haspopup="dialog"]').click();
  await expect(page.getByRole("radio", { name: "路線號" })).toHaveAttribute(
    "aria-checked",
    "true",
    {
      timeout: 15_000,
    },
  );
});

test("a star can be put in a group, and the group filters the list", async ({ page }) => {
  await star(page, 1);
  // A second one that stays ungrouped, so the 未分組 bucket exists to filter.
  await star(page, 2);
  await page.goto("/starred");
  await expect(page.locator('a[href^="/route/"]').first()).toBeVisible({ timeout: 15_000 });

  // The group rides on the card itself - no edit mode to enter first.
  await page.getByRole("button", { name: "唔分組" }).first().click();

  await page.getByRole("textbox", { name: "新增分組" }).fill("返工");
  await page.getByRole("button", { name: "儲存" }).click();

  // The group now exists, so it is offered as a filter. Exact, because the
  // group sheet's own button names the group it would file the star under.
  const chip = page
    .getByRole("button", { name: "返工", exact: true })
    .and(page.locator("[aria-pressed]"));
  await expect(chip).toBeVisible();

  await chip.click();
  await expect(chip).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator('a[href^="/route/"]').first()).toBeVisible();

  // The cut lives in the URL, so it survives a reload and can be sent on.
  await expect(page).toHaveURL(/group=/);
  await page.reload();
  await expect(
    page.getByRole("button", { name: "返工", exact: true }).and(page.locator("[aria-pressed]")),
  ).toHaveAttribute("aria-pressed", "true", { timeout: 15_000 });

  // The ungrouped bucket is a real value - the empty string - and it must
  // round-trip through the URL the same way.
  await page.getByRole("button", { name: "未分組" }).click();
  await page.reload();
  await expect(page.getByRole("button", { name: "未分組" })).toHaveAttribute(
    "aria-pressed",
    "true",
    { timeout: 15_000 },
  );
});

test("a star can be moved to another stop on its route", async ({ page }) => {
  await star(page, 1);
  await page.goto("/starred");
  const card = page.locator('a[href^="/route/"]');
  await expect(card).toContainText("天虹小學", { timeout: 15_000 });

  await page.getByRole("button", { name: "換站" }).click();

  // The sheet knows which stop it is at now, and one tap moves it.
  const sheet = page.getByRole("dialog", { name: "換站" });
  await expect(sheet.getByRole("radio", { name: /天虹小學/ })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await sheet.getByRole("radio", { name: /馬仔坑遊樂場/ }).click();
  await expect(sheet).toBeHidden();

  // Moved, not copied: one card, watching the new stop.
  await expect(card).toHaveCount(1);
  await expect(card).toContainText("馬仔坑遊樂場");
  await expect(card).not.toContainText("天虹小學");
});

test("a pinned star is held at the top of the list", async ({ page }) => {
  await star(page, 1);
  await star(page, 2);

  await page.goto("/starred");
  const cards = page.locator('a[href^="/route/"]');
  await expect(cards.first()).toContainText("天虹小學", { timeout: 15_000 });

  // Pin the second one: the actions sit on the card itself, in card order.
  await page.getByRole("button", { name: "置頂", exact: true }).nth(1).click();

  // To the head of the list, wearing the thumbtack.
  await expect(page.locator("[data-pinned]")).toHaveCount(1);
  await expect(cards.first()).toContainText("馬仔坑遊樂場");

  // A pin is part of the star, so it outlives the visit.
  await page.reload();
  await expect(cards.first()).toContainText("馬仔坑遊樂場", { timeout: 15_000 });

  // And it comes off the same way it went on.
  await page.getByRole("button", { name: "取消置頂" }).click();
  await expect(page.locator("[data-pinned]")).toHaveCount(0);
  await expect(cards.first()).toContainText("天虹小學");
});

test("an arrival reminder can be armed from a stop and called off from the list", async ({
  page,
}) => {
  await page.goto("/route/1%2B1%2BCHUK%20YUEN%20ESTATE%2BSTAR%20FERRY");
  await expect(page.locator("[data-stop-seq]").first()).toBeVisible({ timeout: 15_000 });

  await page.locator("[data-stop-seq]").nth(1).getByRole("button").first().click();
  await page.locator('[data-open="true"]').getByRole("button", { name: "提我" }).click();

  const sheet = page.getByRole("dialog");
  await expect(sheet).toBeVisible();
  // The stub puts the next bus 3.5 minutes out and the default lead is three,
  // so at the default the reminder would fire - correctly - the instant it was
  // armed. One minute keeps it armed long enough to be seen on the list.
  await sheet.getByRole("button", { name: "1 分鐘" }).click();
  await sheet.getByRole("button", { name: /^到站通知 · 提我$/ }).click();

  // Armed reminders are listed where the stars are, and can be dropped.
  await page.goto("/starred");
  await expect(page.getByText("到站通知", { exact: false }).first()).toBeVisible({
    timeout: 15_000,
  });
  await page.getByRole("button", { name: "取消提醒" }).first().click();
  await expect(page.getByText("到站通知", { exact: false })).toHaveCount(0);
});

test("a star can be dragged to a new place in the list", async ({ page }) => {
  await star(page, 1);
  await star(page, 2);

  await page.goto("/starred");
  const cards = page.locator("[data-star-id]");
  await expect(cards).toHaveCount(2, { timeout: 15_000 });
  const firstId = await cards.first().getAttribute("data-star-id");

  // Carry the first card below the second by its grip, in finger-sized steps.
  const grip = page.getByRole("button", { name: "reorder" }).first();
  const from = await grip.boundingBox();
  const target = await cards.nth(1).boundingBox();
  if (!from || !target) throw new Error("no boxes to drag between");
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  const toY = target.y + target.height / 2;
  for (let step = 1; step <= 6; step++) {
    await page.mouse.move(from.x + from.width / 2, from.y + ((toY - from.y) * step) / 6);
    await page.waitForTimeout(30);
  }
  await page.mouse.up();

  // Reordered, and the order is the star's own - it survives a reload.
  await expect(cards.last()).toHaveAttribute("data-star-id", firstId!);
  await page.reload();
  await expect(page.locator("[data-star-id]").last()).toHaveAttribute("data-star-id", firstId!, {
    timeout: 15_000,
  });
});
