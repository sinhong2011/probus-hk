import { defineConfig, devices } from "@playwright/test";

/**
 * The app is mobile-first, so the default project is a phone-sized Chromium.
 * Hong Kong geolocation and timezone are set globally: nearly every screen
 * depends on where you are, and the timetable maths depends on the clock.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : [["list"]],

  use: {
    baseURL: "http://localhost:4173",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    locale: "zh-HK",
    timezoneId: "Asia/Hong_Kong",
    // Public Square Street on Nathan Road - a busy stop in the test fixture.
    geolocation: { latitude: 22.31073, longitude: 114.17099 },
    permissions: ["geolocation"],
  },

  projects: [
    {
      name: "phone",
      testIgnore: "**/dev.spec.ts",
      use: {
        ...devices["Pixel 7"],
        browserName: "chromium",
        viewport: { width: 390, height: 844 },
      },
    },
    {
      /**
       * The same app served by the dev server, where Solid's assertions are
       * still compiled in. Production strips them, so without this project a
       * reactivity mistake can crash `vp dev` while every other test passes.
       */
      name: "dev",
      testMatch: "**/dev.spec.ts",
      use: {
        ...devices["Pixel 7"],
        browserName: "chromium",
        viewport: { width: 390, height: 844 },
        baseURL: "http://localhost:5174",
      },
    },
  ],

  webServer: [
    {
      command: "./node_modules/.bin/vp preview --port 4173",
      url: "http://localhost:4173",
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: "./node_modules/.bin/vp dev --port 5174",
      url: "http://localhost:5174",
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});
