import type { FeatureCollection } from "geojson";
import type { Map as MlMap } from "maplibre-gl";
import { sunRideStrokes, type RideSunStroke } from "~/data/tripSun";
import type { MeasuredLine } from "~/lib/alongLine";
import { upsertSource } from "./mapKit";

/** Shade where the recommended window is the dark one. */
export const SUN_SHADE = "#3ec9b0";
/** Sun where that same window is the bright one. */
export const SUN_SUN = "#e07a3d";
/** Overhead: neither window wins. */
export const SUN_OVERHEAD = "#8b929c";

const EMPTY: FeatureCollection = { type: "FeatureCollection", features: [] };

export function strokesToSunCollection(strokes: RideSunStroke[]): FeatureCollection {
  return {
    type: "FeatureCollection",
    features: strokes.map((stroke) => ({
      type: "Feature" as const,
      properties: { tone: stroke.tone },
      geometry: { type: "LineString" as const, coordinates: stroke.coordinates },
    })),
  };
}

export function sunRideCollection(args: {
  line: MeasuredLine;
  from: number;
  to: number;
  departAt: Date;
  arriveAt: Date;
}): FeatureCollection {
  return strokesToSunCollection(sunRideStrokes(args));
}

/**
 * The overpaint layer both maps share: same colours, same width, on top of
 * the operator line and under labels / walking.
 */
export function ensureSunRideLayer(
  instance: MlMap,
  sourceId: string,
  layerId: string,
  beforeId?: string,
) {
  if (!instance.getSource(sourceId)) {
    instance.addSource(sourceId, { type: "geojson", data: EMPTY });
  }
  if (instance.getLayer(layerId)) return;
  const before = beforeId && instance.getLayer(beforeId) ? beforeId : undefined;
  instance.addLayer(
    {
      id: layerId,
      type: "line",
      source: sourceId,
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": ["match", ["get", "tone"], "shade", SUN_SHADE, "sun", SUN_SUN, SUN_OVERHEAD],
        "line-width": ["interpolate", ["linear"], ["zoom"], 10, 3.5, 16, 7],
        "line-opacity": 0.9,
      },
    },
    before,
  );
}

export function paintSunRide(instance: MlMap, sourceId: string, data: FeatureCollection) {
  upsertSource(instance, sourceId, data);
  const tones = [
    ...new Set(
      data.features.map((feature) =>
        typeof feature.properties?.tone === "string" ? feature.properties.tone : "",
      ),
    ),
  ].filter(Boolean);
  const el = instance.getContainer();
  if (tones.length) el.dataset.sunRide = tones.join(" ");
  else delete el.dataset.sunRide;
}

export function clearSunRide(instance: MlMap, sourceId: string) {
  paintSunRide(instance, sourceId, EMPTY);
}
