/**
 * Lays out the schematic railway map.
 *
 * The first version of this relaxed the real coordinates under forces - pull
 * every edge to its nearest compass direction, push stations apart, hold each
 * on a spring to where it truly is - and it does not work. A metro map is a
 * design, not an optimum: every constraint added to such a search is paid for
 * by another, and the versions that scored best looked least like Hong Kong.
 * Opening the harbour cost a fifth of the angles; squaring the runs put
 * stations back on top of each other.
 *
 * So the positions are set by hand, and this does only the part that is not a
 * judgement. Every junction, terminus and shared station is anchored below, as
 * is every station whose place carries a decision - Nathan Road is a straight
 * drop because that is what it is, not because a search found it. The rest are
 * strung along the runs between anchors, which is arithmetic: take an
 * octilinear path and space them evenly along it.
 *
 * Because the anchors are the input, the failures are legible. A run that
 * cannot be drawn names the two anchors whose relationship is impossible, and
 * that pair is the only thing anyone has to think about.
 *
 *   bun run railmap
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const DB_URL = "https://data.hkbus.app/routeFareList.min.json";
const OUT = fileURLToPath(new URL("../src/data/railMap.ts", import.meta.url));

/** The ten heavy-rail lines, in the order the railway's own map lists them. */
const LINE_ORDER = ["TWL", "KTL", "ISL", "TKL", "TCL", "TML", "EAL", "SIL", "DRL", "AEL"];

/**
 * Hand-set positions, one square per hop, x east and y south.
 *
 * The y axis is banded so the regions cannot collide: the New Territories have
 * 0-22, Kowloon 24-36, the harbour 36-44, Hong Kong Island 44 and below. An
 * earlier layout left Tai Wai two squares from Mong Kok, a ten-kilometre error
 * and the kind the eye catches at a glance.
 */
const ANCHORS: Record<string, [number, number]> = {
  // East Rail: the spine down the middle of the New Territories.
  LOW: [32, 0],
  LMC: [28, 2],
  SHS: [32, 2],
  TAW: [32, 16],
  KOT: [36, 20],
  LOF: [38, 20],
  WTS: [40, 22],
  MKK: [36, 26],
  HUH: [36, 32],
  EXC: [36, 40],

  // Tsuen Wan line: one flat row west, then straight down Nathan Road.
  TSW: [10, 24],
  LAK: [18, 24],
  MEF: [22, 24],
  PRE: [30, 24],
  SKM: [32, 24],
  MOK: [30, 26],
  YMT: [30, 28],
  JOR: [30, 30],
  TST: [30, 32],

  // Hong Kong Island: one straight rule along the north shore, set far enough
  // south that a real coastline fits in the water between it and Kowloon.
  KET: [16, 46],
  CEN: [28, 46],
  ADM: [30, 46],
  NOP: [45, 46],
  QUB: [48, 46],
  CHW: [63, 46],
  LET: [30, 52],
  SOH: [26, 52],

  // Kowloon, and the run east along the far shore.
  HOM: [34, 32],
  WHA: [32, 34],
  TKW: [36, 30],
  SUW: [38, 28],
  KAT: [40, 26],
  DIH: [42, 24],
  HIK: [42, 16],
  CHH: [46, 24],
  KOB: [50, 24],
  NTK: [54, 24],
  KWT: [56, 26],
  LAT: [58, 28],
  YAT: [62, 32],
  TIK: [64, 32],
  TKO: [66, 30],
  POA: [66, 26],
  LHP: [68, 32],

  // Tuen Ma: the long western arm, through west Kowloon, and up the east.
  // Tuen Mun to Tin Shui Wai is one vertical, with the light rail trunk one
  // square east of it and the Tuen Mun and Tin Shui Wai meshes hung off its
  // ends - so the arm is placed for the tram network it threads through.
  TUM: [8, 19],
  SIH: [8, 13],
  TIS: [8, 6],
  LOP: [12, 6],
  YUL: [16, 6],
  KSR: [16, 18],
  NAC: [22, 28],
  AUS: [22, 36],
  ETS: [32, 36],
  WKS: [48, 0],

  // Light Rail, one square per hop. Sixty-odd stops in a mesh with almost no
  // straight runs, so nearly all of them are judgements and nearly all are
  // anchored; the ids are the railway's own, canonicalised.

  // The Tin Shui Wai loop, north of the Tuen Ma station it feeds.
  LR435: [8, 5],
  LR450: [8, 4],
  LR455: [8, 3],
  LR500: [8, 2],
  LR510: [8, 1],
  LR520: [7, 0],
  LR530: [6, 0],
  LR540: [5, 0],
  LR550: [4, 1],
  LR480: [4, 2],
  LR468: [5, 3],
  LR490: [7, 3],
  LR460: [6, 4],
  LR448: [6, 6],
  LR445: [7, 7],

  // The trunk down to Siu Hong, and the fork at Hung Shui Kiu.
  LR425: [9, 7],
  LR390: [10, 8],
  LR380: [9, 9],
  LR370: [9, 10],
  LR360: [9, 11],
  LR350: [9, 12],

  // The Yuen Long arm, one row under the Tuen Ma line it parallels.
  LR400: [11, 8],
  LR560: [12, 8],
  LR570: [13, 8],
  LR580: [14, 8],
  LR590: [15, 7],

  // Tuen Mun: the western loop down to the ferry pier, the two columns
  // between Siu Hong and Tuen Mun, and the town centre south of the station.
  LR110: [7, 12],
  LR120: [6, 13],
  LR130: [5, 12],
  LR140: [4, 13],
  LR150: [4, 14],
  LR160: [4, 15],
  LR170: [4, 16],
  LR212: [5, 15],
  LR220: [5, 16],
  LR230: [6, 16],
  LR90: [7, 14],
  LR80: [7, 15],
  LR75: [7, 17],
  LR70: [7, 18],
  LR300: [9, 20],
  LR280: [8, 21],
  LR275: [9, 22],
  LR270: [8, 23],
  LR265: [7, 23],
  LR920: [7, 24],
  LR260: [6, 23],
  LR250: [5, 23],
  LR240: [4, 23],
  LR1: [3, 23],
  LR10: [2, 22],
  LR15: [2, 21],
  LR20: [2, 20],
  LR30: [2, 19],
  LR40: [2, 18],
  LR50: [2, 17],
  LR200: [4, 17],
  LR60: [4, 19],
  LR180: [5, 17],
  LR190: [5, 18],

  // Lantau, the airport, and the crossing to Hong Kong station.
  TSY: [10, 32],
  KOW: [26, 32],
  HOK: [26, 44],
  SUN: [6, 36],
  TUC: [2, 40],
  DIS: [8, 38],
  AWE: [0, 32],
};

/** Nothing may sit closer than this to anything else, in squares. */
const CLEARANCE = 1.4;
/**
 * Except light rail, which is drawn at one hop per square rather than two: it
 * is a tram network, sixty-eight stops in the space the heavy rail gives to
 * fifteen, and spacing it like a railway would make it a third of the map.
 */
const LIGHT_RAIL_CLEARANCE = 0.9;
/** Nor this close to a station on another landmass: that gap is water. */
const CHANNEL = 3.5;

interface Stop {
  location: { lat: number; lng: number };
  name: { en: string; zh: string };
}
interface Route {
  route: string;
  co: string[];
  stops: Record<string, string[]>;
}
type Point = [number, number];
type Land = "lantau" | "island" | "mainland";

type Db = { routeList: Record<string, Route>; stopList: Record<string, Stop> };

/* `DB_FILE=path` reads a saved copy: the layout is iterated dozens of times in
   a sitting, and eight megabytes a run is the difference between a tool and a
   chore. */
async function loadDb(): Promise<Db> {
  if (process.env.DB_FILE) return JSON.parse(readFileSync(process.env.DB_FILE, "utf8")) as Db;
  const res = await fetch(DB_URL);
  if (!res.ok) throw new Error(`${DB_URL} answered ${res.status}`);
  return (await res.json()) as Db;
}

const db = await loadDb();

/*
 * Topology, from the stop sequences. A line is several routes - two directions,
 * and more where it branches - so the edges are the union of every consecutive
 * pair across all of them, taken undirected. That picks up the Lo Wu and Lok Ma
 * Chau branches and the LOHAS Park spur without naming them.
 */
const edges = new Map<string, { a: string; b: string; line: string }>();
const onLine = new Map<string, Set<string>>();
const stations = new Set<string>();
/** Light rail route numbers calling at each station, by station id. */
const lightRailAt = new Map<string, Set<string>>();

/*
 * Light Rail is one network on the map, not twenty-seven routes: drawn a route
 * at a time it is twenty-seven overlapping strokes in twelve colours, and the
 * printed map does not do that either. Its edges are the union of every route's
 * consecutive pairs, under one line code, and each station remembers which
 * routes call so the panel can still list them.
 *
 * Two quirks of the data are absorbed here. The same platform appears both as
 * "LR60" and "LR060" depending on which route's stop list you read, so ids are
 * canonicalised. And where a light rail stop and a Tuen Ma station share a
 * name they are one interchange on the ground, and the map shows them as one -
 * the stop is folded into the station, which then carries both.
 */
const LIGHT_RAIL = "LR";
const canonical = (id: string) => id.replace(/^LR0+(?=\d)/, "LR");
const FOLDED: Record<string, string> = { LR295: "TUM", LR100: "SIH", LR430: "TIS", LR600: "YUL" };
const lightRailId = (id: string) => FOLDED[canonical(id)] ?? canonical(id);

for (const key in db.routeList) {
  const route = db.routeList[key];
  const co = route?.co[0];
  if (co !== "mtr" && co !== "lightRail") continue;
  const line = co === "mtr" ? route.route : LIGHT_RAIL;
  const seq = (co === "mtr" ? (route.stops.mtr ?? []) : (route.stops.lightRail ?? [])).map((id) =>
    co === "mtr" ? id : lightRailId(id),
  );
  const members = onLine.get(line) ?? new Set<string>();

  for (let i = 0; i < seq.length; i++) {
    const id = seq[i]!;
    if (!db.stopList[id]) continue;
    stations.add(id);
    members.add(id);
    if (co === "lightRail") {
      const routes = lightRailAt.get(id) ?? new Set<string>();
      routes.add(route.route);
      lightRailAt.set(id, routes);
    }
    const next = seq[i + 1];
    if (!next || !db.stopList[next] || next === id) continue;
    const [a, b] = id < next ? [id, next] : [next, id];
    edges.set(`${line}:${a}:${b}`, { a, b, line });
  }
  onLine.set(line, members);
}

for (const [from, to] of Object.entries(FOLDED)) {
  if (!stations.has(to)) throw new Error(`${from} folds into ${to}, which is not on the map`);
}

const edgeList = [...edges.values()];
const neighbours = new Map<string, Set<string>>();
const linesAt = new Map<string, Set<string>>();
for (const e of edgeList) {
  for (const [x, y] of [
    [e.a, e.b],
    [e.b, e.a],
  ] as const) {
    if (!neighbours.has(x)) neighbours.set(x, new Set());
    if (!linesAt.has(x)) linesAt.set(x, new Set());
    neighbours.get(x)!.add(y);
    linesAt.get(x)!.add(e.line);
  }
}

/*
 * Which landmass a station stands on. The diagram's own coordinates cannot say,
 * having been bent off geography on purpose, but latitude and longitude still
 * can. Lantau is the corner that is both west and south: longitude alone put
 * Yuen Long and Tuen Mun on it, the north-west New Territories reaching further
 * west than the island does.
 */
const landOf = (id: string): Land => {
  const { lat, lng } = db.stopList[id]!.location;
  if (lng < 114.05 && lat < 22.34) return "lantau";
  return lat < 22.292 ? "island" : "mainland";
};

/** Anchored, or a junction, terminus or shared station: anything fixed. */
const isAnchor = (id: string) =>
  id in ANCHORS || (neighbours.get(id)?.size ?? 0) !== 2 || (linesAt.get(id)?.size ?? 0) > 1;

/** Every stretch between two anchors, as [anchor, ...between, anchor]. */
function runs(): string[][] {
  const found: string[][] = [];
  const walked = new Set<string>();
  const key = (a: string, b: string) => (a < b ? `${a}:${b}` : `${b}:${a}`);

  for (const start of [...stations].sort()) {
    if (!isAnchor(start)) continue;
    for (const first of [...(neighbours.get(start) ?? [])].sort()) {
      if (walked.has(key(start, first))) continue;
      walked.add(key(start, first));
      const chain = [start, first];
      let previous = start;
      let at = first;
      while (!isAnchor(at)) {
        const next = [...neighbours.get(at)!].find((n) => n !== previous)!;
        walked.add(key(at, next));
        chain.push(next);
        previous = at;
        at = next;
      }
      found.push(chain);
    }
  }
  return found;
}

const octilinear = (a: Point, b: Point) => {
  const dx = Math.abs(b[0] - a[0]);
  const dy = Math.abs(b[1] - a[1]);
  return dx === 0 || dy === 0 || dx === dy;
};

/** Octilinear ways from a to b: straight if it can be, else with one bend. */
function paths(a: Point, b: Point): Point[][] {
  if (octilinear(a, b)) return [[a, b]];
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const sx = Math.sign(dx);
  const sy = Math.sign(dy);
  const slant = Math.min(Math.abs(dx), Math.abs(dy));
  const straight = Math.abs(Math.abs(dx) - Math.abs(dy));

  // The bend is where the square leg meets the diagonal one, either order.
  return Math.abs(dx) > Math.abs(dy)
    ? [
        [a, [a[0] + sx * straight, a[1]], b],
        [a, [a[0] + sx * slant, a[1] + sy * slant], b],
      ]
    : [
        [a, [a[0], a[1] + sy * straight], b],
        [a, [a[0] + sx * slant, a[1] + sy * slant], b],
      ];
}

/** `count` points spaced evenly along a polyline, excluding its ends. */
function spaceAlong(path: Point[], count: number): Point[] {
  const legs = path.slice(0, -1).map((p, i) => [p, path[i + 1]!] as const);
  const lengths = legs.map(([p, q]) => Math.hypot(q[0] - p[0], q[1] - p[1]));
  const total = lengths.reduce((sum, l) => sum + l, 0);

  return Array.from({ length: count }, (_, i) => {
    let want = (total * (i + 1)) / (count + 1);
    for (let j = 0; j < legs.length; j++) {
      const [from, to] = legs[j]!;
      const length = lengths[j]!;
      if (want <= length) {
        const t = length === 0 ? 0 : want / length;
        const half = (v: number) => Math.round(v * 2) / 2;
        return [
          half(from[0] + (to[0] - from[0]) * t),
          half(from[1] + (to[1] - from[1]) * t),
        ] as Point;
      }
      want -= length;
    }
    return path[path.length - 1]!;
  });
}

const at = new Map<string, Point>(Object.entries(ANCHORS));
const failures: string[] = [];

for (const chain of runs()) {
  const first = chain[0]!;
  const last = chain[chain.length - 1]!;
  const head = at.get(first);
  const tail = at.get(last);
  if (!head || !tail) {
    failures.push(`unanchored end on ${first}..${last}`);
    continue;
  }

  const between = chain.slice(1, -1);
  if (between.length === 0) {
    if (!octilinear(head, tail))
      failures.push(`${first}[${head}] - ${last}[${tail}] is off the grid`);
    continue;
  }

  const placed = paths(head, tail)
    .map((path) => spaceAlong(path, between.length))
    .find((points) => {
      const all = [head, ...points, tail];
      return all.every((p, i) => i === 0 || octilinear(all[i - 1]!, p));
    });

  if (!placed) {
    failures.push(
      `no octilinear route: ${first}[${head}] -> ${last}[${tail}] with ${between.length} between`,
    );
    continue;
  }
  between.forEach((id, i) => at.set(id, placed[i]!));
}

/* Every rule the drawing depends on, checked here as well as in the unit test:
   a fault should name itself while the layout is still in front of you. */
for (const e of edgeList) {
  const a = at.get(e.a);
  const b = at.get(e.b);
  if (a && b && !octilinear(a, b)) failures.push(`bent ${e.line} ${e.a}[${a}] - ${e.b}[${b}]`);
}

const ids = [...stations].sort();
for (let i = 0; i < ids.length; i++) {
  for (let j = i + 1; j < ids.length; j++) {
    const a = at.get(ids[i]!);
    const b = at.get(ids[j]!);
    if (!a || !b) continue;
    const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
    const light = onLine.get(LIGHT_RAIL)?.has(ids[i]!) || onLine.get(LIGHT_RAIL)?.has(ids[j]!);
    const need = light ? LIGHT_RAIL_CLEARANCE : CLEARANCE;
    if (d < need) failures.push(`${ids[i]} and ${ids[j]} are only ${d.toFixed(2)} apart`);
    else if (landOf(ids[i]!) !== landOf(ids[j]!) && d < CHANNEL) {
      failures.push(`${ids[i]} and ${ids[j]} leave only ${d.toFixed(2)} of water`);
    }
  }
}

const never = ids.filter((id) => !at.has(id));
if (never.length > 0) failures.push(`never placed: ${never.join(", ")}`);

if (failures.length > 0) {
  console.error(`railMap: ${failures.length} problems\n  ${failures.join("\n  ")}`);
  process.exit(1);
}

const ORDER = [...LINE_ORDER, LIGHT_RAIL];

const placed = ids.map((id) => ({
  id,
  x: at.get(id)![0],
  y: at.get(id)![1],
  land: landOf(id),
  lines: ORDER.filter((code) => onLine.get(code)?.has(id)),
  routes: [...(lightRailAt.get(id) ?? [])].sort((p, q) =>
    p.localeCompare(q, undefined, { numeric: true }),
  ),
  // The stop the light rail itself knows this place as: its own id, or for a
  // folded interchange the stop that was folded into the station.
  lightRail: lightRailAt.has(id)
    ? (Object.entries(FOLDED).find(([, to]) => to === id)?.[0] ?? id)
    : undefined,
}));

const lines = ORDER.filter((code) => onLine.has(code)).map((code) => ({
  code,
  edges: edgeList.filter((e) => e.line === code).map((e) => [e.a, e.b] as const),
}));

/*
 * Emitted as source rather than JSON in public/, because a typed module is what
 * survives being read: the editor knows the shape and a diff of one station is
 * one line. It carries geometry and topology only - names and colours already
 * exist in the route database and in `plateStyle`, and a second copy of either
 * would only go stale.
 */
const ts =
  `/**\n` +
  ` * Where each station sits on the schematic map, and what connects to what.\n` +
  ` *\n` +
  ` * Generated by \`bun run railmap\` from the anchors hand-set in that script.\n` +
  ` * Coordinates are grid squares, x rightwards and y down; the renderer scales\n` +
  ` * them. To move a station, move it *there* rather than here - an edit to this\n` +
  ` * file is overwritten the next time anyone runs the script, and the script is\n` +
  ` * also what checks the move has not bent the segments either side of it or\n` +
  ` * slid it on top of a neighbour.\n` +
  ` *\n` +
  ` * Generated ${new Date().toISOString().slice(0, 10)}.\n` +
  ` */\n\n` +
  `export type Land = "lantau" | "island" | "mainland";\n\n` +
  `/** The one line code that is not a railway line: the whole light rail network. */\n` +
  `export const LIGHT_RAIL = "${LIGHT_RAIL}";\n\n` +
  `export interface MapStation {\n` +
  `  /** Station code, the same id the route database uses. */\n` +
  `  id: string;\n` +
  `  x: number;\n` +
  `  y: number;\n` +
  `  /** Which landmass it stands on. */\n` +
  `  land: Land;\n` +
  `  /** Lines calling here, in the railway's own map order; \`LIGHT_RAIL\` last. */\n` +
  `  lines: string[];\n` +
  `  /** Light rail routes calling here, by number. Empty where none do. */\n` +
  `  routes: string[];\n` +
  `  /** The light rail's own id for this place, where its routes call. */\n` +
  `  lightRail?: string;\n` +
  `}\n\n` +
  `/** One grid square, in the units the coordinates below are given in. */\n` +
  `export const GRID = 1;\n\n` +
  `export const MAP_STATIONS: MapStation[] = [\n` +
  placed
    .map(
      (s) =>
        `  { id: "${s.id}", x: ${s.x}, y: ${s.y}, land: "${s.land}", ` +
        `lines: [${s.lines.map((l) => `"${l}"`).join(", ")}], ` +
        `routes: [${s.routes.map((r) => `"${r}"`).join(", ")}]` +
        (s.lightRail ? `, lightRail: "${s.lightRail}"` : "") +
        ` },`,
    )
    .join("\n") +
  `\n];\n\n` +
  `/**\n` +
  ` * The segments of each line, undirected. Branches need no special case: they\n` +
  ` * are simply a station with three neighbours instead of two.\n` +
  ` */\n` +
  `export const MAP_EDGES: Record<string, [string, string][]> = {\n` +
  lines
    .map(
      (l) =>
        `  ${l.code}: [\n` + l.edges.map(([a, b]) => `    ["${a}", "${b}"],`).join("\n") + `\n  ],`,
    )
    .join("\n") +
  `\n};\n`;

writeFileSync(OUT, ts);

const anchored = Object.keys(ANCHORS).length;
console.log(
  `railMap.ts: ${placed.length} stations, ${edgeList.length} edges, ${lines.length} lines\n` +
    `  ${anchored} anchored by hand, ${placed.length - anchored} routed between them\n` +
    `  every segment on the grid, nothing closer than ${CLEARANCE} squares ` +
    `(${LIGHT_RAIL_CLEARANCE} around light rail)`,
);
