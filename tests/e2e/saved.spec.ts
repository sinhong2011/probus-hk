import { expect, test } from "@playwright/test";
import { mockTransit } from "./support/mock";

test.beforeEach(async ({ page }) => {
  await mockTransit(page);
});

/** Opens a stop on route 1 and bookmarks it, which is the only way in. */
async function bookmark(page: import("@playwright/test").Page, nth: number, group?: string) {
  await page.goto("/route/1%2B1%2BCHUK%20YUEN%20ESTATE%2BSTAR%20FERRY");
  await expect(page.locator("[data-stop-seq]").first()).toBeVisible({ timeout: 15_000 });

  await page.locator("[data-stop-seq]").nth(nth).getByRole("button").first().click();
  const pin = page.locator('[data-open="true"]').getByRole("button", { name: "pin" });
  await pin.click();

  // The bookmark is not made until the sheet says where it goes.
  const sheet = page.getByRole("dialog", { name: "分組" });
  await expect(sheet).toBeVisible();
  await expect(pin).toHaveAttribute("aria-pressed", "false");

  if (group !== undefined) {
    await sheet.getByRole("textbox", { name: "新增分組" }).fill(group);
    await sheet.getByRole("button", { name: "新增分組" }).click();
    await expect(sheet.getByRole("radio", { name: group })).toHaveAttribute("aria-checked", "true");
  }

  await sheet.getByRole("button", { name: "加入收藏" }).click();
  await expect(sheet).toBeHidden();
  await expect(pin).toHaveAttribute("aria-pressed", "true");
}

test("a bookmark can be put in a new group as it is made", async ({ page }) => {
  await bookmark(page, 1, "返工");

  // A group chosen at the stop is the group the list files it under.
  await page.goto("/saved");
  await expect(page.getByText("返工").first()).toBeVisible({ timeout: 15_000 });

  const chip = page.getByRole("button", { name: "返工" });
  await chip.click();
  await expect(chip).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator('a[href^="/route/"]').first()).toBeVisible();
});

test("backing out of the group sheet makes no bookmark", async ({ page }) => {
  await page.goto("/route/1%2B1%2BCHUK%20YUEN%20ESTATE%2BSTAR%20FERRY");
  await expect(page.locator("[data-stop-seq]").first()).toBeVisible({ timeout: 15_000 });

  await page.locator("[data-stop-seq]").nth(1).getByRole("button").first().click();
  const pin = page.locator('[data-open="true"]').getByRole("button", { name: "pin" });
  await pin.click();

  const sheet = page.getByRole("dialog", { name: "分組" });
  await sheet.getByRole("button", { name: "關閉" }).click();
  await expect(sheet).toBeHidden();
  await expect(pin).toHaveAttribute("aria-pressed", "false");

  await page.goto("/saved");
  await expect(page.getByText("仲未收藏過路線")).toBeVisible({ timeout: 15_000 });
});

test("bookmarks can be ordered by something other than the hand-dragged order", async ({
  page,
}) => {
  await bookmark(page, 1);
  await page.goto("/saved");

  // Order rides in the header wearing its own answer; the four choices only
  // appear when the header button is asked for them.
  const sort = page.locator('button[aria-haspopup="dialog"]');
  await expect(sort).toContainText("自訂", { timeout: 15_000 });
  await sort.click();
  await page.getByRole("radio", { name: "路線號" }).click();
  await expect(sort).toContainText("路線號");

  // The choice is part of how the screen is read, so it outlives the visit.
  await page.reload();
  await expect(page.locator('button[aria-haspopup="dialog"]')).toContainText("路線號", {
    timeout: 15_000,
  });
});

test("a bookmark can be put in a group, and the group filters the list", async ({ page }) => {
  await bookmark(page, 1);
  await page.goto("/saved");
  await expect(page.locator('a[href^="/route/"]').first()).toBeVisible({ timeout: 15_000 });

  await page.getByRole("button", { name: "編輯" }).click();
  await page.getByRole("button", { name: "唔分組" }).first().click();

  await page.getByRole("textbox", { name: "新增分組" }).fill("返工");
  await page.getByRole("button", { name: "儲存" }).click();

  // The group now exists, so it is offered as a filter. Exact, because the
  // group sheet's own button names the group it would file the bookmark under.
  await page.getByRole("button", { name: "完成" }).click();
  const chip = page.getByRole("button", { name: "返工", exact: true });
  await expect(chip).toBeVisible();

  await chip.click();
  await expect(chip).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator('a[href^="/route/"]').first()).toBeVisible();
});

test("a bookmark can be moved to another stop on its route", async ({ page }) => {
  await bookmark(page, 1);
  await page.goto("/saved");
  const card = page.locator('a[href^="/route/"]');
  await expect(card).toContainText("天虹小學", { timeout: 15_000 });

  await page.getByRole("button", { name: "編輯" }).click();
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

test("a pinned bookmark is held at the top of the list", async ({ page }) => {
  await bookmark(page, 1);
  await bookmark(page, 2);

  await page.goto("/saved");
  const cards = page.locator('a[href^="/route/"]');
  await expect(cards.first()).toContainText("天虹小學", { timeout: 15_000 });

  // Pin the second one: the actions sit under the card while the list is being
  // edited, in the order the cards are in.
  await page.getByRole("button", { name: "編輯" }).click();
  await page.getByRole("button", { name: "置頂", exact: true }).nth(1).click();
  await page.getByRole("button", { name: "完成" }).click();

  // Out of the list, into a band of its own at the top.
  // First: the label sits in a span inside the section heading, so it matches twice.
  await expect(page.getByText("置頂", { exact: true }).first()).toBeVisible();
  await expect(cards.first()).toContainText("馬仔坑遊樂場");

  // A pin is part of the bookmark, so it outlives the visit.
  await page.reload();
  await expect(cards.first()).toContainText("馬仔坑遊樂場", { timeout: 15_000 });

  // And it comes off the same way it went on.
  await page.getByRole("button", { name: "編輯" }).click();
  await page.getByRole("button", { name: "取消置頂" }).click();
  await page.getByRole("button", { name: "完成" }).click();
  await expect(page.getByText("置頂", { exact: true })).toHaveCount(0);
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

  // Armed reminders are listed where the bookmarks are, and can be dropped.
  await page.goto("/saved");
  await expect(page.getByText("到站通知", { exact: false }).first()).toBeVisible({
    timeout: 15_000,
  });
  await page.getByRole("button", { name: "取消提醒" }).first().click();
  await expect(page.getByText("到站通知", { exact: false })).toHaveCount(0);
});
