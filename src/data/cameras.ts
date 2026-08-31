import { createSignal } from "solid-js";
import { distanceM, type LatLng } from "~/lib/geo";
import type { Bilingual } from "~/data/types";

/**
 * The Transport Department's traffic cameras, for the stop that wants one.
 *
 * An arrival time says when the bus is due; a camera says whether the road it
 * is due along is moving. The pictures live on the department's own CDN with
 * open CORS, refreshed every two minutes, so showing one costs the app
 * nothing but an `<img>`. The locations do not - they are published as XML on
 * a host the browser cannot read - so `scripts/build-cameras.ts` folds them
 * into the file fetched here.
 *
 * It is a tenth of a megabyte and most pages never ask, so like the rail
 * fares it is fetched once, on the first stop that opens near a camera.
 */
const INDEX_URL = "/cameras.json";
const IMAGE_BASE = "https://tdcctv.data.one.gov.hk";

/**
 * How far a camera may be from a stop and still be offered. A junction camera
 * two streets over shows somebody else's traffic; at 400 m it is still the
 * road the rider is looking down.
 */
export const CAMERA_RANGE_M = 400;

/** How often the department takes a new picture. */
export const CAMERA_REFRESH_MS = 120_000;

/** [key, latitude, longitude, English name, Chinese name]. */
type Row = [string, number, number, string, string];

interface Index {
  generated: string;
  cameras: Row[];
}

export interface Camera {
  key: string;
  location: LatLng;
  name: Bilingual;
}

export interface NearbyCamera {
  camera: Camera;
  metres: number;
}

let list: Camera[] | null = null;
let pending: Promise<void> | null = null;

/*
 * The index arrives after the row that wants it has rendered, and a camera is
 * a bonus, not the page - so the load is a plain fetch and this counter is
 * what makes the button appear when it lands.
 */
const [loaded, setLoaded] = createSignal(0);

function load() {
  pending ??= fetch(INDEX_URL)
    .then((res) => (res.ok ? (res.json() as Promise<Index>) : null))
    .then((data) => {
      if (!data?.cameras) return;
      list = data.cameras.map(([key, lat, lng, en, zh]) => ({
        key,
        location: { lat, lng },
        name: { en, zh },
      }));
    })
    // Offline, or the asset is missing: the button is simply not shown.
    .catch(() => undefined)
    .finally(() => setLoaded((n) => n + 1));
}

/** The closest camera within range, from a given list. */
export function nearestOf(
  cameras: Camera[],
  location: LatLng,
  rangeM: number = CAMERA_RANGE_M,
): NearbyCamera | null {
  let best: NearbyCamera | null = null;
  // A cheap gate before the trigonometry: at Hong Kong's latitude a degree of
  // latitude is ~111 km and one of longitude ~103 km, so anything outside
  // this box is outside the range too.
  const latMargin = rangeM / 111_000;
  const lngMargin = rangeM / 103_000;
  for (const camera of cameras) {
    if (
      Math.abs(camera.location.lat - location.lat) > latMargin ||
      Math.abs(camera.location.lng - location.lng) > lngMargin
    ) {
      continue;
    }
    const metres = distanceM(location, camera.location);
    if (metres <= rangeM && (!best || metres < best.metres)) {
      best = { camera, metres };
    }
  }
  return best;
}

/**
 * The closest camera within range of a stop, or `null` while the index is
 * still coming - and for the many stops no camera watches.
 */
export function nearestCamera(location: LatLng): NearbyCamera | null {
  loaded();
  if (!list) {
    load();
    return null;
  }
  return nearestOf(list, location);
}

/**
 * The picture's address. The CDN keeps one URL per camera and swaps the bytes
 * behind it, so a refresh needs a changed URL to get past the browser's
 * cache; the caller passes the tick it is refreshing on.
 */
export function cameraImage(key: string, tick: number): string {
  return `${IMAGE_BASE}/${encodeURIComponent(key)}.JPG?t=${tick}`;
}
