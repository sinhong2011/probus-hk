/**
 * Builds the rail fare table the app ships.
 *
 * The route database the rest of the app runs on carries no rail fares at all -
 * every MTR route in it has `fares: null` - because a bus fare is one number
 * per boarding stop and a rail fare is a number per *pair* of stations. The
 * railway publishes those pairs itself, as two CSVs on its open-data site with
 * no CORS header, so they cannot be read from the browser: they are folded into
 * one compact JSON here and committed, and the app fetches that.
 *
 * Fares move about once a year. Run `bun run fares` when they do.
 *
 *   bun run fares
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** Line/station reference: maps the numeric ids the fare tables use to codes. */
const STATIONS = "https://opendata.mtr.com.hk/data/mtr_lines_and_stations.csv";
/** Every heavy-rail pair except the two Airport Express-only stations. */
const FARES = "https://opendata.mtr.com.hk/data/mtr_lines_fares.csv";
/** Airport Express, which prices its own trips and is not in the table above. */
const AEL_FARES = "https://opendata.mtr.com.hk/data/airport_express_fares.csv";

const OUT = fileURLToPath(new URL("../public/rail-fares.json", import.meta.url));

/** Minimal CSV reader: these three files are quoted-or-bare, no embedded newlines. */
function parseCsv(text: string): Record<string, string>[] {
  const lines = text.replace(/^﻿/, "").trim().split(/\r?\n/);
  const cell = (line: string) =>
    line.split(",").map((v) =>
      v
        .trim()
        .replace(/^"(.*)"$/, "$1")
        .trim(),
    );

  const header = cell(lines[0] ?? "");
  return lines.slice(1).map((line) => {
    const values = cell(line);
    return Object.fromEntries(header.map((name, i) => [name, values[i] ?? ""]));
  });
}

async function csv(url: string): Promise<Record<string, string>[]> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} answered ${res.status}`);
  return parseCsv(await res.text());
}

/** A published fare, or null where that railway does not publish that class. */
const money = (value: string | undefined): number | null => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
};

const stations = await csv(STATIONS);

/*
 * The app knows a station by the same three-letter code the railway prints on
 * its own maps ("MOK", "LCK"), which is also what the route database uses as a
 * stop id - so the table can be keyed by code and looked up with no mapping at
 * runtime. The fare CSVs use numeric ids instead; this is the join.
 */
const codeById = new Map<string, string>();
for (const row of stations) {
  const id = row["Station ID"];
  const code = row["Station Code"];
  if (id && code) codeById.set(id, code);
}

/** [Octopus adult, single journey, child, elderly, student]. */
type Fare = [number | null, number | null, number | null, number | null, number | null];

const fares = new Map<string, Fare>();

for (const row of await csv(FARES)) {
  const from = codeById.get(row["SRC_STATION_ID"] ?? "");
  const to = codeById.get(row["DEST_STATION_ID"] ?? "");
  // A station priced against itself is $0, and is not a trip anyone takes.
  if (!from || !to || from === to) continue;

  fares.set(from + to, [
    money(row["OCT_ADT_FARE"]),
    money(row["SINGLE_ADT_FARE"]),
    money(row["OCT_CON_CHILD_FARE"]),
    money(row["OCT_CON_ELDERLY_FARE"]),
    money(row["OCT_STD_FARE"]),
  ]);
}

/*
 * Airport Express last, so it wins: the Airport and AsiaWorld-Expo pairs are
 * missing from the table above entirely, and where the two overlap the express
 * fare is the one actually charged. It publishes no elderly or student fare,
 * because it has none.
 */
let express = 0;
for (const row of await csv(AEL_FARES)) {
  const from = codeById.get(row["ST_FROM_ID"] ?? "");
  const to = codeById.get(row["ST_TO_ID"] ?? "");
  if (!from || !to || from === to) continue;

  fares.set(from + to, [
    money(row["OCT_ADT_FARE"]),
    money(row["SINGLE_ADT_FARE"]),
    money(row["OCT_CHD_FARE"]),
    null,
    null,
  ]);
  express++;
}

const table = Object.fromEntries([...fares].sort(([a], [b]) => a.localeCompare(b)));

writeFileSync(
  OUT,
  `${JSON.stringify({ generated: new Date().toISOString().slice(0, 10), fares: table })}\n`,
);

console.log(
  `rail-fares.json: ${fares.size} pairs (${express} Airport Express), ` +
    `${new Set([...fares.keys()].map((k) => k.slice(0, 3))).size} stations`,
);
