/**
 * Builds the Open Graph share image the app ships.
 *
 *   bun run og
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SRC = `${ROOT}/scripts/assets/og-source.jpg`;
const OUT = `${ROOT}/public/og.png`;

const WIDTH = 1200;
const HEIGHT = 630;

function run(cmd: string, args: string[]) {
  const result = spawnSync(cmd, args, { stdio: "inherit" });
  if (result.status !== 0) {
    throw new Error(`${cmd} ${args.join(" ")} failed with ${result.status ?? "unknown"}`);
  }
}

if (!existsSync(SRC)) {
  throw new Error(`Missing ${SRC}. Add the master OG artwork there first.`);
}

run("magick", [
  SRC,
  "-resize",
  `${WIDTH}x${HEIGHT}^`,
  "-gravity",
  "center",
  "-extent",
  `${WIDTH}x${HEIGHT}`,
  "-strip",
  OUT,
]);

run("magick", ["identify", "-format", "%wx%h", OUT]);
console.log(`Wrote ${OUT} (${WIDTH}×${HEIGHT})`);
