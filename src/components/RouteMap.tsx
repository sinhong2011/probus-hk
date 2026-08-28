import {
  AttributionControl,
  LngLatBounds,
  Map as MlMap,
  setWorkerUrl,
  type GeoJSONSource,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { FeatureCollection } from "geojson";
import { Show, createEffect, createSignal } from "solid-js";
import { PinIcon, RouteIcon } from "~/components/Icons";
import { t, type Lang } from "~/lib/i18n";
import { fetchRouteShape, type Position } from "~/data/waypoints";
import type { KeyedRoute, StopEntry } from "~/data/types";
import type { LatLng } from "~/lib/geo";
import { plateStyle } from "~/lib/operators";
import { settings } from "~/stores/settings";

/**
 * Keyless CARTO basemaps: no API key, no sign-up, and one style per theme so
 * the map matches the rest of the app instead of glowing white in dark mode.
 * MapLibre renders their required attribution automatically.
 */
const STYLES = {
  dark: "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",
  light: "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json",
};

const SRC_LINE = "mb-route";
const SRC_STOPS = "mb-stops";
const SRC_ME = "mb-me";
const LYR_HIT = "mb-stop-hit";
const ACCENT = "#4ed8ce";

/*
 * MapLibre resolves its worker relative to its own module URL, which does not
 * survive bundling. Pointing it at the copy the build emits is what makes tiles
 * load at all - without this the map stays blank and reports no error.
 */
setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");

function prefersDark(choice: string): boolean {
  if (choice === "dark") return true;
  if (choice === "light") return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

/** Reads the plate colour back out so the line matches the operator's brand. */
function lineColour(route: KeyedRoute): string {
  const style = plateStyle(route.co, route.route);
  if (/^#[0-9a-f]{6}$/i.test(style.background)) return style.background;
  // A joint route has a gradient plate; use the first operator's colour.
  const first = /#([0-9a-f]{6})/i.exec(style.background);
  return first ? `#${first[1]}` : "#d71920";
}

function stopFeatures(
  coords: Position[],
  names: string[],
  nearestIndex?: number,
  selectedIndex?: number,
): FeatureCollection {
  return {
    type: "FeatureCollection",
    features: coords.map((coordinates, index) => ({
      type: "Feature",
      properties: {
        index,
        name: names[index] ?? "",
        terminus: index === 0 || index === coords.length - 1 ? 1 : 0,
        nearest: index === nearestIndex ? 1 : 0,
        selected: index === selectedIndex ? 1 : 0,
      },
      geometry: { type: "Point", coordinates },
    })),
  };
}

function upsertSource(instance: MlMap, id: string, data: FeatureCollection) {
  const existing = instance.getSource(id);
  if (existing) (existing as GeoJSONSource).setData(data);
  else instance.addSource(id, { type: "geojson", data });
}

export function RouteMap(props: {
  route: KeyedRoute;
  stops: { id: string; stop: StopEntry }[];
  /** Stop names, in list order, shown when a stop is picked on the map. */
  stopNames?: string[];
  /** Index of the stop nearest the user, highlighted on the map. */
  nearestIndex?: number;
  /** Index of the stop the list currently has open; the map follows it. */
  selectedIndex?: number;
  /** Picking a stop on the map opens it in the list. */
  onSelectStop?: (index: number) => void;
  me?: LatLng | null;
  /**
   * Tailwind height classes rather than a fixed value, so the map can be taller
   * where there is room for it - the sticky column on a wide screen has a lot
   * of it, and a map you cannot see the shape of the route in is decoration.
   */
  heightClass?: string;
  lang: Lang;
  /** Shown in place of the map when it cannot render. */
  unavailableLabel: string;
}) {
  let container!: HTMLDivElement;
  const [map, setMap] = createSignal<MlMap | null>(null);
  const [shape, setShape] = createSignal<Position[][] | null>(null);
  /**
   * WebGL is not available everywhere - locked-down browsers, some embedded
   * webviews, GPU blocklists - and a basemap that never paints leaves a large
   * black rectangle where the map should be. The map collapses to a slim note
   * instead if it has not finished loading in a few seconds.
   */
  const [usable, setUsable] = createSignal<boolean | null>(null);

  const stopPositions = (): Position[] =>
    props.stops.map((s) => [s.stop.location.lng, s.stop.location.lat]);
  const stopNames = (): string[] => props.stopNames ?? props.stops.map(() => "");

  /*
   * Solid 2 splits every effect: the first function does the reactive reads and
   * the second acts on the result untracked, optionally returning a cleanup.
   */
  createEffect(
    () => prefersDark(settings.theme()),
    (dark) => {
      const instance = new MlMap({
        container,
        style: dark ? STYLES.dark : STYLES.light,
        center: [114.17, 22.31],
        zoom: 10,
        // Added below instead, so it sits bottom-left clear of the route title.
        attributionControl: false,
        // The map sits inside a scrolling page, so it must not swallow drags.
        dragRotate: false,
        /*
         * A map in the middle of a long list will otherwise eat every scroll
         * that starts on top of it. Two fingers pan, and the hint says so in
         * the reader's own language.
         */
        cooperativeGestures: true,
        locale: {
          "CooperativeGesturesHandler.MobileHelpText": t("mapGestureMobile", props.lang),
          "CooperativeGesturesHandler.WindowsHelpText": t("mapGestureDesktop", props.lang),
          "CooperativeGesturesHandler.MacHelpText": t("mapGestureMac", props.lang),
        },
      });

      instance.addControl(new AttributionControl({ compact: true }), "bottom-left");

      // Picking a stop on the map is the fast way into a forty-stop list.
      instance.on("click", LYR_HIT, (event) => {
        const index = event.features?.[0]?.properties?.index;
        if (typeof index === "number") props.onSelectStop?.(index);
      });
      instance.on("mouseenter", LYR_HIT, () => {
        instance.getCanvas().style.cursor = "pointer";
      });
      instance.on("mouseleave", LYR_HIT, () => {
        instance.getCanvas().style.cursor = "";
      });

      instance.on("load", () => {
        // The map is created during layout, so its container may still have
        // been zero-height when MapLibre measured it.
        instance.resize();
        setUsable(true);
        setMap(instance);
      });

      const giveUp = window.setTimeout(() => setUsable((v) => v ?? false), 6_000);

      return () => {
        clearTimeout(giveUp);
        setMap(null);
        instance.remove();
      };
    },
  );

  // Geometry is fetched separately: some routes weigh hundreds of kilobytes, so
  // the map paints immediately and the line arrives when it arrives.
  createEffect(
    () => props.route,
    (route) => {
      let cancelled = false;
      setShape(null);
      void fetchRouteShape(route).then((lines) => {
        if (!cancelled) setShape(lines);
      });
      return () => {
        cancelled = true;
      };
    },
  );

  createEffect(
    () => ({
      instance: map(),
      // Without published geometry, joining the stops is the honest fallback.
      lines: shape() ?? [stopPositions()],
      positions: stopPositions(),
      names: stopNames(),
      colour: lineColour(props.route),
      nearestIndex: props.nearestIndex,
      dark: prefersDark(settings.theme()),
    }),
    ({ instance, lines, positions, names, colour, nearestIndex, dark }) => {
      if (!instance) return;

      upsertSource(instance, SRC_LINE, {
        type: "FeatureCollection",
        features: lines.map((coordinates) => ({
          type: "Feature",
          properties: {},
          geometry: { type: "LineString", coordinates },
        })),
      });
      upsertSource(instance, SRC_STOPS, stopFeatures(positions, names, nearestIndex));

      if (!instance.getLayer("mb-route-line")) {
        instance.addLayer({
          id: "mb-route-casing",
          type: "line",
          source: SRC_LINE,
          layout: { "line-cap": "round", "line-join": "round" },
          paint: {
            "line-color": "#000000",
            "line-opacity": 0.35,
            "line-width": ["interpolate", ["linear"], ["zoom"], 10, 5, 16, 9],
          },
        });
        instance.addLayer({
          id: "mb-route-line",
          type: "line",
          source: SRC_LINE,
          layout: { "line-cap": "round", "line-join": "round" },
          paint: {
            "line-color": colour,
            "line-width": ["interpolate", ["linear"], ["zoom"], 10, 2.5, 16, 5],
          },
        });
        instance.addLayer({
          id: "mb-route-arrows",
          type: "symbol",
          source: SRC_LINE,
          layout: {
            "symbol-placement": "line",
            "symbol-spacing": 110,
            "text-optional": true,
            "text-field": "\u25B6",
            "text-size": 10,
            "text-keep-upright": false,
            "text-allow-overlap": true,
          },
          paint: {
            "text-color": colour,
            "text-halo-color": "#000000",
            "text-halo-width": 1,
            "text-opacity": ["interpolate", ["linear"], ["zoom"], 12, 0, 13, 1],
          },
        });
        instance.addLayer({
          id: "mb-stop-dots",
          type: "circle",
          source: SRC_STOPS,
          paint: {
            "circle-radius": [
              "interpolate",
              ["linear"],
              ["zoom"],
              11,
              ["case", ["==", ["get", "terminus"], 1], 3, 0],
              13,
              ["case", ["==", ["get", "terminus"], 1], 4, 1.5],
              16,
              ["case", ["==", ["get", "terminus"], 1], 6, 4],
            ],
            "circle-color": ["case", ["==", ["get", "terminus"], 1], colour, "rgba(0,0,0,0)"],
            "circle-stroke-color": colour,
            "circle-stroke-width": [
              "interpolate",
              ["linear"],
              ["zoom"],
              11,
              0.5,
              13,
              1.2,
              16,
              2.5,
            ],
          },
        });
        /*
         * A stop dot is four pixels across at best, which is nothing to aim a
         * thumb at. This invisible circle is what actually receives the tap.
         */
        instance.addLayer({
          id: LYR_HIT,
          type: "circle",
          source: SRC_STOPS,
          paint: { "circle-radius": 14, "circle-color": "rgba(0,0,0,0)" },
        });

        instance.addLayer({
          id: "mb-stop-selected",
          type: "circle",
          source: SRC_STOPS,
          filter: ["==", ["get", "selected"], 1],
          paint: {
            "circle-radius": 7,
            "circle-color": colour,
            "circle-stroke-color": "#ffffff",
            "circle-stroke-width": 2.5,
          },
        });

        // Tapping a dot has to say what was tapped, or the map is a guess.
        instance.addLayer({
          id: "mb-stop-label",
          type: "symbol",
          source: SRC_STOPS,
          filter: ["==", ["get", "selected"], 1],
          layout: {
            "text-field": ["get", "name"],
            "text-size": 12,
            "text-offset": [0, -1.5],
            "text-anchor": "bottom",
            "text-allow-overlap": true,
            "text-max-width": 12,
          },
          paint: {
            "text-color": dark ? "#ffffff" : "#111111",
            "text-halo-color": dark ? "#000000" : "#ffffff",
            "text-halo-width": 1.6,
          },
        });
      } else {
        instance.setPaintProperty("mb-route-line", "line-color", colour);
        instance.setPaintProperty("mb-stop-dots", "circle-stroke-color", colour);
        instance.setPaintProperty("mb-stop-selected", "circle-color", colour);
      }

      const bounds = new LngLatBounds();
      for (const line of lines) for (const point of line) bounds.extend(point);
      for (const point of positions) bounds.extend(point);
      if (!bounds.isEmpty()) {
        instance.fitBounds(bounds, { padding: 48, duration: 0, maxZoom: 15 });
      }
    },
  );

  /*
   * Selection lives in its own effect: folding it into the geometry effect
   * would refit the whole route every time a stop is opened, throwing the map
   * back to the top of the line each time.
   */
  createEffect(
    () => ({
      instance: map(),
      positions: stopPositions(),
      names: stopNames(),
      nearestIndex: props.nearestIndex,
      selectedIndex: props.selectedIndex,
    }),
    ({ instance, positions, names, nearestIndex, selectedIndex }) => {
      if (!instance || !instance.getSource(SRC_STOPS)) return;

      upsertSource(instance, SRC_STOPS, stopFeatures(positions, names, nearestIndex, selectedIndex));

      const target = selectedIndex !== undefined ? positions[selectedIndex] : undefined;
      // Only chase the stop if it has gone off screen; panning under a rider
      // who is reading is worse than leaving the map where they put it.
      if (target && !instance.getBounds().contains(target)) {
        instance.easeTo({ center: target, duration: 420 });
      }
    },
  );

  const recentre = () => {
    const instance = map();
    const me = props.me;
    if (instance && me) instance.easeTo({ center: [me.lng, me.lat], zoom: 15, duration: 500 });
  };

  const fitRoute = () => {
    const instance = map();
    if (!instance) return;
    const bounds = new LngLatBounds();
    for (const point of stopPositions()) bounds.extend(point);
    if (!bounds.isEmpty()) instance.fitBounds(bounds, { padding: 48, maxZoom: 15, duration: 500 });
  };

  // The user's own position is a separate source so it updates without
  // touching the route geometry.
  createEffect(
    () => ({ instance: map(), me: props.me }),
    ({ instance, me }) => {
      if (!instance) return;

      upsertSource(instance, SRC_ME, {
        type: "FeatureCollection",
        features: me
          ? [
              {
                type: "Feature",
                properties: {},
                geometry: { type: "Point", coordinates: [me.lng, me.lat] },
              },
            ]
          : [],
      });

      if (!instance.getLayer("mb-me-dot")) {
        instance.addLayer({
          id: "mb-me-halo",
          type: "circle",
          source: SRC_ME,
          paint: { "circle-radius": 17, "circle-color": ACCENT, "circle-opacity": 0.16 },
        });
        instance.addLayer({
          id: "mb-me-dot",
          type: "circle",
          source: SRC_ME,
          paint: {
            "circle-radius": 7,
            "circle-color": ACCENT,
            "circle-stroke-color": "#0c0f14",
            "circle-stroke-width": 2.5,
          },
        });
      }
    },
  );

  const controlClass =
    "mb-press flex size-9 items-center justify-center rounded-full border border-border bg-card/90 text-muted-foreground shadow-card backdrop-blur";

  return (
    <>
      <div class="relative">
        <div
          ref={container}
          // Kept in the layout while loading so MapLibre can measure it, then
          // collapsed if it turns out the map will never paint.
          class={`w-full bg-map ${usable() === false ? "" : (props.heightClass ?? "h-[18rem]")}`}
          style={{ height: usable() === false ? "0" : undefined, overflow: "hidden" }}
          aria-label="route map"
        />

        {/* Panning a map with no way back is a trap; these are the way back. */}
        <Show when={usable()}>
          <div class="absolute right-2.5 top-2.5 flex flex-col gap-2">
            <Show when={props.me}>
              <button
                type="button"
                aria-label={t("mapMyLocation", props.lang)}
                title={t("mapMyLocation", props.lang)}
                onClick={recentre}
                class={controlClass}
              >
                <PinIcon size={15} />
              </button>
            </Show>
            <button
              type="button"
              aria-label={t("mapWholeRoute", props.lang)}
              title={t("mapWholeRoute", props.lang)}
              onClick={fitRoute}
              class={controlClass}
            >
              <RouteIcon size={15} />
            </button>
          </div>
        </Show>
      </div>
      <Show when={usable() === false}>
        <div class="flex items-center justify-center gap-2 border-b border-border bg-secondary px-5 py-2">
          <span class="text-[0.63rem] font-semibold text-subtle-foreground">{props.unavailableLabel}</span>
        </div>
      </Show>
    </>
  );
}

export default RouteMap;
