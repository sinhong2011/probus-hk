import type { LatLng } from "~/lib/geo";
import type { Lang } from "~/lib/i18n";

export type MapProvider = "google" | "apple" | "geo";

const coords = (location: LatLng) => ({
  lat: location.lat.toFixed(6),
  lng: location.lng.toFixed(6),
});

/**
 * Google Maps, centred on a point.
 *
 * Most riders already have it on their phone; `api=1` opens the app when
 * installed rather than leaving them on the web view.
 */
export function googleMapsLink(location: LatLng): string {
  const { lat, lng } = coords(location);
  const params = new URLSearchParams({ api: "1", query: `${lat},${lng}` });
  return `https://www.google.com/maps/search/?${params}`;
}

/** Apple Maps, centred on a point. Opens the app on iPhone and Mac. */
export function appleMapsLink(location: LatLng): string {
  const { lat, lng } = coords(location);
  const params = new URLSearchParams({ ll: `${lat},${lng}`, q: `${lat},${lng}` });
  return `https://maps.apple.com/?${params}`;
}

/**
 * The Lands Department's GeoInfo Map, centred on a point.
 *
 * HKeMobility and the department's own traffic pages use this as their base
 * map - the official chart of Hong Kong rather than a commercial one.
 */
export function geoInfoMapLink(location: LatLng, lang: Lang): string {
  const { lat, lng } = coords(location);
  const params = new URLSearchParams({
    lg: lang === "zh" ? "tc" : "en",
    lat,
    lon: lng,
    zoom: "18",
  });
  return `https://www.map.gov.hk/gm/?${params}`;
}

export function mapLink(provider: MapProvider, location: LatLng, lang: Lang): string {
  switch (provider) {
    case "google":
      return googleMapsLink(location);
    case "apple":
      return appleMapsLink(location);
    case "geo":
      return geoInfoMapLink(location, lang);
  }
}
