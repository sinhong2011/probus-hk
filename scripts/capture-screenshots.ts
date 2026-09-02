/**
 * Captures marketing screenshots for the README showcase.
 *
 * Runs against the production build with the same transit stubs the e2e suite
 * uses, so arrival times stay stable between runs.
 */
import { spawn } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Page } from "@playwright/test";
import { mockTransit } from "../tests/e2e/support/mock";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "docs", "screenshots");
const BASE = "http://localhost:4173";
const KMB_1 = encodeURIComponent("1+1+CHUK YUEN ESTATE+STAR FERRY");
const WEDNESDAY_MORNING = new Date("2026-03-04T02:00:00Z");

const VIEWPORTS = {
  mobile: { width: 390, height: 844 },
  desktop: { width: 1280, height: 800 },
} as const;

interface Shot {
  id: string;
  path: string;
  title: string;
  ready: string;
  before?: (page: Page) => Promise<void>;
  setup?: (page: Page) => Promise<void>;
}

const SHOTS: Shot[] = [
  {
    id: "nearby",
    path: "/",
    title: "Nearby arrivals",
    ready: 'a[href^="/stop/"]',
  },
  {
    id: "route",
    path: `/route/${KMB_1}`,
    title: "Route detail",
    ready: "text=往 尖沙咀碼頭",
  },
  {
    id: "plan",
    path: "/plan",
    title: "Journey planner",
    ready: "text=全程大約",
    async before(page) {
      await page.clock.install({ time: WEDNESDAY_MORNING });
    },
    async setup(page) {
      const destination = page.getByLabel("目的地");
      await destination.click();
      await destination.fill("尖沙咀");
      await page.locator('button:has-text("尖沙咀")').first().click();
    },
  },
  {
    id: "rail",
    path: "/rail",
    title: "MTR lines",
    ready: "text=荃灣綫",
  },
  {
    id: "search",
    path: "/search",
    title: "Search",
    ready: 'a[href^="/route/"]',
  },
];

async function waitForScreen(page: Page, shot: Shot) {
  if (shot.before) await shot.before(page);
  await page.goto(`${BASE}${shot.path}`);
  if (shot.setup) await shot.setup(page);
  await page.locator(shot.ready).first().waitFor({ timeout: 20_000 });
  await page.waitForTimeout(500);
}

async function capture(page: Page, shot: Shot, variant: keyof typeof VIEWPORTS) {
  const viewport = VIEWPORTS[variant];
  await page.setViewportSize(viewport);
  await waitForScreen(page, shot);
  const file = join(OUT, `${shot.id}-${variant}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

function showcaseHtml(files: Record<string, { mobile: string; desktop: string }>) {
  const cards = SHOTS.map((shot) => {
    const pair = files[shot.id];
    return `
      <article class="card">
        <h2>${shot.title}</h2>
        <div class="pair">
          <figure class="device desktop">
            <div class="chrome">
              <span></span><span></span><span></span>
            </div>
            <img src="data:image/png;base64,${pair.desktop}" alt="${shot.title} on desktop" />
          </figure>
          <figure class="device phone">
            <div class="island"></div>
            <img src="data:image/png;base64,${pair.mobile}" alt="${shot.title} on mobile" />
          </figure>
        </div>
      </article>`;
  }).join("");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: "Geist Variable", "Segoe UI", system-ui, sans-serif;
      background:
        radial-gradient(1200px 600px at 10% -10%, oklch(0.92 0.04 277), transparent 60%),
        radial-gradient(900px 500px at 90% 0%, oklch(0.94 0.03 62), transparent 55%),
        oklch(0.97 0.003 15);
      color: oklch(0.2 0.01 285);
      padding: 56px 48px 72px;
    }
    header {
      max-width: 1120px;
      margin: 0 auto 40px;
      text-align: center;
    }
    header h1 {
      font-size: 2.4rem;
      font-weight: 800;
      letter-spacing: -0.03em;
      margin-bottom: 10px;
    }
    header p {
      font-size: 1.05rem;
      color: oklch(0.45 0.02 285);
      max-width: 42rem;
      margin: 0 auto;
      line-height: 1.55;
    }
    .grid {
      max-width: 1120px;
      margin: 0 auto;
      display: grid;
      gap: 28px;
    }
    .card {
      background: oklch(1 0 0 / 0.72);
      border: 1px solid oklch(0.9 0.01 285);
      border-radius: 24px;
      padding: 24px 24px 28px;
      box-shadow: 0 24px 60px oklch(0.2 0.02 285 / 0.08);
      backdrop-filter: blur(12px);
    }
    .card h2 {
      font-size: 0.92rem;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: oklch(0.48 0.03 277);
      margin-bottom: 18px;
    }
    .pair {
      display: grid;
      grid-template-columns: minmax(0, 1.45fr) minmax(0, 0.55fr);
      gap: 22px;
      align-items: end;
    }
    .device {
      position: relative;
      overflow: hidden;
      background: oklch(0.16 0.01 285);
      box-shadow: 0 18px 40px oklch(0.15 0.02 285 / 0.22);
    }
    .desktop {
      border-radius: 16px;
      border: 1px solid oklch(0.25 0.01 285);
    }
    .desktop .chrome {
      display: flex;
      gap: 7px;
      padding: 12px 14px;
      background: oklch(0.2 0.01 285);
      border-bottom: 1px solid oklch(0.28 0.01 285);
    }
    .desktop .chrome span {
      width: 11px;
      height: 11px;
      border-radius: 999px;
      background: oklch(0.35 0.02 285);
    }
    .desktop img { width: 100%; display: block; }
    .phone {
      width: min(100%, 220px);
      margin-inline: auto;
      border-radius: 28px;
      border: 3px solid oklch(0.24 0.01 285);
      padding: 10px 8px 12px;
    }
    .phone .island {
      width: 72px;
      height: 18px;
      margin: 0 auto 8px;
      border-radius: 999px;
      background: oklch(0.12 0.01 285);
    }
    .phone img {
      width: 100%;
      display: block;
      border-radius: 18px;
    }
  </style>
</head>
<body>
  <header>
    <h1>ProBus HK</h1>
    <p>Real-time Hong Kong arrivals on every screen — phone-first, desktop-ready, ad-free.</p>
  </header>
  <div class="grid">${cards}</div>
</body>
</html>`;
}

async function waitForServer(url: string, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Server not ready yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`preview server did not start at ${url}`);
}

function startPreview() {
  const child = spawn("./node_modules/.bin/vp", ["preview", "--port", "4173"], {
    cwd: ROOT,
    stdio: "ignore",
  });
  return child;
}

async function main() {
  await mkdir(OUT, { recursive: true });

  const preview = startPreview();
  try {
    await waitForServer(BASE);

    const browser = await chromium.launch();
    const context = await browser.newContext({
      locale: "zh-HK",
      timezoneId: "Asia/Hong_Kong",
      geolocation: { latitude: 22.31073, longitude: 114.17099 },
      permissions: ["geolocation"],
      serviceWorkers: "block",
    });
    const page = await context.newPage();
    await mockTransit(page);

    const encoded: Record<string, { mobile: string; desktop: string }> = {};

    for (const shot of SHOTS) {
      const mobilePath = await capture(page, shot, "mobile");
      const desktopPath = await capture(page, shot, "desktop");
      encoded[shot.id] = {
        mobile: (await readFile(mobilePath)).toString("base64"),
        desktop: (await readFile(desktopPath)).toString("base64"),
      };
      console.log(`captured ${shot.id}`);
    }

    const showcasePage = await context.newPage();
    await showcasePage.setViewportSize({ width: 1280, height: 720 });
    await showcasePage.setContent(showcaseHtml(encoded), { waitUntil: "load" });
    await showcasePage.locator("header h1").waitFor();
    await showcasePage.screenshot({
      path: join(OUT, "showcase.png"),
      fullPage: true,
    });
    console.log("wrote showcase.png");

    const heroPage = await context.newPage();
    await heroPage.setViewportSize({ width: 1400, height: 720 });
    await heroPage.setContent(
      `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      min-height: 100vh;
      display: grid;
      place-items: center;
      font-family: "Segoe UI", system-ui, sans-serif;
      background:
        radial-gradient(900px 500px at 15% 0%, oklch(0.9 0.05 277), transparent 55%),
        radial-gradient(700px 420px at 85% 10%, oklch(0.93 0.04 62), transparent 50%),
        oklch(0.975 0.003 15);
      padding: 48px;
    }
    .stage {
      width: min(1180px, 100%);
      display: grid;
      grid-template-columns: minmax(0, 1.2fr) minmax(0, 0.42fr);
      gap: 36px;
      align-items: end;
    }
    .copy h1 {
      font-size: clamp(2rem, 4vw, 2.8rem);
      font-weight: 800;
      letter-spacing: -0.03em;
      margin-bottom: 12px;
      color: oklch(0.18 0.01 285);
    }
    .copy p {
      font-size: 1.05rem;
      line-height: 1.6;
      color: oklch(0.45 0.02 285);
      max-width: 34rem;
      margin-bottom: 28px;
    }
    .badges {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
    }
    .badge {
      font-size: 0.78rem;
      font-weight: 700;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      padding: 8px 12px;
      border-radius: 999px;
      background: oklch(1 0 0 / 0.72);
      border: 1px solid oklch(0.9 0.01 285);
      color: oklch(0.42 0.03 277);
    }
    .desktop, .phone {
      overflow: hidden;
      background: oklch(0.16 0.01 285);
      box-shadow: 0 28px 60px oklch(0.15 0.02 285 / 0.22);
    }
    .desktop {
      border-radius: 18px;
      border: 1px solid oklch(0.25 0.01 285);
    }
    .desktop .chrome {
      display: flex;
      gap: 7px;
      padding: 12px 14px;
      background: oklch(0.2 0.01 285);
      border-bottom: 1px solid oklch(0.28 0.01 285);
    }
    .desktop .chrome span {
      width: 11px;
      height: 11px;
      border-radius: 999px;
      background: oklch(0.35 0.02 285);
    }
    .desktop img { width: 100%; display: block; }
    .phone {
      width: min(100%, 250px);
      margin-inline: auto;
      border-radius: 30px;
      border: 3px solid oklch(0.24 0.01 285);
      padding: 10px 8px 12px;
    }
    .phone .island {
      width: 76px;
      height: 18px;
      margin: 0 auto 8px;
      border-radius: 999px;
      background: oklch(0.12 0.01 285);
    }
    .phone img {
      width: 100%;
      display: block;
      border-radius: 20px;
    }
    .devices {
      display: grid;
      gap: 18px;
      align-content: end;
    }
  </style>
</head>
<body>
  <div class="stage">
    <div class="copy">
      <h1>Real-time Hong Kong arrivals</h1>
      <p>Ad-free ETAs for buses, minibuses, MTR, light rail and ferries — phone-first, desktop-ready, offline-capable.</p>
      <div class="badges">
        <span class="badge">No account</span>
        <span class="badge">No tracking</span>
        <span class="badge">PWA</span>
        <span class="badge">Bilingual</span>
      </div>
    </div>
    <div class="devices">
      <figure class="desktop">
        <div class="chrome"><span></span><span></span><span></span></div>
        <img src="data:image/png;base64,${encoded.nearby.desktop}" alt="Nearby on desktop" />
      </figure>
      <figure class="phone">
        <div class="island"></div>
        <img src="data:image/png;base64,${encoded.nearby.mobile}" alt="Nearby on mobile" />
      </figure>
    </div>
  </div>
</body>
</html>`,
      { waitUntil: "load" },
    );
    await heroPage.screenshot({ path: join(OUT, "hero.png") });
    console.log("wrote hero.png");

    await browser.close();
  } finally {
    preview.kill("SIGTERM");
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
