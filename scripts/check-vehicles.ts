/**
 * Every route's inferred buses, checked against the feed that produced them.
 *
 * The inference in `~/data/vehicles` is only ever seen one route at a time,
 * through whatever the feed happens to say while somebody is looking. This
 * sweeps every route with a live route feed (KMB and GMB), runs the app's own
 * inference - the real modules, the real pacing - on this minute's arrivals,
 * and prints the placements that contradict the table they came from:
 *
 *   phantom   a bus about to arrive at a stop whose own next arrival is far
 *             later - the "架車就到 under a 53-minute row" bug
 *   twins     two buses within a fraction of a stop of each other - one
 *             vehicle drawn twice, the chain-split bug
 *   invalid   a placement outside the route or with broken arithmetic
 *
 *   bun scripts/check-vehicles.ts [ROUTE ...]   limit to the named routes
 *
 * `BASELINE=ref` also runs that git revision of vehicles.ts on the same
 * tables, so a fix can be measured against the traffic that exposed it.
 * `DB_FILE=path` reads a saved route database instead of fetching it.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pacedByDistance, pacedByFeed } from "~/data/pace";
import type { Eta, KeyedRoute } from "~/data/types";
import * as current from "~/data/vehicles";
import type { EtaTable } from "~/data/vehicles";

const DB_URL = "https://data.hkbus.app/routeFareList.min.json";
const CONCURRENCY = 12;
/** A stop's own next arrival this far after a bus "due" there is a phantom. */
const PHANTOM_MS = 5 * 60_000;
/** Two placements closer than this, in stops, are suspected to be one bus. */
const TWIN_STOPS = 0.7;

type Inference = Pick<typeof current, "inferVehicles" | "progressOf">;

interface RouteDbJson {
  routeList: Record<
    string,
    KeyedRoute & { stops: Record<string, string[] | undefined>; bound: Record<string, string> }
  >;
  stopList: Record<string, { location: { lat: number; lng: number } } | undefined>;
}

/* ------------------------------------------------------------------ feeds */
/*
 * The fetch layer is deliberately script-local: the app's `cachedJson` drags
 * in the query client and the poll pacer, neither of which belongs in a
 * batch sweep. The parsing below mirrors `~/data/eta/kmb` and `.../gmb`
 * row for row - same bound filter, same eta_seq order, same live/scheduled
 * rule - so the tables handed to the inference are the app's tables.
 */

function parseHkTime(value: string | null): Date | null {
  if (!value) return null;
  const trimmed = value.trim();
  const hasOffset = /(?:Z|[+-]\d{2}:?\d{2})$/.test(trimmed);
  const iso = hasOffset ? trimmed.replace(" ", "T") : `${trimmed.replace(" ", "T")}+08:00`;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

const fetched = new Map<string, Promise<unknown>>();

function sharedJson<T>(url: string): Promise<T | null> {
  let flight = fetched.get(url);
  if (!flight) {
    flight = fetch(url)
      .then((res) => (res.ok ? res.json() : null))
      .catch(() => null);
    fetched.set(url, flight);
  }
  return flight as Promise<T | null>;
}

interface KmbRow {
  dir: string;
  seq: number;
  eta: string | null;
  eta_seq: number;
  rmk_tc: string;
  rmk_en: string;
}

async function kmbTable(route: KeyedRoute): Promise<EtaTable | null> {
  const url = `https://data.etabus.gov.hk/v1/transport/kmb/route-eta/${encodeURIComponent(route.route)}/${route.serviceType}`;
  const body = await sharedJson<{ data: KmbRow[] }>(url);
  if (!body) return null;

  const dir = route.bound.kmb;
  const table: EtaTable = new Map();
  const rows = body.data
    .filter((row) => (!dir || row.dir === dir) && row.eta)
    .sort((a, b) => a.eta_seq - b.eta_seq);

  for (const row of rows) {
    const at = parseHkTime(row.eta);
    if (!at) continue;
    const scheduled = /scheduled/i.test(row.rmk_en) || row.rmk_tc.includes("原定");
    const eta: Eta = { at, source: scheduled ? "scheduled" : "live", co: "kmb" };
    table.set(row.seq, [...(table.get(row.seq) ?? []), eta]);
  }
  return table;
}

interface GmbStopRow {
  stop_seq: number;
  eta: { eta_seq: number; timestamp: string; remarks_en: string | null }[] | null;
}

async function gmbTable(route: KeyedRoute): Promise<EtaTable | null> {
  if (!route.gtfsId) return new Map();
  const seq = route.bound.gmb === "I" ? 2 : 1;
  const body = await sharedJson<{ data?: GmbStopRow[] }>(
    `https://data.etagmb.gov.hk/eta/route/${route.gtfsId}/${seq}`,
  );
  if (!body) return null;

  const table: EtaTable = new Map();
  for (const row of body.data ?? []) {
    if (typeof row.stop_seq !== "number") continue;
    const etas = (row.eta ?? []).flatMap((e): Eta[] => {
      const at = parseHkTime(e.timestamp);
      if (!at) return [];
      return [{ at, source: e.remarks_en === "Scheduled" ? "scheduled" : "live", co: "gmb" }];
    });
    if (etas.length > 0) table.set(row.stop_seq, etas);
  }
  return table;
}

/* ------------------------------------------------------------------ audit */

interface Finding {
  kind: "phantom" | "twins" | "invalid" | "crash";
  detail: string;
}

function audit(
  mod: Inference,
  route: KeyedRoute,
  table: EtaTable,
  stops: { lat: number; lng: number }[],
  now: number,
): Finding[] {
  const name = `${route.route} ${route.bound[route.co[0] ?? ""] ?? "?"}→${route.dest.zh} (st ${route.serviceType})`;
  let vehicles: current.Vehicle[];
  try {
    const ride = pacedByFeed(pacedByDistance(route, stops), table, stops.length);
    vehicles = mod.inferVehicles(route, table, stops.length, now, ride);
  } catch (error) {
    return [{ kind: "crash", detail: `${name}: ${String(error)}` }];
  }

  const findings: Finding[] = [];

  const earliest = new Map<number, number>();
  for (const [seq, etas] of table) {
    for (const eta of etas) {
      const at = eta.at.getTime();
      if (at < (earliest.get(seq) ?? Infinity)) earliest.set(seq, at);
    }
  }

  for (const bus of vehicles) {
    const progress = mod.progressOf(bus, now);
    if (
      !Number.isFinite(progress) ||
      bus.segSeconds <= 0 ||
      bus.nextSeq < 2 ||
      bus.nextSeq > stops.length
    ) {
      findings.push({
        kind: "invalid",
        detail: `${name}: nextSeq ${bus.nextSeq}, seg ${bus.segSeconds}s, progress ${progress}`,
      });
    }

    const reported = earliest.get(bus.nextSeq);
    if (reported !== undefined && reported - bus.at.getTime() > PHANTOM_MS) {
      const minutes = Math.round((reported - now) / 60_000);
      findings.push({
        kind: "phantom",
        detail: `${name}: bus due seq ${bus.nextSeq} now, whose own next arrival is ${minutes}m out`,
      });
    }
  }

  for (let a = 0; a < vehicles.length; a += 1) {
    for (let b = a + 1; b < vehicles.length; b += 1) {
      const va = vehicles[a] as current.Vehicle;
      const vb = vehicles[b] as current.Vehicle;
      const gap = Math.abs(mod.progressOf(va, now) - mod.progressOf(vb, now));
      if (gap < TWIN_STOPS) {
        findings.push({
          kind: "twins",
          detail: `${name}: two buses ${gap.toFixed(2)} stops apart at seq ${va.nextSeq}/${vb.nextSeq}`,
        });
      }
    }
  }

  return findings;
}

/* --------------------------------------------------------------- baseline */

async function loadBaseline(ref: string): Promise<Inference> {
  const source = execFileSync("git", ["show", `${ref}:src/data/vehicles.ts`], {
    encoding: "utf8",
  });
  const data = resolve(import.meta.dirname, "../src/data");
  const rewritten = source
    .replace('"./pace"', JSON.stringify(join(data, "pace.ts")))
    .replace('"./types"', JSON.stringify(join(data, "types.ts")));
  const file = join(mkdtempSync(join(tmpdir(), "vehicles-baseline-")), "vehicles.ts");
  writeFileSync(file, rewritten);
  return (await import(file)) as Inference;
}

/* ------------------------------------------------------------------- main */

const only = new Set(process.argv.slice(2).map((r) => r.toUpperCase()));
const db: RouteDbJson = process.env.DB_FILE
  ? JSON.parse(readFileSync(process.env.DB_FILE, "utf8"))
  : ((await (await fetch(DB_URL)).json()) as RouteDbJson);

const modules: Record<string, Inference> = { current };
if (process.env.BASELINE)
  modules[`baseline(${process.env.BASELINE})`] = await loadBaseline(process.env.BASELINE);

interface Target {
  route: KeyedRoute;
  stops: { lat: number; lng: number }[];
  feed: "kmb" | "gmb";
}

const targets: Target[] = [];
let unmapped = 0;
for (const key in db.routeList) {
  const entry = db.routeList[key];
  if (!entry) continue;
  const feed = entry.co.find((co) => co === "kmb" || co === "gmb") as "kmb" | "gmb" | undefined;
  if (!feed) continue;
  if (only.size > 0 && !only.has(entry.route.toUpperCase())) continue;

  const stopsCo = entry.co.find((co) => entry.stops[co]);
  const ids = stopsCo ? (entry.stops[stopsCo] ?? []) : [];
  const stops = ids.map((id) => db.stopList[id]?.location).filter((s) => s !== undefined);
  if (stops.length < 2 || stops.length !== ids.length) {
    unmapped += 1;
    continue;
  }
  targets.push({ route: { ...entry, key }, stops, feed });
}

console.log(`${targets.length} route directions with a route feed (${unmapped} unmapped)`);

const findings = new Map<string, Finding[]>(Object.keys(modules).map((name) => [name, []]));
let live = 0;
let scheduledOnly = 0;
let unreachable = 0;
let done = 0;

const queue = [...targets];
await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    for (let target = queue.shift(); target; target = queue.shift()) {
      const table =
        target.feed === "kmb" ? await kmbTable(target.route) : await gmbTable(target.route);
      done += 1;
      if (done % 500 === 0) console.log(`  ...${done}/${targets.length}`);
      if (!table) {
        unreachable += 1;
        continue;
      }
      const hasLive = [...table.values()].some((etas) => etas.some((e) => e.source === "live"));
      if (!hasLive) {
        scheduledOnly += 1;
        continue;
      }
      live += 1;
      const now = Date.now();
      for (const [name, mod] of Object.entries(modules)) {
        findings.get(name)?.push(...audit(mod, target.route, table, target.stops, now));
      }
    }
  }),
);

console.log(
  `\n${live} with live buses, ${scheduledOnly} scheduled-only, ${unreachable} unreachable\n`,
);

for (const [name, list] of findings) {
  console.log(`== ${name}`);
  for (const kind of ["crash", "invalid", "phantom", "twins"] as const) {
    const of = list.filter((f) => f.kind === kind);
    console.log(`  ${kind}: ${of.length}`);
    for (const f of of.slice(0, 12)) console.log(`    ${f.detail}`);
    if (of.length > 12) console.log(`    ...and ${of.length - 12} more`);
  }
}
