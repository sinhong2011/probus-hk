import type { Company, KeyedRoute, RouteDb } from "./types";
import { SCENIC_SERIES, type ScenicSeries } from "./categories";
import { routeAt } from "./db";

/**
 * Routes a rider in Hong Kong can name without looking them up.
 *
 * The home screen fills itself from where the phone is; until it knows, or
 * if it never will, this is what it shows instead. They are chosen for being
 * known, not for being nearby: the cross-harbour tunnel routes everyone has
 * waited for, the airport buses, the old numbers along Nathan Road. Only the
 * ones the route database actually has are shown, in this order.
 */
const PRESETS: [route: string, co: Company][] = [
  ["1", "kmb"],
  ["102", "kmb"],
  ["104", "kmb"],
  ["118", "kmb"],
  ["6", "kmb"],
  ["2", "kmb"],
  ["A21", "ctb"],
  ["E23", "ctb"],
  ["1", "ctb"],
  ["1", "nlb"],
  ["960", "kmb"],
  ["968", "kmb"],
];

/** How many to show; past this the list is a browse, and there is a screen for that. */
const LIMIT = 8;

export function presetRoutes(db: RouteDb): KeyedRoute[] {
  const out: KeyedRoute[] = [];
  const seen = new Set<string>();
  for (const [number, co] of PRESETS) {
    if (out.length >= LIMIT) break;
    const route = lookup(db, number, co, seen);
    if (!route) continue;
    seen.add(route.route + co);
    out.push(route);
  }
  return out;
}

function lookup(
  db: RouteDb,
  number: string,
  co: string,
  seen: Set<string>,
): KeyedRoute | undefined {
  const key = Object.keys(db.routeList).find((k) => {
    const entry = db.routeList[k];
    return entry?.route === number && entry.co[0] === co && !seen.has(entry.route + co);
  });
  return key ? routeAt(db, key) : undefined;
}

/** A scenic route with the themed series it fronts for. */
export interface ScenicHighlight {
  route: KeyedRoute;
  series: ScenicSeries;
}

/**
 * One route per scenic series - the first of each list the database can
 * resolve - so the home screen shows the breadth of the city's viewpoints
 * rather than six numbers from the same coast.
 */
export function scenicHighlights(db: RouteDb): ScenicHighlight[] {
  const out: ScenicHighlight[] = [];
  const seen = new Set<string>();
  for (const series of SCENIC_SERIES) {
    for (const token of series.routes) {
      const [co, number] = token.split(" ");
      if (!co || !number) continue;
      const route = lookup(db, number, co, seen);
      if (!route) continue;
      seen.add(route.route + co);
      out.push({ route, series });
      break;
    }
  }
  return out;
}
