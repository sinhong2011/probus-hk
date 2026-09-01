import { distanceM, type LatLng } from "~/lib/geo";
import { t, type Lang } from "~/lib/i18n";

/**
 * Walk-to-the-stop weather: HKO district rain and warnings, not a street
 * forecast, and not a walking router.
 */

/** The 18 districts HKO publishes hourly rain for, with a centroid to match a point. */
export const DISTRICTS: { zh: string; en: string; lat: number; lng: number }[] = [
  { zh: "中西區", en: "Central & Western District", lat: 22.2849, lng: 114.1548 },
  { zh: "灣仔", en: "Wan Chai", lat: 22.277, lng: 114.173 },
  { zh: "東區", en: "Eastern District", lat: 22.284, lng: 114.224 },
  { zh: "南區", en: "Southern District", lat: 22.247, lng: 114.159 },
  { zh: "油尖旺", en: "Yau Tsim Mong", lat: 22.312, lng: 114.171 },
  { zh: "深水埗", en: "Sham Shui Po", lat: 22.331, lng: 114.162 },
  { zh: "九龍城", en: "Kowloon City", lat: 22.328, lng: 114.192 },
  { zh: "黃大仙", en: "Wong Tai Sin", lat: 22.342, lng: 114.194 },
  { zh: "觀塘", en: "Kwun Tong", lat: 22.313, lng: 114.226 },
  { zh: "葵青", en: "Kwai Tsing", lat: 22.355, lng: 114.127 },
  { zh: "荃灣", en: "Tsuen Wan", lat: 22.371, lng: 114.114 },
  { zh: "屯門", en: "Tuen Mun", lat: 22.391, lng: 113.976 },
  { zh: "元朗", en: "Yuen Long", lat: 22.444, lng: 114.022 },
  { zh: "北區", en: "North District", lat: 22.494, lng: 114.138 },
  { zh: "大埔", en: "Tai Po", lat: 22.451, lng: 114.169 },
  { zh: "沙田", en: "Sha Tin", lat: 22.387, lng: 114.195 },
  { zh: "西貢", en: "Sai Kung", lat: 22.382, lng: 114.273 },
  { zh: "離島區", en: "Islands District", lat: 22.286, lng: 113.943 },
];

export function districtOf(at: LatLng): (typeof DISTRICTS)[number] {
  let best = DISTRICTS[0]!;
  let nearest = Infinity;
  for (const district of DISTRICTS) {
    const metres = distanceM(at, district);
    if (metres < nearest) {
      nearest = metres;
      best = district;
    }
  }
  return best;
}

export interface DistrictRain {
  place: string;
  maxMm: number;
}

export type RainWarning = "none" | "thunder" | "rainstorm";

export interface HkWeather {
  rainfall: DistrictRain[];
  warning: RainWarning;
}

export function parseRhrread(raw: unknown): DistrictRain[] {
  if (!raw || typeof raw !== "object") return [];
  const rainfall = (raw as { rainfall?: { data?: unknown } }).rainfall?.data;
  if (!Array.isArray(rainfall)) return [];
  const rows: DistrictRain[] = [];
  for (const row of rainfall) {
    if (!row || typeof row !== "object") continue;
    const place = (row as { place?: unknown }).place;
    const max = Number((row as { max?: unknown }).max);
    if (typeof place !== "string") continue;
    rows.push({ place, maxMm: Number.isFinite(max) ? max : 0 });
  }
  return rows;
}

export function parseWarnsum(raw: unknown): RainWarning {
  if (!raw || typeof raw !== "object") return "none";
  const codes = Object.keys(raw as object);
  if (codes.some((code) => code.startsWith("WRAIN"))) return "rainstorm";
  if (codes.includes("WTS")) return "thunder";
  return "none";
}

export function rainfallAt(weather: HkWeather, at: LatLng): number {
  const district = districtOf(at);
  const row = weather.rainfall.find(
    (entry) => entry.place === district.zh || entry.place === district.en,
  );
  return row?.maxMm ?? 0;
}

/** Any district wet, or a rain warning — enough to put radar on the map. */
export function hkIsWet(weather: HkWeather): boolean {
  if (weather.warning !== "none") return true;
  return weather.rainfall.some((row) => row.maxMm > 0);
}

export function walkRainCopy(args: {
  mm: number;
  warning: RainWarning;
  lang: Lang;
}): string | null {
  if (args.mm > 0) return t("rainWalkWet", args.lang);
  if (args.warning === "rainstorm") return t("rainWalkStorm", args.lang);
  if (args.warning === "thunder") return t("rainWalkThunder", args.lang);
  return null;
}

export const RAIN_OFFER_ID = "walk-rain-offer";
export const RAIN_OFFER_DELAY_MS = 1_800;

export function rainOfferReady(args: {
  enabled: boolean;
  dismissed: boolean;
  hasWalk: boolean;
  wet: boolean;
}): boolean {
  return !args.enabled && !args.dismissed && args.hasWalk && args.wet;
}

export const HKO_RHRREAD =
  "https://data.weather.gov.hk/weatherAPI/opendata/weather.php?dataType=rhrread&lang=tc";
export const HKO_WARNSUM =
  "https://data.weather.gov.hk/weatherAPI/opendata/weather.php?dataType=warnsum&lang=tc";
export const RAINVIEWER_MAPS = "https://api.rainviewer.com/public/weather-maps.json";

/**
 * RainViewer radar tiles stop at z7. A request past that returns a PNG
 * that says "Zoom Level Not Supported", which would cover the walk the
 * rider is actually looking at. MapLibre overzooms from this instead.
 */
export const RAIN_TILE_MAX_ZOOM = 7;

export function radarTileUrls(raw: unknown): string[] | null {
  if (!raw || typeof raw !== "object") return null;
  const host = (raw as { host?: unknown }).host;
  const past = (raw as { radar?: { past?: unknown } }).radar?.past;
  if (typeof host !== "string" || !Array.isArray(past) || past.length === 0) return null;
  const last = past[past.length - 1] as { path?: unknown };
  if (typeof last?.path !== "string") return null;
  return [`${host}${last.path}/256/{z}/{x}/{y}/2/1_1.png`];
}

export async function fetchHkWeather(): Promise<HkWeather> {
  const rhr = await fetch(HKO_RHRREAD);
  if (!rhr.ok) throw new Error(`rhrread ${rhr.status}`);
  const rainfall = parseRhrread(await rhr.json());
  let warning: RainWarning = "none";
  try {
    const warn = await fetch(HKO_WARNSUM);
    if (warn.ok) warning = parseWarnsum(await warn.json());
  } catch {
    /* Rainfall is the answer; a warning that did not arrive is none. */
  }
  return { rainfall, warning };
}

export async function fetchRainTiles(): Promise<string[] | null> {
  const res = await fetch(RAINVIEWER_MAPS);
  if (!res.ok) throw new Error(`rainviewer ${res.status}`);
  return radarTileUrls(await res.json());
}
