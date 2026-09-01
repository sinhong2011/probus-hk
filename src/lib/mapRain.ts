import type { Map as MlMap, RasterTileSource } from "maplibre-gl";

const SRC = "app-rain";
const LYR = "app-rain";

/**
 * RainViewer radar as a raster under the walk (and the route). Dry, or the
 * setting off, means the source is gone - not a transparent overlay sitting
 * there waiting.
 */
export function syncRainRadar(instance: MlMap, tiles: string[] | null, beforeId?: string) {
  const before = beforeId && instance.getLayer(beforeId) ? beforeId : undefined;
  if (!tiles || tiles.length === 0) {
    if (instance.getLayer(LYR)) instance.removeLayer(LYR);
    if (instance.getSource(SRC)) instance.removeSource(SRC);
    return;
  }

  const existing = instance.getSource(SRC) as RasterTileSource | undefined;
  const same = Boolean(existing?.tiles && existing.tiles[0] === tiles[0]);
  if (!same) {
    if (instance.getLayer(LYR)) instance.removeLayer(LYR);
    if (existing) instance.removeSource(SRC);
    instance.addSource(SRC, { type: "raster", tiles, tileSize: 256 });
  }

  if (!instance.getLayer(LYR)) {
    instance.addLayer(
      {
        id: LYR,
        type: "raster",
        source: SRC,
        paint: { "raster-opacity": 0.52, "raster-fade-duration": 0 },
      },
      before,
    );
  } else if (before) {
    instance.moveLayer(LYR, before);
  }
}
