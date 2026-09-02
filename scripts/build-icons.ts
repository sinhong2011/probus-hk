/**
 * Builds PWA / favicon PNGs from the master app icon.
 *
 *   bun run icons
 */
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SRC = `${ROOT}/scripts/assets/app-icon.png`;
const OUT = `${ROOT}/public/icons`;

function run(args: string[]) {
  const result = spawnSync("magick", args, { stdio: "inherit" });
  if (result.status !== 0) {
    throw new Error(`magick ${args.join(" ")} failed with ${result.status ?? "unknown"}`);
  }
}

function resizeFrom512(size: number, name: string) {
  const dest = `${OUT}/${name}`;
  const result = spawnSync(
    "sips",
    ["-z", String(size), String(size), `${OUT}/icon-512.png`, "--out", dest],
    { stdio: "inherit" },
  );
  if (result.status !== 0) {
    throw new Error(`sips failed for ${name}`);
  }
}

if (!existsSync(SRC)) {
  throw new Error(`Missing ${SRC}. Add the master app icon there first.`);
}

/** Master art, trimmed and scaled — no tile composited on top. */
run([
  SRC,
  "-background",
  "none",
  "-alpha",
  "on",
  "-trim",
  "+repage",
  "-resize",
  "512x512",
  "-gravity",
  "center",
  "-extent",
  "512x512",
  "-strip",
  `${OUT}/icon-512.png`,
]);

copyFileSync(`${OUT}/icon-512.png`, `${OUT}/logo.png`);

resizeFrom512(192, "icon-192.png");
resizeFrom512(180, "apple-touch-icon.png");
copyFileSync(`${OUT}/icon-512.png`, `${OUT}/maskable-512.png`);

run([
  `${OUT}/icon-512.png`,
  "-define",
  "icon:auto-resize=48,32,16",
  `${ROOT}/public/favicon.ico`,
]);

const icon512 = readFileSync(`${OUT}/icon-512.png`);
const embedded = icon512.toString("base64");
writeFileSync(
  `${OUT}/icon.svg`,
  `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512" role="img" aria-label="ProBus HK">
  <image href="data:image/png;base64,${embedded}" width="512" height="512" />
</svg>`,
);
