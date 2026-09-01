import { expect, test } from "@playwright/test";

// This file is about the service worker, so here it is allowed to run.
test.use({ serviceWorkers: "allow" });
import { mockTransit } from "./support/mock";

test("ships an installable manifest", async ({ page, request }) => {
  await page.goto("/");

  const href = await page.locator('link[rel="manifest"]').getAttribute("href");
  expect(href).toBe("/manifest.webmanifest");

  const manifest = await (await request.get(href as string)).json();
  expect(manifest.name).toContain("ProBus HK");
  expect(manifest.display).toBe("standalone");
  expect(manifest.start_url).toBe("/");
  // A maskable icon is what stops Android cropping the logo into a circle.
  expect(manifest.icons.some((i: { purpose?: string }) => i.purpose === "maskable")).toBe(true);
  expect(manifest.icons.some((i: { sizes?: string }) => i.sizes === "512x512")).toBe(true);

  // Every icon the manifest promises has to actually be there - a 404 here
  // shows up as a blank tile on someone's home screen and nowhere else.
  for (const icon of manifest.icons as { src: string }[]) {
    expect((await request.get(icon.src)).status(), icon.src).toBe(200);
  }
  expect((await request.get("/icons/apple-touch-icon.png")).status()).toBe(200);
});

test("locks viewport scale on mobile and PWA", async ({ page }) => {
  await page.goto("/");
  const viewport = await page.locator('meta[name="viewport"]').getAttribute("content");
  expect(viewport).toContain("maximum-scale=1");
});

test("declares a theme colour for both light and dark", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator('meta[name="theme-color"][media*="dark"]')).toHaveCount(1);
  await expect(page.locator('meta[name="theme-color"][media*="light"]')).toHaveCount(1);
});

test("registers a service worker", async ({ page }) => {
  await mockTransit(page);
  await page.goto("/");

  const registered = await page.waitForFunction(
    () => navigator.serviceWorker.getRegistration().then((r) => !!r),
    undefined,
    { timeout: 20_000 },
  );
  expect(await registered.jsonValue()).toBe(true);
});

test("still opens when the network is gone", async ({ page, context }) => {
  await mockTransit(page);
  await page.goto("/");
  // Let the worker take control and precache the shell.
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, {
    timeout: 20_000,
  });

  await context.setOffline(true);
  await page.reload();

  // The shell must render offline; the route database comes from IndexedDB.
  await expect(page.locator("#root")).not.toBeEmpty({ timeout: 20_000 });
  await context.setOffline(false);
});
