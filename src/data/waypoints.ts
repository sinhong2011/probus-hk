import type { KeyedRoute } from "./types";

const BASE = "https://hkbus.github.io/route-waypoints";

/**
 * hkbus publishes road-following geometry crawled from CSDI, so a route can be
 * drawn along the streets it actually uses instead of as straight hops between
 * stops. The naming scheme differs per mode.
 */
export function waypointUrl(route: KeyedRoute): string | null {
  const co = route.co[0];
  if (!co) return null;

  const bound = route.bound[co] === "I" ? "I" : "O";

  switch (co) {
    case "mtr":
      return `${BASE}/${route.route}.json`;
    case "lightRail":
      return `${BASE}/${route.route}_${bound}.json`;
    case "sunferry":
    case "hkkf":
    case "fortuneferry":
      return route.gtfsId ? `${BASE}/${route.gtfsId}.json` : null;
    default:
      return route.gtfsId ? `${BASE}/${route.gtfsId}-${bound}.json` : null;
  }
}

/** Longitude/latitude pairs, the order GeoJSON and MapLibre expect. */
export type Position = [number, number];

function collectLines(geojson: unknown): Position[][] {
  const features = (geojson as { features?: unknown[] })?.features;
  if (!Array.isArray(features)) return [];

  const lines: Position[][] = [];
  for (const feature of features) {
    const geometry = (feature as { geometry?: { type?: string; coordinates?: unknown } })?.geometry;
    if (!geometry) continue;

    if (geometry.type === "LineString") {
      lines.push(geometry.coordinates as Position[]);
    } else if (geometry.type === "MultiLineString") {
      lines.push(...(geometry.coordinates as Position[][]));
    }
  }
  return lines;
}

/**
 * Route geometry, or `null` when none is published - the caller then falls back
 * to joining the stops. Some routes weigh several hundred kilobytes, so this is
 * only ever fetched when a map is actually shown.
 */
export async function fetchRouteShape(route: KeyedRoute): Promise<Position[][] | null> {
  const url = waypointUrl(route);
  if (!url) return null;

  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const lines = collectLines(await res.json());
    return lines.length > 0 ? lines : null;
  } catch {
    return null;
  }
}
