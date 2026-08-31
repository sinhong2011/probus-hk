import { Map as MlMap, type GeoJSONSource } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { FeatureCollection } from "geojson";
import { For, createEffect, createSignal } from "solid-js";
import { Card } from "~/components/Chrome";
import { Drawer, DrawerHeader } from "~/components/Drawer";
import { t } from "~/lib/i18n";
import {
  MAP_PRIMARY as PRIMARY,
  MAP_STYLES as STYLES,
  addFoldedAttribution,
  prefersDark,
} from "~/lib/mapKit";
import { boundingBox, formatRange, type LatLng } from "~/lib/geo";
import { createWide } from "~/lib/wide";
import { geo } from "~/stores/geolocation";
import { RADIUS_STEPS, settings } from "~/stores/settings";
import { sheets } from "~/stores/sheets";

/**
 * How far "nearby" reaches, chosen by seeing it.
 *
 * A number of metres is a guess until it is drawn: the sheet puts the circle
 * on a map of where the rider is standing, and the slider under it moves the
 * circle as it moves the number. hkbus.app is the reference for the feature -
 * a range you set by eye rather than from a row of presets - but the drawing
 * of it is this app's own.
 */

/** Victoria Harbour: where the map opens before the phone knows better. */
const FALLBACK: LatLng = { lat: 22.31, lng: 114.17 };

const SRC_RANGE = "app-range";
const SRC_ME = "app-range-me";

/** The radius as a polygon: metres converted to degrees at this latitude. */
function circleData(centre: LatLng, radiusM: number): FeatureCollection {
  const dLat = radiusM / 111_320;
  const dLng = radiusM / (111_320 * Math.cos((centre.lat * Math.PI) / 180) || 1);
  const ring: [number, number][] = [];
  for (let i = 0; i <= 72; i += 1) {
    const a = (i / 72) * 2 * Math.PI;
    ring.push([centre.lng + Math.cos(a) * dLng, centre.lat + Math.sin(a) * dLat]);
  }
  return {
    type: "FeatureCollection",
    features: [
      { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [ring] } },
    ],
  };
}

function pointData(at: LatLng): FeatureCollection {
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: {},
        geometry: { type: "Point", coordinates: [at.lng, at.lat] },
      },
    ],
  };
}

export default function RangeSheet(props: {
  /**
   * Rendered inside the settings drawer, as a sheet stacked on it. The shell
   * mounts a second, un-nested copy for the nearby header, which has no
   * drawer to stack on; both are mounted at once and `sheets.rangeNested()`
   * decides which of them the open belongs to.
   */
  nested?: boolean;
}) {
  const lang = settings.lang;
  const wide = createWide();
  const [map, setMap] = createSignal<MlMap | null>(null, { ownedWrite: true });

  /** This copy's open, not the store's: the other copy stays shut. */
  const open = () => sheets.rangeOpen() && sheets.rangeNested() === !!props.nested;

  /*
   * A signal rather than a bare `let`: the map is built when the sheet opens,
   * not when it mounts, and the drawer's portal does not necessarily have its
   * content in the document by then - a plain ref read at that moment can
   * still be undefined, which MapLibre reports as "'container' must be a
   * String or HTMLElement". Read as a signal, the effect simply waits for the
   * node and runs again when it arrives, whichever order the two happen in.
   */
  const [container, setContainer] = createSignal<HTMLDivElement | null>(null, {
    ownedWrite: true,
  });

  /*
   * The notch the thumb rests on: the nearest step to whatever is persisted,
   * so a value from an older build still lands somewhere sensible without
   * being rewritten until the rider actually moves the slider.
   */
  const index = () => {
    const radius = settings.radiusM();
    let best = 0;
    RADIUS_STEPS.forEach((step, i) => {
      if (Math.abs(step - radius) < Math.abs((RADIUS_STEPS[best] ?? 0) - radius)) best = i;
    });
    return best;
  };

  const here = () => geo.position() ?? FALLBACK;

  /*
   * The map lives as long as this copy is open, and is remade when the theme
   * changes under it - the split-effect shape Solid 2 wants: reads first,
   * work untracked, cleanup returned. Tied to the open rather than to the
   * mount because there are two copies of this sheet in the tree and only one
   * of them is ever showing; a map built on mount would mean two live
   * MapLibre instances for a sheet the rider may never open.
   */
  createEffect(
    () => ({ node: container(), dark: open() ? prefersDark(settings.theme()) : null }),
    ({ node, dark }) => {
      if (!node || dark === null) return;
      const at = here();
      const colour = dark ? PRIMARY.dark : PRIMARY.light;
      const instance = new MlMap({
        container: node,
        style: dark ? STYLES.dark : STYLES.light,
        center: [at.lng, at.lat],
        zoom: 14,
        // The camera is driven by the slider; a map you could drag away from
        // your own position would be showing a search that will not happen.
        interactive: false,
        attributionControl: false,
        fadeDuration: 0,
      });
      addFoldedAttribution(instance);

      instance.on("load", () => {
        instance.addSource(SRC_RANGE, {
          type: "geojson",
          data: circleData(at, settings.radiusM()),
        });
        instance.addSource(SRC_ME, { type: "geojson", data: pointData(at) });
        instance.addLayer({
          id: "app-range-fill",
          type: "fill",
          source: SRC_RANGE,
          paint: { "fill-color": colour, "fill-opacity": 0.14 },
        });
        instance.addLayer({
          id: "app-range-line",
          type: "line",
          source: SRC_RANGE,
          paint: { "line-color": colour, "line-opacity": 0.7, "line-width": 1.5 },
        });
        instance.addLayer({
          id: "app-range-me",
          type: "circle",
          source: SRC_ME,
          paint: {
            "circle-radius": 5,
            "circle-color": colour,
            "circle-stroke-color": dark ? "#1a1a1e" : "#ffffff",
            "circle-stroke-width": 2,
          },
        });
        // Created while the drawer may still have been mid-entrance.
        instance.resize();
        setMap(instance);
      });

      /*
       * The sheet is built at the moment it opens, which on a phone is the
       * moment its height starts animating up from nothing: MapLibre reads
       * the container once, gets a box of no height, and paints a grey panel
       * that never recovers. The observer is what tells it the sheet has
       * finished arriving - a single resize on load only holds where the
       * drawer is full-height from the first frame, which the side one is
       * and the bottom one is not.
       */
      const observer = new ResizeObserver(() => instance.resize());
      observer.observe(node);

      return () => {
        observer.disconnect();
        setMap(null);
        instance.remove();
      };
    },
  );

  /*
   * The circle follows the slider and the rider, and the camera follows the
   * circle: the zoom out as the range grows is what says how much more city
   * the new number covers - motion carrying the meaning, not decorating it.
   */
  createEffect(
    () => ({
      instance: map(),
      shown: open(),
      radius: settings.radiusM(),
      at: here(),
    }),
    ({ instance, shown, radius, at }) => {
      if (!instance || !shown) return;
      (instance.getSource(SRC_RANGE) as GeoJSONSource | undefined)?.setData(circleData(at, radius));
      (instance.getSource(SRC_ME) as GeoJSONSource | undefined)?.setData(pointData(at));

      // Next frame: on the sheet's first open the container has only just
      // been given its height, and MapLibre measured it before that.
      const frame = requestAnimationFrame(() => {
        instance.resize();
        const box = boundingBox(at, radius * 1.2);
        instance.fitBounds(
          [
            [box.minLng, box.minLat],
            [box.maxLng, box.maxLat],
          ],
          {
            duration: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 450,
          },
        );
      });
      return () => cancelAnimationFrame(frame);
    },
  );

  return (
    <Drawer
      open={open()}
      onClose={() => sheets.closeRange()}
      nested={props.nested}
      modal
      side={wide() ? "right" : "bottom"}
      scroll={false}
      label={t("searchRange", lang())}
      class={wide() ? "" : "sm:max-w-[32rem]"}
    >
      <DrawerHeader
        title={t("searchRange", lang())}
        onClose={() => sheets.closeRange()}
        closeLabel={t("close", lang())}
      />

      <div class="flex min-h-0 flex-1 flex-col gap-4 px-4 pb-6">
        <div
          ref={setContainer}
          class="h-[44vh] shrink-0 overflow-hidden rounded-xl bg-secondary lg:h-auto lg:min-h-0 lg:flex-1"
        />

        <Card class="flex flex-col gap-3 p-4">
          <div class="flex items-baseline justify-between">
            <span class="text-[0.88rem] font-bold text-foreground">{t("radius", lang())}</span>
            <span class="tnum text-[1.06rem] font-bold tracking-[-0.01em] text-primary">
              {formatRange(settings.radiusM())}
            </span>
          </div>

          {/* The drawer takes every touch that does not declare itself; this
              one is a horizontal drag and says so. */}
          <input
            type="range"
            class="app-range w-full touch-pan-x"
            min="0"
            max={RADIUS_STEPS.length - 1}
            step="1"
            value={index()}
            aria-label={t("radius", lang())}
            aria-valuetext={formatRange(settings.radiusM())}
            style={{ "--fill": `${(index() / (RADIUS_STEPS.length - 1)) * 100}%` }}
            onInput={(event) =>
              settings.setRadiusM(RADIUS_STEPS[Number(event.currentTarget.value)] ?? 400)
            }
          />

          {/* Every notch is also a button: the next step is on the row itself,
              reachable by a tap, not only by dragging a thumb onto it. */}
          <div class="flex items-center justify-between">
            <For each={RADIUS_STEPS}>
              {(step) => (
                <button
                  type="button"
                  onClick={() => settings.setRadiusM(step)}
                  class={[
                    "app-press tnum px-1 py-0.5 text-[0.72rem] transition-colors duration-state",
                    settings.radiusM() === step
                      ? "font-bold text-primary"
                      : "font-semibold text-faint-foreground",
                  ]}
                >
                  {formatRange(step)}
                </button>
              )}
            </For>
          </div>
        </Card>

        <p class="px-0.5 text-[0.75rem] font-medium leading-relaxed text-faint-foreground">
          {t("searchRangeHint", lang())}
        </p>
      </div>
    </Drawer>
  );
}
