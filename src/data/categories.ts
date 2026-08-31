import type { Bilingual, KeyedRoute, RouteDb, StopEntry } from "./types";

/**
 * Hong Kong route numbers carry a lot of meaning - N is overnight, A is an
 * Airbus, B goes to a boundary crossing - and riders already think in those
 * terms. These categories turn that folk knowledge into a browsable index.
 *
 * Where a property can be read from the data rather than inferred from a
 * number, it is: cross-harbour is decided from stop coordinates, which finds
 * well over twice as many routes as assuming every cross-harbour route is
 * jointly operated.
 */

export type CategoryId =
  | "overnight"
  | "airport"
  | "crossBoundary"
  | "crossHarbour"
  | "hsr"
  | "express"
  | "peak"
  | "feeder"
  | "circular"
  | "islands"
  | "tourism"
  | "kmb"
  | "citybus"
  | "nlb"
  | "minibus"
  | "rail"
  | "ferry";

export interface Category {
  id: CategoryId;
  name: Bilingual;
  hint: Bilingual;
  /** Tint used for the category tile. */
  accent: string;
  matches: (route: KeyedRoute, db: RouteDb) => boolean;
}

/* ---- geography --------------------------------------------------------- */

/**
 * The harbour sits in the gap between these two bands, so no stop falls in
 * both. Tsim Sha Tsui (22.2943) counts as Kowloon; Central (22.282) as the
 * Island.
 */
const ISLAND_MAX_LAT = 22.289;
const KOWLOON_MIN_LAT = 22.2935;

/** Chek Lap Kok, generously bounded to include the GTC and the apron roads. */
const AIRPORT = { latMin: 22.3, latMax: 22.345, lngMin: 113.89, lngMax: 113.96 };

function stopsOf(route: KeyedRoute, db: RouteDb): StopEntry[] {
  const co = route.co[0];
  const ids = co ? (route.stops[co] ?? []) : [];
  return ids.flatMap((id) => {
    const stop = db.stopList[id];
    return stop ? [stop] : [];
  });
}

function onIsland(stop: StopEntry): boolean {
  const { lat, lng } = stop.location;
  return lat < ISLAND_MAX_LAT && lng > 114.12 && lng < 114.3;
}

function onMainland(stop: StopEntry): boolean {
  return stop.location.lat > KOWLOON_MIN_LAT;
}

function atAirport(stop: StopEntry): boolean {
  const { lat, lng } = stop.location;
  return (
    lat >= AIRPORT.latMin && lat <= AIRPORT.latMax && lng >= AIRPORT.lngMin && lng <= AIRPORT.lngMax
  );
}

/**
 * Control points, matched on terminus name. Two deliberate narrowings: only a
 * route that *starts or ends* there counts, because many airport routes merely
 * pass the Hong Kong-Zhuhai-Macao Bridge port; and the match is on 口岸 /
 * 管制站 rather than on district names like 沙頭角, which are ordinary
 * destinations inside the Frontier Closed Area, not crossings.
 */
const CROSSING = /口岸|管制站|Control Point|Boundary Crossing/i;

/* ---- timetable --------------------------------------------------------- */

/** Does this route run in the small hours, whatever it is numbered? */
function runsOvernight(route: KeyedRoute): boolean {
  if (!route.freq) return false;

  for (const service of Object.values(route.freq)) {
    for (const [start, band] of Object.entries(service)) {
      const from = Number(start.slice(0, 2));
      const to = band ? Number(band[0].slice(0, 2)) : from;
      // Either it begins in the small hours, or it began last night and is
      // still running past 02:00 - timetables express that as hours past 24.
      if ((from >= 0 && from < 5) || to >= 26) return true;
    }
  }
  return false;
}

const BUS_COMPANIES = new Set(["kmb", "ctb", "nlb", "lwb"]);
const isBus = (route: KeyedRoute) => BUS_COMPANIES.has(route.co[0] ?? "");

/* ---- sightseeing ------------------------------------------------------- */

/** A themed group of scenic routes, e.g. the Peak or the Stanley coast. */
export interface ScenicSeries {
  id: string;
  name: Bilingual;
  /** `"co route"` tokens; the operator disambiguates shared numbers. */
  routes: string[];
}

/**
 * No upstream data marks a route as scenic, so this list is curated. The
 * series follow Citybus's own 觀景路線 recommendations (the Peak, Stanley,
 * Shek O, the Eastern Corridor, the Pok Fu Lam sunset run) plus the
 * cross-operator classics riders actually take for the view: KMB over
 * Route Twisk and into Sai Kung, NLB across Lantau.
 */
export const SCENIC_SERIES: ScenicSeries[] = [
  {
    id: "openTop",
    name: { zh: "開篷觀光巴士", en: "Open-top tours" },
    routes: ["ctb H1", "ctb H1S", "ctb H2", "ctb H2K", "ctb H3", "ctb H4"],
  },
  {
    id: "peakHill",
    name: { zh: "山頂", en: "The Peak" },
    routes: ["ctb 15"],
  },
  {
    id: "stanley",
    name: { zh: "赤柱 · 淺水灣", en: "Stanley & Repulse Bay" },
    routes: ["ctb 6", "ctb 6X", "ctb 260", "ctb 973"],
  },
  {
    id: "shekO",
    name: { zh: "石澳 · 大浪灣", en: "Shek O & Big Wave Bay" },
    routes: ["ctb 9", "ctb 14"],
  },
  {
    id: "eastCorridor",
    name: { zh: "東廊海景", en: "Eastern Corridor" },
    routes: ["ctb 720", "ctb 788", "ctb 789"],
  },
  {
    id: "sunsetCoast",
    name: { zh: "薄扶林日落", en: "Pok Fu Lam sunsets" },
    routes: ["ctb 970X"],
  },
  {
    id: "taiMoShan",
    name: { zh: "大帽山", en: "Tai Mo Shan" },
    routes: ["kmb 51"],
  },
  {
    id: "saiKung",
    name: { zh: "西貢", en: "Sai Kung" },
    routes: ["kmb 94", "kmb 96R"],
  },
  {
    id: "lantau",
    name: { zh: "昂坪 · 大澳", en: "Ngong Ping & Tai O" },
    routes: ["nlb 11", "nlb 23"],
  },
];

/**
 * The series a route belongs to, if any - the one fact behind both the
 * category predicate and the grouped browse view. Any Citybus H route falls
 * into the open-top series even when unlisted: that family grows (H1S and
 * H2K arrived after H1/H2, then H20) and new members should appear without
 * an edit here.
 */
export function scenicSeriesOf(route: KeyedRoute): ScenicSeries | undefined {
  for (const series of SCENIC_SERIES) {
    if (route.co.some((co) => series.routes.includes(`${co} ${route.route}`))) return series;
  }
  if (route.co.includes("ctb") && /^H\d/i.test(route.route)) {
    return SCENIC_SERIES.find((series) => series.id === "openTop");
  }
  return undefined;
}

/**
 * Every scenic route the database can resolve, grouped by series in the
 * curated order - so a rider can see which routes are the sea views and
 * which climb the Peak, rather than one flat list of 46 numbers.
 */
export function scenicGroups(db: RouteDb): { series: ScenicSeries; routes: KeyedRoute[] }[] {
  const byId = new Map<string, KeyedRoute[]>(SCENIC_SERIES.map((series) => [series.id, []]));
  const seen = new Set<string>();

  for (const key in db.routeList) {
    const entry = db.routeList[key];
    if (!entry) continue;
    const route: KeyedRoute = { ...entry, key };
    const series = scenicSeriesOf(route);
    if (!series) continue;
    const identity = `${route.route}/${route.dest.en}/${route.co[0]}`;
    if (seen.has(identity)) continue;
    seen.add(identity);
    byId.get(series.id)?.push(route);
  }

  return SCENIC_SERIES.flatMap((series) => {
    const routes = byId.get(series.id) ?? [];
    if (routes.length === 0) return [];
    routes.sort((a, b) => a.route.localeCompare(b.route, "en", { numeric: true }));
    return [{ series, routes }];
  });
}

/* ---- the catalogue ----------------------------------------------------- */

export const CATEGORIES: Category[] = [
  {
    id: "overnight",
    name: { zh: "通宵路線", en: "Overnight" },
    hint: { zh: "N 線及深夜服務", en: "N routes and late-night service" },
    accent: "#5B6ECF",
    matches: (route) => isBus(route) && (/^N/i.test(route.route) || runsOvernight(route)),
  },
  {
    id: "airport",
    name: { zh: "機場路線", en: "Airport" },
    hint: { zh: "A · E · S · NA 線", en: "A, E, S and NA routes" },
    accent: "#00888A",
    matches: (route, db) =>
      /^(A|E|S|NA)\d/i.test(route.route) || stopsOf(route, db).some(atAirport),
  },
  {
    id: "crossBoundary",
    name: { zh: "過境口岸", en: "Cross-boundary" },
    hint: { zh: "落馬洲 · 深圳灣 · 港珠澳大橋", en: "Lok Ma Chau, Shenzhen Bay, HZMB" },
    accent: "#C0563A",
    matches: (route) =>
      /^B\d/i.test(route.route) || CROSSING.test(route.orig.zh) || CROSSING.test(route.dest.zh),
  },
  {
    id: "crossHarbour",
    name: { zh: "過海路線", en: "Cross-harbour" },
    hint: { zh: "來往港島與九龍新界", en: "Between the Island and Kowloon" },
    accent: "#2F7DB5",
    matches: (route, db) => {
      const stops = stopsOf(route, db);
      return stops.some(onIsland) && stops.some(onMainland);
    },
  },
  {
    // Within the first six so the search screen offers it - the array order
    // is the shop window (Search.tsx shows CATEGORIES.slice(0, 6)).
    id: "tourism",
    name: { zh: "旅遊觀光", en: "Sightseeing" },
    hint: { zh: "山頂 · 海岸 · 開篷觀光巴士", en: "The Peak, coastlines, open-top tours" },
    accent: "#B0487D",
    matches: (route) => scenicSeriesOf(route) !== undefined,
  },
  {
    id: "hsr",
    name: { zh: "高鐵西九龍", en: "West Kowloon HSR" },
    hint: { zh: "W 線", en: "W routes" },
    accent: "#8A5BB5",
    matches: (route) => /^W\d/i.test(route.route),
  },
  {
    id: "express",
    name: { zh: "特快線", en: "Express" },
    hint: { zh: "X 線 · 較少中途站", en: "X routes, fewer stops" },
    accent: "#C08A1E",
    matches: (route) => isBus(route) && /X$/i.test(route.route),
  },
  {
    id: "peak",
    name: { zh: "繁忙時間", en: "Peak hours" },
    hint: { zh: "P 線及特別班次", en: "P routes and special departures" },
    accent: "#B5673A",
    matches: (route) => isBus(route) && /P$/i.test(route.route),
  },
  {
    id: "feeder",
    name: { zh: "港鐵接駁", en: "MTR feeder" },
    hint: { zh: "K 線 · M 線 · 港鐵巴士", en: "K and M routes, MTR buses" },
    accent: "#B4472E",
    matches: (route) =>
      route.co[0] === "lrtfeeder" || /^K\d/i.test(route.route) || /M$/i.test(route.route),
  },
  {
    id: "circular",
    name: { zh: "循環線", en: "Circular" },
    hint: { zh: "起點即終點", en: "Starts and ends in the same place" },
    accent: "#5E8A63",
    matches: (route) => route.orig.en === route.dest.en,
  },
  {
    id: "islands",
    name: { zh: "離島路線", en: "Outlying islands" },
    hint: { zh: "大嶼山 · 長洲 · 南丫", en: "Lantau, Cheung Chau, Lamma" },
    accent: "#009FE3",
    matches: (route) =>
      route.co[0] === "nlb" ||
      route.co[0] === "sunferry" ||
      route.co[0] === "hkkf" ||
      route.co[0] === "fortuneferry",
  },
  {
    id: "kmb",
    name: { zh: "九巴", en: "KMB" },
    hint: { zh: "九巴營運及聯營路線", en: "KMB routes, joint ones included" },
    accent: "#D71920",
    matches: (route) => route.co.includes("kmb"),
  },
  {
    id: "citybus",
    name: { zh: "城巴", en: "Citybus" },
    hint: { zh: "城巴營運及聯營路線", en: "Citybus routes, joint ones included" },
    /* Citybus prints its route numbers on #ffdd00, but the accent is also set
       as text on a white card, where that yellow measures 1.3:1 and cannot be
       read. Darkened into the same mid-tone band as the other accents. */
    accent: "#B79A2B",
    // A 聯營 route is one a rider boards as a Citybus route just as often as a
    // KMB one, so the whole `co` list is searched, not only the lead operator.
    matches: (route) => route.co.includes("ctb"),
  },
  {
    id: "nlb",
    name: { zh: "嶼巴", en: "NLB" },
    hint: { zh: "新大嶼山巴士路線", en: "New Lantao Bus routes" },
    /* Not the brand #009FE3, which outlying islands already carries - two
       tiles in the same blue, one of them a subset of the other, read as a
       duplicate rather than as two ways in. */
    accent: "#0082C4",
    matches: (route) => route.co.includes("nlb"),
  },
  {
    id: "minibus",
    name: { zh: "專線小巴", en: "Minibus" },
    hint: { zh: "綠色專線小巴", en: "Green minibus" },
    accent: "#00843D",
    matches: (route) => route.co[0] === "gmb",
  },
  {
    id: "rail",
    name: { zh: "鐵路", en: "Rail" },
    hint: { zh: "港鐵 · 輕鐵", en: "MTR and Light Rail" },
    accent: "#A32638",
    matches: (route) => route.co[0] === "mtr" || route.co[0] === "lightRail",
  },
  {
    id: "ferry",
    name: { zh: "渡輪", en: "Ferry" },
    hint: { zh: "只有時間表", en: "Timetable only" },
    accent: "#1D6FA3",
    matches: (route) =>
      route.co[0] === "sunferry" || route.co[0] === "hkkf" || route.co[0] === "fortuneferry",
  },
];

export function categoryById(id: string): Category | undefined {
  return CATEGORIES.find((c) => c.id === id);
}

/** A route's two directions, kept together so a wide row can seat both. */
export interface RoutePair {
  out: KeyedRoute;
  back?: KeyedRoute;
}

/**
 * Folds a sorted route list into direction pairs: two consecutive entries of
 * the same number and operator - almost always the outward and return legs -
 * share a pair. Termini are not compared, because they rarely mirror exactly
 * (Citybus 6 runs 中環→赤柱市場 out but 赤柱村→中環 back); a route with a
 * third variant simply starts another pair.
 */
export function pairDirections(routes: KeyedRoute[]): RoutePair[] {
  const pairs: RoutePair[] = [];
  for (const route of routes) {
    const last = pairs[pairs.length - 1];
    if (
      last?.back === undefined &&
      last?.out.route === route.route &&
      last.out.co[0] === route.co[0]
    ) {
      last.back = route;
    } else {
      pairs.push({ out: route });
    }
  }
  return pairs;
}

/**
 * Routes in a category, one entry per route number and direction pair.
 *
 * The database stores a separate entry per service type, which would show the
 * same route several times over; only the first is kept.
 */
export function routesInCategory(db: RouteDb, category: Category, limit = 300): KeyedRoute[] {
  const seen = new Set<string>();
  const out: KeyedRoute[] = [];

  for (const key in db.routeList) {
    const entry = db.routeList[key];
    if (!entry) continue;
    const route: KeyedRoute = { ...entry, key };
    if (!category.matches(route, db)) continue;

    const identity = `${route.route}/${route.dest.en}/${route.co[0]}`;
    if (seen.has(identity)) continue;
    seen.add(identity);
    out.push(route);
    if (out.length >= limit) break;
  }

  return out.sort((a, b) => a.route.localeCompare(b.route, "en", { numeric: true }));
}

/**
 * How many routes each category holds.
 *
 * Takes the categories to count rather than always counting all of them: the
 * search screen shows six and would otherwise pay for seventeen, and the
 * expensive predicates here are the ones that read a route's whole stop list.
 */
export function categoryCounts(
  db: RouteDb,
  categories: Category[] = CATEGORIES,
): Record<CategoryId, number> {
  const counts = Object.fromEntries(categories.map((c) => [c.id, 0])) as Record<CategoryId, number>;
  const seen = new Map<CategoryId, Set<string>>(categories.map((c) => [c.id, new Set()]));

  for (const key in db.routeList) {
    const entry = db.routeList[key];
    if (!entry) continue;
    const route: KeyedRoute = { ...entry, key };
    const identity = `${route.route}/${route.dest.en}/${route.co[0]}`;

    for (const category of categories) {
      const bucket = seen.get(category.id);
      if (!bucket || bucket.has(identity)) continue;
      if (category.matches(route, db)) {
        bucket.add(identity);
        counts[category.id] += 1;
      }
    }
  }
  return counts;
}
