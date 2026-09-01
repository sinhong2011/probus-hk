/**
 * Position of the sun, from the NOAA solar calculator's published equations.
 *
 * Good to a degree or two, which is plenty for "left window or right": the
 * difference between those is ninety degrees. Hong Kong has no daylight
 * saving, so the instant is used as-is.
 */

const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;

export interface SolarPosition {
  /** Compass degrees clockwise from true north, 0–360. */
  azimuth: number;
  /** Degrees above the horizon. Negative when the sun is down. */
  elevation: number;
}

/** Julian day for an instant, UTC. */
function julianDay(date: Date): number {
  return date.getTime() / 86_400_000 + 2_440_587.5;
}

/**
 * Where the sun is in the sky at `date`, seen from `lat`/`lng` in degrees.
 */
export function solarPosition(date: Date, lat: number, lng: number): SolarPosition {
  const d = julianDay(date) - 2_451_545;
  const g = (357.529 + 0.98560028 * d) * DEG;
  const q = 280.459 + 0.98564736 * d;
  const L = (q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * DEG;
  const e = (23.439 - 0.00000036 * d) * DEG;
  const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L));
  const dec = Math.asin(Math.sin(e) * Math.sin(L));

  const gmstHours = (18.697374558 + 24.06570982441908 * d) % 24;
  const lmstRad = ((gmstHours + lng / 15) * 15) * DEG;
  const ha = lmstRad - ra;

  const latR = lat * DEG;
  const sinEl =
    Math.sin(latR) * Math.sin(dec) + Math.cos(latR) * Math.cos(dec) * Math.cos(ha);
  const elevation = Math.asin(Math.max(-1, Math.min(1, sinEl))) * RAD;
  const azimuth =
    Math.atan2(-Math.sin(ha), Math.cos(latR) * Math.tan(dec) - Math.sin(latR) * Math.cos(ha)) *
    RAD;

  return { azimuth: (azimuth + 360) % 360, elevation };
}

/**
 * Which way the sun sits relative to a vehicle heading (compass degrees).
 *
 * Overhead and night are not a side: forcing left/right then would be a lie.
 */
export type SunBucket = "left" | "right" | "ahead" | "behind" | "overhead" | "night";

/** Elevation below this is night for our purposes, refraction included. */
export const SUN_UP = -0.83;
/** Above this, both windows see much the same sky. */
export const SUN_OVERHEAD = 70;

export function sunBucket(azimuth: number, elevation: number, heading: number): SunBucket {
  if (elevation < SUN_UP) return "night";
  if (elevation >= SUN_OVERHEAD) return "overhead";
  const rel = ((azimuth - heading) % 360 + 360) % 360;
  if (rel < 40 || rel >= 320) return "ahead";
  if (rel >= 140 && rel < 220) return "behind";
  if (rel >= 40 && rel < 140) return "right";
  return "left";
}

/** The four compass words a rider uses, from a bearing. */
export type Compass = "n" | "e" | "s" | "w";

export function compassOf(bearing: number): Compass {
  const folded = ((bearing % 360) + 360) % 360;
  if (folded >= 315 || folded < 45) return "n";
  if (folded < 135) return "e";
  if (folded < 225) return "s";
  return "w";
}
