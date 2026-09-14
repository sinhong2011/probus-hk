import { expect, test } from "@playwright/test";
import { mockTransit } from "./support/mock";

test.beforeEach(async ({ page }) => {
  await mockTransit(page);
  await page.goto("/settings");
});

test("switches the whole interface to English and back", async ({ page }) => {
  await expect(page.getByRole("heading", { name: "設定" })).toBeVisible({ timeout: 10_000 });

  await page.getByRole("radio", { name: "EN" }).click();
  await expect(page.getByRole("radio", { name: "EN" })).toHaveAttribute("aria-checked", "true");
  // The tab bar is the quickest proof the change reached the whole shell.
  await expect(page.getByText("Home").first()).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");

  await page.getByRole("radio", { name: "繁中" }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-HK");
});

test("theme choice reaches the document and persists", async ({ page }) => {
  await page.getByRole("radio", { name: "深色" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  await page.getByRole("radio", { name: "淺色" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");

  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light", { timeout: 10_000 });
});

test("auto theme defers to the system rather than forcing one", async ({ page }) => {
  await page.getByRole("radio", { name: "深色" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  await page.getByRole("radio", { name: "自動" }).click();
  await expect(page.locator("html")).not.toHaveAttribute("data-theme", "dark");
});

test("updating the route database keeps the settings sheet open", async ({ page }) => {
  await expect(page.getByRole("heading", { name: "設定" })).toBeVisible({ timeout: 10_000 });

  let reloaded = false;
  page.once("load", () => {
    reloaded = true;
  });

  await page.getByRole("button", { name: "即刻更新" }).click();
  await expect(page.getByText("路線資料已經更新咗")).toBeVisible({ timeout: 10_000 });

  // The sheet is still the same panel, not a leftover from after a reload.
  await expect(page.getByRole("heading", { name: "設定" })).toBeVisible();
  await expect(page.getByText("載緊路線資料")).toHaveCount(0);
  expect(reloaded).toBe(false);

  await page.getByRole("radio", { name: "EN" }).click();
  await expect(page.getByRole("radio", { name: "EN" })).toHaveAttribute("aria-checked", "true");
});

test("reports what is stored for offline use", async ({ page }) => {
  await expect(page.getByText("路線資料庫")).toBeVisible({ timeout: 10_000 });
  // The fixture holds 6 routes; the count must come from the data, not a guess.
  await expect(page.getByText(/\d+\s*(條路線|routes)/)).toBeVisible();
  await expect(page.getByText("已下載 · 存喺部機度")).toBeVisible();
});

test("says what build this is, and links out to everything it reads", async ({ page }) => {
  // Release and commit together: a rider quoting only "0.1.0" cannot name the
  // code they are running, which is the whole point of stamping it.
  await expect(page.getByText(/^\d+\.\d+\.\d+ · \S+$/)).toBeVisible({ timeout: 10_000 });

  await expect(page.getByRole("link", { name: /原始碼/ })).toHaveAttribute(
    "href",
    "https://github.com/sinhong2011/probus-hk",
  );

  // Every feed the app reads is named and reachable, not printed as text.
  for (const source of ["實時到站", "路線同車費", "交通消息", "地圖", "圖示"]) {
    const row = page.getByRole("link", { name: new RegExp(source) });
    await expect(row).toHaveAttribute("target", "_blank");
    await expect(row).toHaveAttribute("href", /^https:\/\//);
  }
});

test("refresh interval is a real choice that sticks", async ({ page }) => {
  await page.getByRole("radio", { name: "10s" }).click();
  await expect(page.getByRole("radio", { name: "10s" })).toHaveAttribute("aria-checked", "true");

  await page.goto("/settings");
  await expect(page.getByRole("radio", { name: "10s" })).toHaveAttribute("aria-checked", "true", {
    timeout: 10_000,
  });
});

test("a change in one tab reaches the others", async ({ context, page }) => {
  await mockTransit(page);
  await page.goto("/settings");
  await expect(page.getByRole("radio", { name: "繁中" })).toHaveAttribute("aria-checked", "true", {
    timeout: 10_000,
  });

  // A second tab of the same app, as a person on a desktop actually has.
  const other = await context.newPage();
  await mockTransit(other);
  await other.goto("/settings");
  await other.getByRole("radio", { name: "EN" }).click();

  // Storage events only fire in the *other* tabs, which is exactly the case a
  // load-once store never handled: the first tab used to sit on stale settings
  // until it was reloaded.
  await expect(page.getByRole("radio", { name: "EN" })).toHaveAttribute("aria-checked", "true", {
    timeout: 10_000,
  });
  await other.close();
});

test("remote sync opens WebDAV and S3 fields from settings", async ({ page }) => {
  await expect(page.getByRole("heading", { name: "設定" })).toBeVisible({ timeout: 10_000 });
  await page.getByRole("button", { name: /遠端同步/ }).click();
  await expect(page.getByRole("heading", { name: "遠端同步" })).toBeVisible();

  await page.getByRole("radio", { name: "WebDAV" }).click();
  await expect(page.getByText("資料夾網址", { exact: true })).toBeVisible();
  await expect(page.getByText("遠端資料夾（選填）", { exact: true })).toBeVisible();

  await page.getByRole("radio", { name: "S3" }).click();
  await expect(page.getByText("Endpoint", { exact: true })).toBeVisible();
  await expect(page.getByText("Bucket", { exact: true })).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(page.getByRole("heading", { name: "遠端同步" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "設定" })).toBeVisible();

  await page.getByRole("button", { name: /遠端同步/ }).click();
  await expect(page.getByRole("heading", { name: "遠端同步" })).toBeVisible();
  await page
    .locator("[data-drawer-overlay]")
    .last()
    .click({ position: { x: 8, y: 8 } });
  await expect(page.getByRole("heading", { name: "遠端同步" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "設定" })).toBeVisible();
});

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, PUT, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "*",
};

test("remote sync uploads and downloads a WebDAV backup without storing the password in it", async ({
  page,
}) => {
  let uploaded: string | undefined;
  let uploadedUrl: string | undefined;
  await page.route("https://dav.test/**", async (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") {
      await route.fulfill({ status: 204, headers: cors, body: "" });
      return;
    }
    if (request.method() === "PUT") {
      uploadedUrl = request.url();
      uploaded = request.postData() ?? "";
      await route.fulfill({ status: 201, headers: cors, body: "" });
      return;
    }
    await route.fulfill({
      status: uploaded ? 200 : 404,
      headers: { ...cors, "Content-Type": "application/json" },
      body: uploaded ?? "",
    });
  });

  await page.getByRole("button", { name: /遠端同步/ }).click();
  await page.getByRole("radio", { name: "WebDAV" }).click();
  await page.getByLabel("資料夾網址").fill("https://dav.test/files/custom.json");
  await page.getByLabel("遠端資料夾（選填）").fill("Probus");
  await page.getByLabel("用戶名稱").fill("you");
  const password = page.locator("#webdav-password");
  await password.fill("hunter2");
  await expect(password).toHaveAttribute("type", "password");
  await password.locator("xpath=..").getByRole("button").click();
  await expect(password).toHaveAttribute("type", "text");
  await expect(password).toHaveValue("hunter2");

  await page.getByRole("button", { name: "上傳" }).click();
  await expect(page.getByText("已經上傳咗")).toBeVisible({ timeout: 10_000 });
  expect(uploadedUrl).toBe("https://dav.test/files/Probus/probus-backup.json");
  expect(uploaded).toContain('"version":1');
  expect(uploaded).not.toContain("hunter2");

  await page.getByRole("button", { name: "下載" }).click();
  await expect(page.getByText("已經合併咗遠端備份")).toBeVisible({ timeout: 10_000 });
});

test("auto sync uploads when it is turned on and names itself on the settings row", async ({
  page,
}) => {
  let uploaded: string | undefined;
  await page.route("https://dav.test/**", async (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") {
      await route.fulfill({ status: 204, headers: cors, body: "" });
      return;
    }
    if (request.method() === "PUT") {
      uploaded = request.postData() ?? "";
      await route.fulfill({ status: 201, headers: cors, body: "" });
      return;
    }
    await route.fulfill({
      status: uploaded ? 200 : 404,
      headers: { ...cors, "Content-Type": "application/json" },
      body: uploaded ?? "",
    });
  });

  await page.getByRole("button", { name: /遠端同步/ }).click();
  await page.getByRole("radio", { name: "WebDAV" }).click();
  await page.getByLabel("資料夾網址").fill("https://dav.test/files/");
  await page.locator("#webdav-password").fill("secret");
  await page.getByRole("switch", { name: "自動同步" }).click();
  await expect.poll(() => uploaded, { timeout: 10_000 }).toBeTruthy();
  expect(uploaded).toContain('"version":1');
  expect(uploaded).not.toContain("secret");
  await expect(page.getByText("仲未同步過")).toHaveCount(0);

  await page.keyboard.press("Escape");
  await expect(page.getByRole("heading", { name: "設定" })).toBeVisible();
  await expect(page.getByRole("button", { name: /遠端同步/ })).toContainText("自動");
});

test("remote sync remembers S3 endpoint fields after a reload", async ({ page }) => {
  await page.getByRole("button", { name: /遠端同步/ }).click();
  await page.getByRole("radio", { name: "S3" }).click();
  await page.getByLabel("Endpoint").fill("https://s3.test");
  await page.getByLabel("Bucket").fill("rides");
  await page.getByLabel("Access key").fill("AKIAEXAMPLE");

  await expect
    .poll(async () => page.evaluate(() => localStorage.getItem("probus:db:sync") ?? ""))
    .toContain("s3.test");

  // `/settings` opens the drawer then redirects home, so a reload lands on
  // nearby. Opening the address again is what a shared link would do too.
  await page.reload();
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "設定" })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole("button", { name: /遠端同步/ })).toContainText("S3");

  await page.getByRole("button", { name: /遠端同步/ }).click();
  await expect(page.getByLabel("Endpoint")).toHaveValue("https://s3.test");
  await expect(page.getByLabel("Bucket")).toHaveValue("rides");
  await expect(page.getByLabel("Access key")).toHaveValue("AKIAEXAMPLE");
});
