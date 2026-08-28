import type { Bilingual, KeyedRoute, RouteDb } from "./types";
import { routeAt } from "./db";

/**
 * The railway's own names for its lines.
 *
 * The route database knows a line as a code and a pair of termini - "TWL",
 * "Central", "Tsuen Wan" - which is not what anyone calls it. Nobody says "take
 * the Central to Tsuen Wan route"; they say 荃灣綫. These are the ten lines the
 * MTR runs, in the order its own network map lists them.
 */
const LINE_NAMES: Record<string, Bilingual> = {
  TWL: { zh: "荃灣綫", en: "Tsuen Wan Line" },
  KTL: { zh: "觀塘綫", en: "Kwun Tong Line" },
  ISL: { zh: "港島綫", en: "Island Line" },
  TKL: { zh: "將軍澳綫", en: "Tseung Kwan O Line" },
  TCL: { zh: "東涌綫", en: "Tung Chung Line" },
  TML: { zh: "屯馬綫", en: "Tuen Ma Line" },
  EAL: { zh: "東鐵綫", en: "East Rail Line" },
  SIL: { zh: "南港島綫", en: "South Island Line" },
  DRL: { zh: "迪士尼綫", en: "Disneyland Resort Line" },
  AEL: { zh: "機場快綫", en: "Airport Express" },
};

/** Map order is the order the MTR itself lists them, so it is kept. */
const LINE_ORDER = Object.keys(LINE_NAMES);

export interface RailLine {
  /** Line code, e.g. "TWL". */
  code: string;
  name: Bilingual;
  /** Every direction the line runs, each its own route. */
  directions: KeyedRoute[];
  /** Stations on the longest direction - the length of the line. */
  stations: number;
}

/**
 * The heavy-rail network, grouped into lines rather than listed as routes.
 *
 * A line is several routes: two directions, and on East Rail and Tseung Kwan O
 * more than two, because they branch. Presenting those as separate entries in a
 * flat list is how a ten-line railway turns into twenty-four things that look
 * like bus routes.
 */
export function railLines(db: RouteDb): RailLine[] {
  const byCode = new Map<string, KeyedRoute[]>();

  for (const key in db.routeList) {
    const entry = db.routeList[key];
    if (entry?.co[0] !== "mtr") continue;
    const route = routeAt(db, key);
    if (!route) continue;
    const list = byCode.get(route.route) ?? [];
    list.push(route);
    byCode.set(route.route, list);
  }

  return [...byCode.entries()]
    .map(([code, directions]) => ({
      code,
      name: LINE_NAMES[code] ?? { zh: code, en: code },
      directions: directions.sort((a, b) => a.key.localeCompare(b.key)),
      stations: Math.max(...directions.map((r) => r.stops.mtr?.length ?? 0)),
    }))
    .sort((a, b) => {
      const rank = (code: string) => {
        const at = LINE_ORDER.indexOf(code);
        return at < 0 ? LINE_ORDER.length : at;
      };
      return rank(a.code) - rank(b.code);
    });
}

/**
 * Light rail, one entry per route number.
 *
 * Unlike heavy rail these really are route numbers, so they stay a list - but
 * they are still a railway, and belong beside it rather than buried among two
 * thousand bus routes.
 */
export function lightRailRoutes(db: RouteDb): KeyedRoute[] {
  const out: KeyedRoute[] = [];
  for (const key in db.routeList) {
    if (db.routeList[key]?.co[0] !== "lightRail") continue;
    const route = routeAt(db, key);
    if (route) out.push(route);
  }
  return out.sort(
    (a, b) => a.route.localeCompare(b.route, undefined, { numeric: true }) || a.key.localeCompare(b.key),
  );
}
