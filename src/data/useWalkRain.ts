import { createMemo, type Accessor } from "solid-js";
import type { LatLng } from "~/lib/geo";
import { settings } from "~/stores/settings";
import { dismissed } from "~/stores/dismissed";
import { observe } from "./observe";
import {
  RAIN_OFFER_ID,
  fetchHkWeather,
  fetchRainTiles,
  hkIsWet,
  rainOfferReady,
  rainfallAt,
  walkRainCopy,
  type HkWeather,
} from "./walkRain";

const WEATHER_MS = 5 * 60_000;

export interface WalkRainView {
  chip: string | null;
  wet: boolean;
  tiles: string[] | null;
  offer: boolean;
}

/**
 * District rain, a walk chip, and radar tiles.
 *
 * Weather is fetched while the setting is on, or while the one-time offer
 * still might appear. Radar tiles are fetched only when the setting is on
 * and Hong Kong is wet - a dry sky does not pull RainViewer.
 */
export function useWalkRain(
  opts: () => { at: LatLng | null; hasWalk: boolean } | null,
): Accessor<WalkRainView | null> {
  const wanted = () => {
    const o = opts();
    if (!o) return false;
    return settings.walkRain() || (o.hasWalk && !dismissed.has(RAIN_OFFER_ID));
  };

  const weather = observe<HkWeather>(() => {
    if (!wanted()) return null;
    return {
      queryKey: ["hk-weather"] as const,
      queryFn: fetchHkWeather,
      staleTime: WEATHER_MS,
      refetchInterval: WEATHER_MS,
      refetchOnWindowFocus: true,
    };
  });

  const tiles = observe<string[] | null>(() => {
    const w = weather.data();
    if (!settings.walkRain() || !w || !hkIsWet(w)) return null;
    return {
      queryKey: ["rainviewer"] as const,
      queryFn: fetchRainTiles,
      staleTime: WEATHER_MS,
      refetchInterval: WEATHER_MS,
      refetchOnWindowFocus: true,
    };
  });

  return createMemo(() => {
    const o = opts();
    const w = weather.data();
    if (!o || !w) return null;
    const wet = hkIsWet(w);
    const mm = o.at ? rainfallAt(w, o.at) : 0;
    const chip =
      settings.walkRain() && o.hasWalk
        ? walkRainCopy({ mm, warning: w.warning, lang: settings.lang() })
        : null;
    return {
      chip,
      wet,
      tiles: settings.walkRain() && wet ? (tiles.data() ?? null) : null,
      offer: rainOfferReady({
        enabled: settings.walkRain(),
        dismissed: dismissed.has(RAIN_OFFER_ID),
        hasWalk: o.hasWalk,
        wet,
      }),
    };
  });
}
