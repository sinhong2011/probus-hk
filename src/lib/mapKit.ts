import { setWorkerUrl, type GeoJSONSource, type Map as MlMap } from "maplibre-gl";
import type { FeatureCollection } from "geojson";
import type { KeyedRoute } from "~/data/types";
import { plateStyle } from "~/lib/operators";

/**
 * The pieces every map in the app shares - the route map, the explore stage
 * under search and planning, whatever comes next. They were RouteMap's own
 * until a second map needed all of them, and a basemap that loads its style
 * from one place is a basemap that looks the same everywhere.
 */

/**
 * Keyless CARTO basemaps: no API key, no sign-up, and one style per theme so
 * the map matches the rest of the app instead of glowing white in dark mode.
 * MapLibre renders their required attribution automatically.
 */
export const MAP_STYLES = {
  dark: "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",
  light: "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json",
};

/** The teal the app marks "you are here" with, on maps as in lists. */
export const MAP_ACCENT = "#4ed8ce";

/*
 * MapLibre cannot read `var(--primary)` and cannot parse the oklch() behind
 * it, so anything drawn in the app's own colour wears the nearest hex of the
 * primary in each theme.
 */
export const MAP_PRIMARY = { light: "#5a52d5", dark: "#8886ec" };

/*
 * MapLibre resolves its worker relative to its own module URL, which does not
 * survive bundling. Pointing it at the copy the build emits is what makes tiles
 * load at all - without this the map stays blank and reports no error.
 */
setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");

export function prefersDark(choice: string): boolean {
  if (choice === "dark") return true;
  if (choice === "light") return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

/** Reads the plate colour back out so a line matches the operator's brand. */
export function lineColour(route: KeyedRoute): string {
  const style = plateStyle(route.co, route.route);
  if (/^#[0-9a-f]{6}$/i.test(style.background)) return style.background;
  // A joint route has a gradient plate; use the first operator's colour.
  const first = /#([0-9a-f]{6})/i.exec(style.background);
  return first ? `#${first[1]}` : "#d71920";
}

export function upsertSource(instance: MlMap, id: string, data: FeatureCollection) {
  const existing = instance.getSource(id);
  if (existing) (existing as GeoJSONSource).setData(data);
  else instance.addSource(id, { type: "geojson", data });
}
