import type { Map as MlMap, RasterSourceSpecification, RasterTileSource } from "maplibre-gl";
import { RAIN_TILE_MAX_ZOOM } from "~/data/walkRain";

const SRC = "app-rain";
const LYR = "app-rain";

export function rainRasterSpec(tiles: string[]): RasterSourceSpecification {
  return {
    type: "raster",
    tiles,
    tileSize: 256,
    minzoom: 0,
    maxzoom: RAIN_TILE_MAX_ZOOM,
  };
}

/**
 * RainViewer radar as a raster under the walk (and the route). Dry, or the
 * setting off, means the source is gone - not a transparent overlay sitting
 * there waiting.
 *
 * The source's maxzoom is RainViewer's, not the map's: street zoom still
 * shows the last real radar tile, stretched, instead of their placeholder.
 */
export function syncRainRadar(instance: MlMap, tiles: string[] | null, beforeId?: string) {
  const before = beforeId && instance.getLayer(beforeId) ? beforeId : undefined;
  if (!tiles || tiles.length === 0) {
    if (instance.getLayer(LYR)) instance.removeLayer(LYR);
    if (instance.getSource(SRC)) instance.removeSource(SRC);
    return;
  }

  const existing = instance.getSource(SRC) as RasterTileSource | undefined;
  const same = Boolean(
    existing?.tiles && existing.tiles[0] === tiles[0] && existing.maxzoom === RAIN_TILE_MAX_ZOOM,
  );
  if (!same) {
    if (instance.getLayer(LYR)) instance.removeLayer(LYR);
    if (existing) instance.removeSource(SRC);
    instance.addSource(SRC, rainRasterSpec(tiles));
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
