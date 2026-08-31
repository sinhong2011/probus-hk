import { expect, test } from "@playwright/test";
import { mockRunningBuses, mockTransit } from "./support/mock";

const KMB_1 = encodeURIComponent("1+1+CHUK YUEN ESTATE+STAR FERRY");

/** Every stop on the route is a row you can open. */
const stopRows = (page: import("@playwright/test").Page) => page.locator("button[aria-expanded]");

test.beforeEach(async ({ page }) => {
  await mockTransit(page);
});

test("warns when the last bus of the day is the next hour's problem", async ({ page }) => {
  // 23:20 Hong Kong time. Route 1 runs 05:35 - 23:40, so the last one is
  // twenty minutes out and the page should be saying so rather than making a
  // rider open the timetable to find it.
  await page.clock.setFixedTime(new Date("2026-08-29T15:20:00Z"));
  await page.goto(`/route/${KMB_1}`);

  // The timetable sheet states the same two ends, so the countdown itself is
  // what distinguishes the warning from the reference.
  await expect(page.getByText("尾班 23:40 · 20 分鐘")).toBeVisible({ timeout: 15_000 });
});

test("counts down to the first bus once it is within the hour", async ({ page }) => {
  // 05:00 Hong Kong time. Route 1's first is 05:35, so the wait is thirty-five
  // minutes. The other half of this chip has always counted down to the last
  // departure; this half stated a clock time and left the subtraction to a
  // rider standing at a stop at five in the morning.
  await page.clock.setFixedTime(new Date("2026-08-29T21:00:00Z"));
  await page.goto(`/route/${KMB_1}`);

  await expect(page.getByText("而家未有車 · 首班 05:35 · 35 分鐘")).toBeVisible({
    timeout: 15_000,
  });
});

test("states the first bus without a countdown when it is a night away", async ({ page }) => {
  // 00:30, five hours before the first one. "300 分鐘" is not a wait a rider
  // holds in their head, so past the hour the clock time stands alone.
  await page.clock.setFixedTime(new Date("2026-08-29T16:30:00Z"));
  await page.goto(`/route/${KMB_1}`);

  // The whole chip, so that "no countdown" is actually asserted rather than
  // just "the clock time is somewhere in there".
  const chip = page.locator("span.tnum", { hasText: "首班 05:35" }).first();
  await expect(chip).toHaveText("而家未有車 · 首班 05:35", { timeout: 15_000 });
});

test("passes on the operator's word that a departure is the last one", async ({ page }) => {
  // Every feed carries remarks - 最後班次, 延誤 - and the app parsed them and
  // then dropped them on the floor. The last of the three arrivals says so.
  await page.route("**/data.etabus.gov.hk/**", (route) => {
    const at = (minutes: number) => {
      const hk = new Date(Date.now() + minutes * 60_000 + 8 * 60 * 60 * 1000);
      return `${hk.toISOString().slice(0, 19)}+08:00`;
    };
    const data = [];
    for (let seq = 1; seq <= 40; seq++) {
      for (const dir of ["O", "I"]) {
        [3.5, 11.5, 24.5].forEach((offset, index) => {
          data.push({
            co: "KMB",
            route: "1",
            dir,
            service_type: 1,
            seq,
            eta_seq: index + 1,
            eta: at(offset),
            rmk_tc: index === 2 ? "最後班次" : "",
            rmk_en: index === 2 ? "Last departure" : "",
            dest_tc: "尖沙咀碼頭",
            dest_en: "STAR FERRY",
          });
        });
      }
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "access-control-allow-origin": "*" },
      body: JSON.stringify({ type: "StopETA", version: "1.0", data }),
    });
  });

  await page.goto(`/route/${KMB_1}`);
  await expect(stopRows(page).first()).toBeVisible({ timeout: 15_000 });

  // The mark rides with the departure it belongs to, which here is the last of
  // the three - the ones an opened stop reveals.
  await stopRows(page).nth(3).click();
  // The badge says the app's own short word for it, not whichever phrase the
  // operator used, so a column of them stays one width.
  await expect(page.locator('[data-open="true"]').getByText("尾班").first()).toBeVisible({
    timeout: 10_000,
  });
});

test("carries a disruption beside the stop's name, and opens it in full", async ({ page }) => {
  // A diversion is a sentence, not a badge. Beside the countdown it was cut to
  // six characters with no way to read the rest; beside the name it keeps the
  // operator's words and opens.
  const NOTICE = "受阻於牛池灣，改行清水灣道，不停牛池灣街市站";
  await page.route("**/data.etabus.gov.hk/**", (route) => {
    const at = (minutes: number) => {
      const hk = new Date(Date.now() + minutes * 60_000 + 8 * 60 * 60 * 1000);
      return `${hk.toISOString().slice(0, 19)}+08:00`;
    };
    const data = [];
    for (let seq = 1; seq <= 40; seq++) {
      for (const dir of ["O", "I"]) {
        data.push({
          co: "KMB",
          route: "1",
          dir,
          service_type: 1,
          seq,
          eta_seq: 1,
          eta: at(6.5),
          rmk_tc: NOTICE,
          rmk_en: "Diverted via Clear Water Bay Road",
          dest_tc: "尖沙咀碼頭",
          dest_en: "STAR FERRY",
        });
      }
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "access-control-allow-origin": "*" },
      body: JSON.stringify({ type: "StopETA", version: "1.0", data }),
    });
  });

  await page.goto(`/route/${KMB_1}`);
  const notices = page.locator('[data-stop-seq]:has([aria-label^="班次通告"])');
  await expect(notices.first()).toBeVisible({ timeout: 15_000 });

  /*
   * Pinned to one stop rather than left as `.first()`. The rows poll one at a
   * time and the page scrolls itself to the stop nearest the rider, so for a
   * second after the list appears "the first row with a notice" names a
   * different row each time it is asked - and the state read before the tap
   * then belongs to a row the tap never touched.
   */
  const seq = await notices.first().getAttribute("data-stop-seq");
  const row = page.locator(`[data-stop-seq="${seq}"]`);
  const chip = row.locator('[aria-label^="班次通告"]');
  await expect(chip).toBeVisible();
  const toggle = row.locator("button[aria-expanded]");
  const wasOpen = await toggle.getAttribute("aria-expanded");

  // Tapping it opens the whole sentence, in both languages.
  await chip.click();
  const dialog = page.getByRole("dialog", { name: "班次通告" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(NOTICE)).toBeVisible();
  await expect(dialog.getByText("Diverted via Clear Water Bay Road")).toBeVisible();

  // And nothing else: the row it sits on is a control of its own, and the
  // notice is not a second way of working it.
  await expect(toggle).toHaveAttribute("aria-expanded", wasOpen ?? "false");
});

test("says a notice that covers a run of stops once, and paints the rail", async ({ page }) => {
  // Eleven stops under one diversion were eleven identical badges, each
  // costing the name beside it its tail. The words belong at the first stop
  // of the run; after that the rail carries the meaning and each row keeps
  // only the mark, which still opens the notice.
  await page.route("**/data.etabus.gov.hk/**", (route) => {
    const at = (minutes: number) => {
      const hk = new Date(Date.now() + minutes * 60_000 + 8 * 60 * 60 * 1000);
      return `${hk.toISOString().slice(0, 19)}+08:00`;
    };
    const data = [];
    for (let seq = 1; seq <= 40; seq++) {
      for (const dir of ["O", "I"]) {
        data.push({
          co: "KMB",
          route: "1",
          dir,
          service_type: 1,
          seq,
          eta_seq: 1,
          eta: at(6.5),
          rmk_tc: "行車受阻",
          rmk_en: "Traffic congestion",
          dest_tc: "尖沙咀碼頭",
          dest_en: "STAR FERRY",
        });
      }
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "access-control-allow-origin": "*" },
      body: JSON.stringify({ type: "StopETA", version: "1.0", data }),
    });
  });

  await page.goto(`/route/${KMB_1}`);
  await expect
    .poll(async () => page.locator('[data-notice="continued"]').count(), { timeout: 15_000 })
    .toBeGreaterThan(3);

  // One row says it in words; the rest wear the mark alone.
  await expect(page.locator('[data-notice="start"]')).toHaveCount(1);
  await expect(page.locator('[data-notice="start"]')).toContainText("行車受阻");
  await expect(page.locator('[data-notice="continued"]').first()).not.toContainText("行車受阻");

  // And the mark is still a way in.
  await page.locator('[data-notice="continued"]').first().click();
  await expect(page.getByRole("dialog", { name: "班次通告" }).getByText("行車受阻")).toBeVisible();
});

test("draws the bus on the rail between the stops it is between", async ({ page }) => {
  // A countdown that jumps from fourteen minutes at one stop to one at the
  // next reads as a mistake until the bus between them is drawn.
  await mockRunningBuses(page);
  await page.goto(`/route/${KMB_1}`);
  await expect(page.locator("[data-rail-bus]").first()).toBeAttached({ timeout: 15_000 });
});

test("states the ends of the service day when neither end is near", async ({ page }) => {
  // 14:00, when the same fact is a line of reference rather than a warning -
  // and a line of reference is what the timetable dialog is for. The page
  // itself keeps only the exception worth interrupting for, so at two in the
  // afternoon it says nothing about the span and asking it to is asking for
  // the warning to be permanent.
  await page.clock.setFixedTime(new Date("2026-08-29T06:00:00Z"));
  await page.goto(`/route/${KMB_1}`);
  await expect(page.getByText("往 尖沙咀碼頭").first()).toBeVisible({ timeout: 15_000 });

  await page.getByRole("button", { name: "路線資料" }).click();
  await expect(page.getByRole("dialog").getByText("首班 05:35 · 尾班 23:40")).toBeVisible();
});

test("shows the route, its operator and its whole stop list", async ({ page }) => {
  await page.goto(`/route/${KMB_1}`);

  await expect(page.getByText("往 尖沙咀碼頭").first()).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText("九巴", { exact: false }).first()).toBeVisible();

  // Every stop, with nothing folded away: the ones behind you are still part of
  // the route, and hiding them put half the answer behind a control.
  expect(await stopRows(page).count()).toBeGreaterThan(20);
  await expect(page.getByRole("button", { name: /較早車站/ })).toHaveCount(0);
});

test("numbers the stops so a position on the route is legible", async ({ page }) => {
  await page.goto(`/route/${KMB_1}`);
  await expect(stopRows(page).first()).toBeVisible({ timeout: 10_000 });

  // The first row carries its sequence number. Read off the row rather than off
  // the control: the control is a layer covering the row, so the row can carry
  // a notice beside the name that opens something of its own.
  await expect(page.locator("[data-stop-seq]").first()).toContainText("1");
});

test("shows the full fare and the concession on every stop", async ({ page }) => {
  await page.goto(`/route/${KMB_1}`);
  await expect(stopRows(page).first()).toBeVisible({ timeout: 10_000 });

  await expect(page.getByText(/車費\s?\$\d/).first()).toBeVisible();
  await expect(page.getByText(/樂悠車費\s?\$2\.0/).first()).toBeVisible();
});

test("shows the next arrival on every stop without tapping", async ({ page }) => {
  await page.goto(`/route/${KMB_1}`);
  await expect(stopRows(page).first()).toBeVisible({ timeout: 10_000 });

  // The list is the answer, not a menu of questions: a rider should be able to
  // read the whole route without opening anything.
  await expect
    .poll(async () => page.locator("[data-eta-state]").count(), { timeout: 10_000 })
    .toBeGreaterThan(3);
});

test("opening a stop reveals the departures after the next one", async ({ page }) => {
  await page.goto(`/route/${KMB_1}`);
  await expect(stopRows(page).first()).toBeVisible({ timeout: 10_000 });

  const row = stopRows(page).nth(3);
  await expect(row).toHaveAttribute("aria-expanded", "false");
  await row.click();

  await expect(row).toHaveAttribute("aria-expanded", "true");
  // The row keeps the next bus; the ones after it live in the panel it opens,
  // under a label that says they come after it, each with the clock time it
  // lands at - a wait that long is only worth reading against a watch.
  const later = page.locator('[data-open="true"]').getByLabel(/分鐘 \d\d:\d\d$/);
  await expect(later.first()).toBeVisible({ timeout: 10_000 });
});

test("closing a stop puts its later departures away again", async ({ page }) => {
  await page.goto(`/route/${KMB_1}`);
  const row = stopRows(page).nth(3);
  await expect(row).toBeVisible({ timeout: 10_000 });

  await row.click();
  await expect(row).toHaveAttribute("aria-expanded", "true");
  await row.click();
  await expect(row).toHaveAttribute("aria-expanded", "false");
  // The panel stays mounted so the collapse can animate, so "away" has to mean
  // out of reach, not merely out of the layout.
  await expect(page.locator('[data-open="true"]')).toHaveCount(0);
});

test("survives a basemap that will not load", async ({ page }) => {
  // Tiles are blocked by the mock; the page must still be fully usable and
  // must not leave a blank rectangle where the map would be.
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));

  await page.goto(`/route/${KMB_1}`);
  await expect(page.getByText("往 尖沙咀碼頭").first()).toBeVisible({ timeout: 10_000 });
  // The stop list is what matters, and it must be there without a map.
  expect(await stopRows(page).count()).toBeGreaterThan(0);

  expect(errors).toEqual([]);
});

test("pinning a stop puts it on the saved screen", async ({ page }) => {
  await page.goto(`/route/${KMB_1}`);
  await expect(stopRows(page).first()).toBeVisible({ timeout: 10_000 });

  await stopRows(page).nth(2).click();
  const pin = page.locator('[data-open="true"]').getByRole("button", { name: "pin" });
  await expect(pin).toHaveAttribute("aria-pressed", "false");
  await pin.click();

  // The bookmark is made by the sheet that asks which group it joins.
  await page
    .getByRole("dialog", { name: "分組" })
    .getByRole("button", { name: "加入收藏" })
    .click();
  await expect(pin).toHaveAttribute("aria-pressed", "true");

  await page.goto("/saved");
  await expect(page.getByText("往 尖沙咀碼頭").first()).toBeVisible({ timeout: 10_000 });
});

test("an open stop links through to its own page", async ({ page }) => {
  await page.goto(`/route/${KMB_1}`);
  await expect(stopRows(page).first()).toBeVisible({ timeout: 10_000 });

  await stopRows(page).nth(2).click();
  // Every row carries its own panel so the collapse can animate both ways, so
  // the link has to be taken from the row that is actually open.
  await page.locator('[data-open="true"] a[href^="/stop/"]').first().click();

  await expect(page).toHaveURL(/\/stop\//);
  await expect(page.getByText("途經路線", { exact: false })).toBeVisible({ timeout: 10_000 });
});

test("the tab you came from stays lit on a route page", async ({ page }) => {
  await page.goto("/search");
  await page.getByRole("button", { name: "1", exact: true }).click();
  await page.locator('a[href^="/route/"]').first().click();
  await expect(page).toHaveURL(/\/route\//);
  // Wait for the page to actually be there, as a person would: the router
  // re-asserts the URL when a pending lazy navigation settles.
  await expect(page.getByText("往 尖沙咀碼頭").first()).toBeVisible({ timeout: 10_000 });

  // A route is not a tab, so nothing in the bar would light up on its own; it
  // belongs to whichever tab you reached it from.
  const tabs = page.getByRole("navigation", { name: "導覽" });
  await expect(tabs.getByRole("link", { name: "搜尋" })).toHaveAttribute("aria-current", "page");
});

test("the tab bar stays reachable from a route page", async ({ page }) => {
  await page.goto(`/route/${KMB_1}`);
  await expect(page.getByText("往 尖沙咀碼頭").first()).toBeVisible({ timeout: 10_000 });

  await page.getByRole("link", { name: "搜尋" }).click();
  await expect(page).toHaveURL(/\/search/);
});

test("a stop opened from a route says which route it came through", async ({ page }) => {
  await page.goto("/search");
  await page.getByRole("button", { name: "1", exact: true }).click();
  await page.locator('a[href^="/route/"]').first().click();
  await expect(page.getByText("往 尖沙咀碼頭").first()).toBeVisible({ timeout: 10_000 });

  await stopRows(page).nth(2).click();
  await page.locator('[data-open="true"] a[href^="/stop/"]').first().click();
  await expect(page).toHaveURL(/\/stop\//);

  // The whole way back, not just the tab: a stop reached through a route is a
  // different place from one opened straight off the nearby list.
  const crumbs = page.getByRole("navigation", { name: "breadcrumb" });
  await expect(crumbs.getByText("搜尋")).toBeVisible({ timeout: 10_000 });
  await expect(crumbs.getByText("路線 1")).toBeVisible();

  await crumbs.getByText("路線 1").click();
  await expect(page).toHaveURL(/\/route\//);
});

test("the timetable opens as a dialog and closes with Escape", async ({ page }) => {
  await page.goto(`/route/${KMB_1}`);
  await expect(page.getByText("往 尖沙咀碼頭").first()).toBeVisible({ timeout: 10_000 });

  const timetable = page.getByRole("dialog");
  // Mounted the whole time so the close can animate, so "shut" has to mean out
  // of reach rather than merely invisible.
  await expect(timetable).toBeHidden();

  await page.getByRole("button", { name: "路線資料" }).click();
  await expect(timetable).toBeVisible();
  await expect(timetable.getByText("星期一至五")).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(timetable).toBeHidden();
});

test("a closed dialog and a left screen both give the page its scroll back", async ({ page }) => {
  await page.goto(`/route/${KMB_1}`);
  await expect(page.getByText("往 尖沙咀碼頭").first()).toBeVisible({ timeout: 10_000 });

  // The sheet pins the body while it is up. Every cleanup in the app used to
  // be registered from inside an effect callback, where Solid 2 gives it no
  // owner and never runs it - so the body stayed pinned and a phone could not
  // scroll anything after its first sheet.
  await page.getByRole("button", { name: "路線資料" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.body.style.position)).toBe("fixed");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect.poll(() => page.evaluate(() => document.body.style.position)).toBe("");

  // A split screen pins the root the same way, for as long as it is up.
  await expect
    .poll(() => page.evaluate(() => document.documentElement.classList.contains("app-fill")))
    .toBe(true);
  await page.getByRole("navigation", { name: "導覽" }).getByRole("link", { name: "主頁" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect
    .poll(() => page.evaluate(() => document.documentElement.classList.contains("app-fill")))
    .toBe(false);
});

test("the nearest stop is named, and jumps to itself", async ({ page, context }) => {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: 22.3396, longitude: 114.1949 });
  await page.goto(`/route/${KMB_1}`);

  // "You are here" answered nothing on a page that is a whole route; the chip
  // has to say which stop it means.
  const nearest = page.getByRole("button", { name: /最近車站/ });
  await expect(nearest).toBeVisible({ timeout: 15_000 });
  await expect(nearest).toContainText("步行");

  await nearest.click();
  await expect(page.locator('[data-open="true"]')).toHaveCount(1);
});

/**
 * The map answers "where is it" in metres; the list answers it in stops, which
 * is the unit a rider standing at a kerb can check against the road in front of
 * them - and the only one available to someone who never opens the map.
 */
test("says how far up the road the bus still is", async ({ page }) => {
  await mockRunningBuses(page);
  await page.goto(`/route/${KMB_1}`);

  // The page opens the stop the rider is standing at, which is the stop the
  // question is about.
  const open = page.locator('[data-open="true"]');
  await expect(open).toHaveCount(1, { timeout: 15_000 });
  await expect(open.getByText(/架車/)).toBeVisible({ timeout: 15_000 });
});

/**
 * The note that teaches the tap is closeable, and closing it is kept: a note
 * that comes back on the next visit is not closeable, it is nagging.
 */
test("the tap-for-departures note can be closed for good", async ({ page }) => {
  await page.goto("/route/1%2B1%2BCHUK%20YUEN%20ESTATE%2BSTAR%20FERRY");
  const note = page.getByRole("status").filter({ hasText: "撳車站睇埋之後嘅班次" });
  await expect(note).toBeVisible({ timeout: 15_000 });

  await note.getByRole("button", { name: "關閉" }).click();
  await expect(note).toBeHidden();

  await page.reload();
  await expect(page.locator("[data-stop-seq]").first()).toBeVisible({ timeout: 15_000 });
  await expect(note).toBeHidden();
});

/**
 * The opened-out map is a place the rider is in, so it is in the URL: the
 * back button is the way out of it, and a reload lands back in it.
 */
test("the opened-out map is a place the back button leaves", async ({ page }) => {
  await mockTransit(page);
  await page.goto(`/route/${KMB_1}`);
  const expand = page.getByRole("button", { name: "放大地圖" });
  const degraded = page.getByText("呢部機顯示唔到地圖");
  await expect
    .poll(async () => (await expand.count()) > 0 || (await degraded.count()) > 0, {
      timeout: 20_000,
    })
    .toBe(true);
  if (!(await expand.count())) return;

  await expand.click();
  await expect(page).toHaveURL(/map=true/);
  await expect(page.getByRole("button", { name: "關閉地圖" })).toBeVisible();

  await page.goBack();
  await expect(page).not.toHaveURL(/map=true/);
  await expect(page.getByRole("button", { name: "放大地圖" })).toBeVisible();
});
