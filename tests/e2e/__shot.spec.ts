import { test } from "@playwright/test";
import { mockTransit } from "./support/mock";

const OUT =
  "/private/tmp/claude-501/-Volumes-Pie-Sync-Workspace-dev-web-motherbus/bd510e9d-b9a5-4130-bee4-2ebde2296cf7/scratchpad";
const KMB_1 = encodeURIComponent("1+1+CHUK YUEN ESTATE+STAR FERRY");

const CASES = [
  { name: "dark", scheme: "dark" as const, width: 390, height: 1400 },
  { name: "light", scheme: "light" as const, width: 390, height: 1400 },
  { name: "wide", scheme: "dark" as const, width: 1440, height: 1200 },
];

for (const c of CASES) {
  test(`shot-${c.name}`, async ({ page }) => {
    await mockTransit(page);
    await page.setViewportSize({ width: c.width, height: c.height });
    await page.emulateMedia({ colorScheme: c.scheme });
    await page.goto(`/route/${KMB_1}`);
    const row = page.locator("button[aria-expanded]").nth(3);
    await row.click();
    await page.waitForTimeout(1500);
    const panel = page.locator("[data-stop-seq]:has(button[aria-expanded='true'])");
    await panel.screenshot({ path: `${OUT}/later-${c.name}.png` });
  });
}
