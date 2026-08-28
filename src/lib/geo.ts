const EARTH_RADIUS_M = 6_371_000;

export interface LatLng {
  lat: number;
  lng: number;
}

const toRad = (deg: number) => (deg * Math.PI) / 180;

/** Great-circle distance in metres. */
export function distanceM(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

/**
 * Cheap pre-filter so we only run haversine on plausible candidates: one degree
 * of latitude is ~111 km everywhere, and of longitude ~111 km × cos(lat).
 */
export function boundingBox(centre: LatLng, radiusM: number) {
  const dLat = radiusM / 111_320;
  const dLng = radiusM / (111_320 * Math.cos(toRad(centre.lat)) || 1);
  return {
    minLat: centre.lat - dLat,
    maxLat: centre.lat + dLat,
    minLng: centre.lng - dLng,
    maxLng: centre.lng + dLng,
  };
}

/** Rough walking time in minutes at 80 m/min, floored at 1. */
export function walkMinutes(metres: number): number {
  return Math.max(1, Math.round(metres / 80));
}

export function formatDistance(metres: number): string {
  return metres < 1000 ? `${Math.round(metres)} m` : `${(metres / 1000).toFixed(1)} km`;
}
