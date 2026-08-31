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
 * A line may also turn *between* two stations. The railway's own map is mostly
 * rows and columns joined by wide curves, and the curve is rarely at a station:
 * the Kwun Tong line leaves Kowloon Bay eastwards and is heading south by the
 * time it reaches Ngau Tau Kok. Drawn only with corners at stations that is a
 * diagonal, and a map of diagonals is a wiring diagram. So a segment between
 * two anchors may carry elbows, set by hand in `BENDS`, and a run whose spaced
 * stations straddle its one corner gets that corner as an elbow automatically.
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

type Point = [number, number];

/**
 * Hand-set positions, one square per hop, x east and y south.
 *
 * The y axis is banded so the regions cannot collide: the New Territories have
 * 0-20, Kowloon 22-35, the harbour 36-44, Hong Kong Island 46 and below. An
 * earlier layout left Tai Wai two squares from Mong Kok, a ten-kilometre error
 * and the kind the eye catches at a glance.
 *
 * The shape follows the railway's own map where it can: East Rail is one
 * straight spine down x=34 from the border to Hung Hom; Nathan Road is a pair
 * of parallel verticals at x=30; the Kwun Tong line runs east along a row and
 * turns down a column; the Island line runs the north shore and turns south
 * after Sai Wan Ho; Tseung Kwan O rises from Quarry Bay and turns in to Yau
 * Tong. Where the official map bends between stations, `BENDS` does too.
 */
const ANCHORS: Record<string, Point> = {
  // East Rail: the spine down the middle of the map. Lok Ma Chau hangs off
  // Sheung Shui to the west; Exhibition Centre turns in to Admiralty.
  LOW: [34, 0],
  SHS: [34, 2],
  LMC: [30, 4],
  TAW: [34, 16],
  KOT: [34, 20],
  MKK: [34, 26],
  HUH: [34, 32],
  EXC: [34, 40],

  // Tsuen Wan line: one flat row west, then straight down Nathan Road, which
  // the Kwun Tong line joins at Prince Edward from Shek Kip Mei.
  TSW: [10, 24],
  LAK: [18, 24],
  MEF: [22, 24],
  PRE: [30, 24],
  SKM: [32, 22],
  MOK: [30, 26],
  YMT: [30, 28],
  JOR: [30, 30],
  TST: [30, 32],

  // Hong Kong Island: one straight rule along the north shore, set far enough
  // south that a real coastline fits in the water between it and Kowloon, and
  // turning south after Sai Wan Ho the way the shore does.
  KET: [16, 46],
  CEN: [28, 46],
  ADM: [30, 46],
  NOP: [45, 46],
  QUB: [48, 46],
  SWH: [54, 46],
  SKW: [57, 49],
  CHW: [57, 55],
  OCP: [30, 49],
  WCH: [30, 52],
  LET: [28, 54],
  SOH: [24, 54],

  // Kowloon east: the Kwun Tong row at y=20 turns down a column at x=49 and
  // comes in to Yau Tong; Tuen Ma drops from Diamond Hill down x=41.5 and
  // turns west along y=30 into Ho Man Tin.
  HOM: [36, 30],
  WHA: [38, 32],
  TKW: [41.5, 28],
  KAT: [41.5, 23],
  DIH: [41.5, 20],
  HIK: [37.5, 16],
  CHH: [44, 20],
  KOB: [46.5, 20],
  NTK: [49, 23],
  LAT: [49, 29],
  YAT: [52, 32],
  TIK: [55, 32],
  TKO: [58, 32],
  POA: [58, 26],
  LHP: [58, 35],

  // Tuen Ma: the long western arm, through west Kowloon, and up the east.
  // Tuen Mun to Tin Shui Wai is one vertical with the light rail hung off it;
  // Ma On Shan is a column beside East Rail that turns along the top.
  TUM: [8, 19],
  SIH: [8, 13],
  TIS: [8, 6],
  LOP: [12, 6],
  YUL: [16, 6],
  KSR: [16, 18],
  NAC: [22, 28],
  AUS: [22, 34],
  ETS: [32, 34],
  CKT: [38, 12],
  CIO: [38, 6],
  SHM: [41, 4],
  WKS: [53, 4],

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

/**
 * Where a line turns between two anchored stations: the elbows, in order from
 * the first station named to the second. Each leg has to be octilinear, and
 * the script says so if one is not.
 */
const BENDS: Record<`${string}>${string}`, Point[]> = {
  // Sheung Shui to Lok Ma Chau: down, then west along the border.
  "SHS>LMC": [[32, 4]],
  // Exhibition Centre to Admiralty: East Rail turns in off its spine.
  "EXC>ADM": [[34, 42]],
  // Sai Wan Ho to Shau Kei Wan: the Island line turns south.
  "SWH>SKW": [[57, 46]],
  // Quarry Bay to Yau Tong: up out of the harbour, then in to the junction.
  "QUB>YAT": [[48, 36]],
  // Kowloon Bay to Ngau Tau Kok: the row becomes a column.
  "KOB>NTK": [[49, 20]],
  // Yau Ma Tei to Ho Man Tin: off Nathan Road and east, over East Rail.
  "YMT>HOM": [[32, 30]],
  // Ho Man Tin to To Kwa Wan: east, then up the Kai Tak column.
  "HOM>TKW": [[41.5, 30]],
  // City One to Shek Mun: the Ma On Shan column becomes the top row.
  "CIO>SHM": [[38, 4]],
};

/**
 * The light rail as the railway's own map draws it when it is not the subject:
 * a few loops in its colour, no stops, hung off the Tuen Ma stations it feeds.
 * The diagram shows this until the rider zooms into the network, when the
 * sixty-eight stops take over. Each shape is a polyline in grid squares that
 * begins and ends at a station, so a loop closes under the station's marker
 * rather than turning a rounded corner there and standing off it.
 */
const LIGHT_RAIL_SHAPE: Point[][] = [
  // Tin Shui Wai: the loop north of the station.
  [
    [8, 6],
    [8, 0],
    [4, 0],
    [4, 6],
    [8, 6],
  ],
  // The Yuen Long arm, a row under the Tuen Ma line.
  [
    [8, 6],
    [10, 8],
    [14, 8],
    [16, 6],
  ],
  // The trunk beside the Tuen Ma line, Tin Shui Wai down to Tuen Mun.
  [
    [8, 6],
    [9, 7],
    [9, 18],
    [8, 19],
  ],
  // Tuen Mun: the loop west of the trunk, and the town south of the station.
  [
    [8, 13],
    [4, 13],
    [4, 19],
    [8, 19],
  ],
  [
    [8, 19],
    [8, 23],
    [2, 23],
    [2, 17],
    [4, 17],
    [4, 19],
  ],
];

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
/** An elbow this close to a station that is not one of its own ends is on it. */
const ELBOW_CLEARANCE = 1;

interface Stop {
  location: { lat: number; lng: number };
  name: { en: string; zh: string };
}
interface Route {
  route: string;
  co: string[];
  stops: Record<string, string[]>;
}
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
/** Elbows on a segment, keyed by its two stations in id order, in that order. */
const bends = new Map<string, Point[]>();
const failures: string[] = [];

const pairKey = (a: string, b: string) => (a < b ? `${a}:${b}` : `${b}:${a}`);
const setBend = (from: string, to: string, points: Point[]) =>
  bends.set(pairKey(from, to), from < to ? points : [...points].reverse());

for (const [key, points] of Object.entries(BENDS)) {
  const [from, to] = key.split(">") as [string, string];
  if (!stations.has(from) || !stations.has(to))
    failures.push(`bend ${key} names a station not on the map`);
  else if (!neighbours.get(from)?.has(to))
    failures.push(`bend ${key} is not a segment of any line`);
  else setBend(from, to, points);
}

/**
 * Where the one corner of a path falls between two consecutive stations, that
 * corner is an elbow on their segment. Answers the elbow, or null where the
 * pair is straight, or false where not even the corner makes it drawable.
 */
function elbowBetween(path: Point[], a: Point, b: Point): Point | null | false {
  if (octilinear(a, b)) return null;
  const corner = path[1];
  if (path.length !== 3 || !corner) return false;
  return octilinear(a, corner) && octilinear(corner, b) ? corner : false;
}

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
    const via = bends.get(pairKey(first, last)) ?? [];
    const all = [head, ...via, tail];
    if (!all.every((p, i) => i === 0 || octilinear(all[i - 1]!, p)))
      failures.push(`${first}[${head}] - ${last}[${tail}] is off the grid`);
    continue;
  }

  /*
   * Every candidate path is tried and the one that needs the fewest elbows
   * wins: stations that land on the corner themselves draw as a corner at a
   * station, which is what a printed map does where it can.
   */
  const placed = paths(head, tail)
    .map((path) => {
      const points = spaceAlong(path, between.length);
      const all = [head, ...points, tail];
      const elbows: (Point | null)[] = [];
      for (let i = 1; i < all.length; i++) {
        const elbow = elbowBetween(path, all[i - 1]!, all[i]!);
        if (elbow === false) return null;
        elbows.push(elbow);
      }
      return { points, elbows };
    })
    .filter((candidate) => candidate !== null)
    .sort((p, q) => p.elbows.filter(Boolean).length - q.elbows.filter(Boolean).length)[0];

  if (!placed) {
    failures.push(
      `no octilinear route: ${first}[${head}] -> ${last}[${tail}] with ${between.length} between`,
    );
    continue;
  }
  between.forEach((id, i) => at.set(id, placed.points[i]!));
  placed.elbows.forEach((elbow, i) => {
    if (elbow) setBend(chain[i]!, chain[i + 1]!, [elbow]);
  });
}

/* Every rule the drawing depends on, checked here as well as in the unit test:
   a fault should name itself while the layout is still in front of you. */
for (const e of edgeList) {
  const a = at.get(e.a);
  const b = at.get(e.b);
  if (!a || !b) continue;
  const all = [a, ...(bends.get(pairKey(e.a, e.b)) ?? []), b];
  for (let i = 1; i < all.length; i++) {
    if (!octilinear(all[i - 1]!, all[i]!))
      failures.push(`bent ${e.line} ${e.a}[${a}] - ${e.b}[${b}] at ${all[i - 1]} - ${all[i]}`);
  }
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

for (const [key, points] of bends) {
  const [from, to] = key.split(":");
  for (const elbow of points) {
    for (const id of ids) {
      if (id === from || id === to) continue;
      const p = at.get(id);
      if (p && Math.hypot(p[0] - elbow[0], p[1] - elbow[1]) < ELBOW_CLEARANCE)
        failures.push(`elbow ${elbow} on ${from}-${to} sits on ${id}`);
    }
  }
}

for (const shape of LIGHT_RAIL_SHAPE) {
  for (let i = 1; i < shape.length; i++) {
    if (!octilinear(shape[i - 1]!, shape[i]!))
      failures.push(`light rail shape leg ${shape[i - 1]} - ${shape[i]} is off the grid`);
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

const point = (p: Point) => `[${p[0]}, ${p[1]}]`;

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
  `\n};\n\n` +
  `/**\n` +
  ` * Where a segment turns between its two stations: the elbows, keyed by the\n` +
  ` * stations in id order and listed in that order. A segment not here is\n` +
  ` * straight. Every line through the pair shares the same elbows.\n` +
  ` */\n` +
  `export const MAP_BENDS: Record<string, [number, number][]> = {\n` +
  [...bends.entries()]
    .sort(([p], [q]) => (p < q ? -1 : 1))
    .map(([key, points]) => `  "${key}": [${points.map(point).join(", ")}],`)
    .join("\n") +
  `\n};\n\n` +
  `/**\n` +
  ` * The light rail reduced to its shape, for the zooms at which its stops are\n` +
  ` * not drawn: a few loops off the Tuen Ma stations it feeds, the way the\n` +
  ` * railway's own map draws it. Each begins and ends at a station.\n` +
  ` */\n` +
  `export const LIGHT_RAIL_SHAPE: [number, number][][] = [\n` +
  LIGHT_RAIL_SHAPE.map((shape) => `  [${shape.map(point).join(", ")}],`).join("\n") +
  `\n];\n`;

writeFileSync(OUT, ts);

const anchored = Object.keys(ANCHORS).length;
console.log(
  `railMap.ts: ${placed.length} stations, ${edgeList.length} edges, ${lines.length} lines\n` +
    `  ${anchored} anchored by hand, ${placed.length - anchored} routed between them, ` +
    `${bends.size} segments with elbows\n` +
    `  every segment on the grid, nothing closer than ${CLEARANCE} squares ` +
    `(${LIGHT_RAIL_CLEARANCE} around light rail)`,
);
