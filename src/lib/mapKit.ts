import {
  AttributionControl,
  setWorkerUrl,
  type GeoJSONSource,
  type Map as MlMap,
} from "maplibre-gl";
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

/**
 * The glass corner button every map control wears. One string rather than a
 * component: each map decides which controls it earns and where they stand,
 * but a rider moving between maps should never meet the same control in a
 * different coat.
 */
export const MAP_CONTROL =
  "app-press app-glass flex size-[1.6rem] items-center justify-center rounded-full text-foreground lg:size-9 " +
  // Quiet until wanted: the chrome sits over the picture, so at rest it
  // recedes with the same translucency as the status line, and comes back
  // to full strength under the pointer or the finger.
  "opacity-75 transition-opacity duration-state hover:opacity-100 active:opacity-100";

export function upsertSource(instance: MlMap, id: string, data: FeatureCollection) {
  const existing = instance.getSource(id);
  if (existing) (existing as GeoJSONSource).setData(data);
  else instance.addSource(id, { type: "geojson", data });
}

/**
 * The attribution pill, folded to its ⓘ from the start.
 *
 * MapLibre's compact control unfolds itself once the style's credits arrive
 * and stays unfolded until the rider closes it - a licence notice lying
 * across the corner of every map. The licences ask that the credit be
 * reachable, and it still is, one tap behind the ⓘ; it just no longer
 * arrives already open. Folded again after `load` and the next `idle`
 * because the control opens itself only when the first credits land, and
 * which side of "now" that falls on depends on how the map came up.
 */
export function addFoldedAttribution(instance: MlMap) {
  // Top left: out of the way of the thumb corners, where the working
  // controls live.
  instance.addControl(new AttributionControl({ compact: true }), "top-left");
  const fold = () => {
    const pill = instance
      .getContainer()
      .querySelector<HTMLDetailsElement>(".maplibregl-ctrl-attrib");
    if (!pill) return;
    pill.classList.remove("maplibregl-compact-show");
    // Same coat as every other corner control; the shape and the re-inked
    // icon are in app.css, under the maplibregl overrides.
    pill.classList.add("app-glass");
    /*
     * The control is a <details>, and a closed <details> does not render its
     * content - a box that does not exist cannot animate, which made the
     * pill snap instead of unfold. So the element stays `open` for good and
     * the folding is entirely the `compact-show` class the library toggles.
     * The library flips the attribute opposite to each toggle expecting the
     * summary's native action to flip it straight back; this listener runs
     * after the library's, pins the attribute open, and prevents the native
     * flip - whichever of the two would have closed the box, it stays.
     */
    pill.open = true;
    if (!pill.dataset.appAttrib) {
      pill.dataset.appAttrib = "1";
      pill.querySelector(".maplibregl-ctrl-attrib-button")?.addEventListener("click", (event) => {
        event.preventDefault();
        pill.open = true;
      });
    }
  };
  fold();
  instance.once("load", fold);
  instance.once("idle", fold);
}
