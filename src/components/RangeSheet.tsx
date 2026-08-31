import { AttributionControl, Map as MlMap, type GeoJSONSource } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { FeatureCollection } from "geojson";
import { For, createEffect, createSignal } from "solid-js";
import { Card } from "~/components/Chrome";
import { Drawer, DrawerHeader } from "~/components/Drawer";
import { t } from "~/lib/i18n";
import { MAP_PRIMARY as PRIMARY, MAP_STYLES as STYLES, prefersDark } from "~/lib/mapKit";
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

export default function RangeSheet() {
  const lang = settings.lang;
  const wide = createWide();
  const [map, setMap] = createSignal<MlMap | null>(null, { ownedWrite: true });

  let container!: HTMLDivElement;

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
   * The map lives as long as the sheet's code does and is remade only when
   * the theme changes under it - the same lifecycle as the route map's, and
   * the same split-effect shape Solid 2 wants: reads first, work untracked,
   * cleanup returned.
   */
  createEffect(
    () => prefersDark(settings.theme()),
    (dark) => {
      const at = here();
      const colour = dark ? PRIMARY.dark : PRIMARY.light;
      const instance = new MlMap({
        container,
        style: dark ? STYLES.dark : STYLES.light,
        center: [at.lng, at.lat],
        zoom: 14,
        // The camera is driven by the slider; a map you could drag away from
        // your own position would be showing a search that will not happen.
        interactive: false,
        attributionControl: false,
        fadeDuration: 0,
      });
      instance.addControl(new AttributionControl({ compact: true }), "bottom-left");

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

      return () => {
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
      open: sheets.rangeOpen(),
      radius: settings.radiusM(),
      at: here(),
    }),
    ({ instance, open, radius, at }) => {
      if (!instance || !open) return;
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
      open={sheets.rangeOpen()}
      onClose={() => sheets.closeRange()}
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
          ref={container}
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
