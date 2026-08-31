/**
 * Where the map's names land, and which of them collide, at a given zoom.
 *
 * The placer in `railLayout` is a handful of weights - what a graze costs,
 * what a diagonal costs, what sitting on a line costs - and the only way to
 * tune a weight honestly is to see every name it moves. This prints the
 * pairs of names that overlap at a zoom, and for any station named, every
 * placement it considered and why each cost what it did.
 *
 *   bun run raillabels [pixels-per-square] [STATION,STATION,...]
 *
 * `DB_FILE=path` reads a saved route database instead of fetching it.
 */
import { readFileSync } from "node:fs";
import {
  EVERY_NAME_FROM,
  placeLabels,
  PLACEMENTS,
  type Box,
  type Placement,
} from "~/data/railLayout";

const DB_URL = "https://data.hkbus.app/routeFareList.min.json";
const db = process.env.DB_FILE
  ? JSON.parse(readFileSync(process.env.DB_FILE, "utf8"))
  : await (await fetch(DB_URL)).json();
const name = (id: string) => (db.stopList[id]?.name.zh ?? id).replace(/\s*\(.*\)\s*$/, "");
const other = (id: string) => db.stopList[id]?.name.en ?? id;
const scale = Number(process.argv[2] ?? 11.39);
const watch = new Set((process.argv[3] ?? "").split(",").filter(Boolean));
const NAMES = ["E", "W", "NE", "NW", "SE", "SW", "N", "S"];
const dir = (p: Placement) => NAMES[PLACEMENTS.indexOf(p)];

const boxes = new Map<string, Box>();
const chosen = placeLabels({
  scale,
  name,
  other,
  bilingual: scale >= 24,
  minorShown: scale >= EVERY_NAME_FROM,
  tramShown: scale >= 36,
  tramBilingual: scale >= 72,
  trace: (id, p, cost, why) => {
    if (watch.has(id))
      console.log(`  ${id} ${dir(p)!.padEnd(2)} ${cost.toFixed(2)}  ${why.join(", ")}`);
  },
  placed: (id, _p, box) => boxes.set(id, box),
});
for (const id of watch) console.log(`${id} -> ${dir(chosen.get(id)!)}`);

const overlap = (a: Box, b: Box) => {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w <= 0 || h <= 0 ? 0 : (w * h) / Math.min(a.w * a.h, b.w * b.h);
};
const ids = [...boxes.keys()];
const bad: string[] = [];
for (let i = 0; i < ids.length; i++)
  for (let j = i + 1; j < ids.length; j++) {
    const f = overlap(boxes.get(ids[i]!)!, boxes.get(ids[j]!)!);
    if (f > 0.05)
      bad.push(
        `${ids[i]}(${dir(chosen.get(ids[i]!)!)}) x ${ids[j]}(${dir(chosen.get(ids[j]!)!)}) ${(f * 100).toFixed(0)}%`,
      );
  }
console.log(`scale ${scale}: ${ids.length} names, ${bad.length} overlapping pairs`);
for (const line of bad) console.log("  " + line);
