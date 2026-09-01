import { measureLine, pointAt, type MeasuredLine } from "~/lib/alongLine";
import { bearingDegrees, type LatLng } from "~/lib/geo";
import { t, type Lang } from "~/lib/i18n";
import {
  compassOf,
  solarPosition,
  sunBucket,
  type Compass,
  type SolarPosition,
} from "~/lib/solar";
import type { Position } from "./waypoints";

export type RideSunTone = "shade" | "sun" | "overhead";

export interface RideSunStroke {
  tone: RideSunTone;
  coordinates: Position[];
}

/**
 * Colour the chosen stretch: shade where the recommended window is the dark
 * one, sun where that same window is the bright one. Overhead is its own
 * tone. Night is omitted. No percentages.
 */
export function rideSunPaint(args: {
  line: MeasuredLine;
  from: number;
  to: number;
  departAt: Date;
  arriveAt: Date;
  window: WindowSide;
  sunAt?: SunAt;
}): RideSunStroke[] {
  const sunAt = args.sunAt ?? solarPosition;
  const span = args.to - args.from;
  if (span < 30 || args.line.points.length < 2) return [];

  const duration = Math.max(1, args.arriveAt.getTime() - args.departAt.getTime());
  const points: { position: Position; tone: RideSunTone }[] = [];

  for (let measure = args.from; measure <= args.to + 0.5; measure += SAMPLE_M) {
    const at = Math.min(measure, args.to);
    const frac = (at - args.from) / span;
    const when = new Date(args.departAt.getTime() + duration * frac);
    const here = pointAt(args.line, at);
    const place = lngLat(here.position);
    const sun = sunAt(when, place.lat, place.lng);
    const bucket = sunBucket(sun.azimuth, sun.elevation, here.bearing);
    if (bucket === "night") continue;
    const tone: RideSunTone =
      bucket === "overhead" ? "overhead" : bucket === args.window ? "sun" : "shade";
    points.push({ position: here.position, tone });
  }

  const strokes: RideSunStroke[] = [];
  for (const point of points) {
    const last = strokes[strokes.length - 1];
    if (last && last.tone === point.tone) {
      last.coordinates.push(point.position);
    } else {
      const prev = last?.coordinates[last.coordinates.length - 1];
      strokes.push({
        tone: point.tone,
        coordinates: prev ? [prev, point.position] : [point.position],
      });
    }
  }
  return strokes.filter((stroke) => stroke.coordinates.length >= 2);
}

/** Metres between samples along a ride. Tight enough to catch a turn. */
const SAMPLE_M = 80;
/** A side has to carry this share of the sunlit ride to be the answer. */
const MAJORITY = 0.62;
/** A flip is only worth mentioning when both sides have this much of the ride. */
const FLIP_SHARE = 0.22;

export type WindowSide = "left" | "right";

export type RideAdvice =
  | { kind: "none" }
  | { kind: "night" }
  | { kind: "overhead" }
  | { kind: "mixed" }
  | {
      kind: "side";
      window: WindowSide;
      /** 0–1, of the sunlit non-overhead metres that fell on the other window. */
      share: number;
      /** Where along the line the sun's side switched, if it did clearly. */
      flipAt?: number;
    };

export type WaitAdvice = { kind: "none" } | { kind: "night" } | { kind: "exposed" } | { kind: "shaded" };

export type WalkAdvice =
  | { kind: "none" }
  | { kind: "night" }
  | { kind: "into"; compass: Compass }
  | { kind: "away"; compass: Compass };

export type SunAt = (date: Date, lat: number, lng: number) => SolarPosition;

function lngLat(position: Position): { lat: number; lng: number } {
  return { lat: position[1], lng: position[0] };
}

/**
 * Which window to sit at, from heading versus the sun along this stretch of
 * line, at the minutes this particular departure will actually be on it.
 */
export function scoreRide(args: {
  line: MeasuredLine;
  from: number;
  to: number;
  departAt: Date;
  arriveAt: Date;
  sunAt?: SunAt;
}): RideAdvice {
  const sunAt = args.sunAt ?? solarPosition;
  const span = args.to - args.from;
  if (span < 30 || args.line.points.length < 2) return { kind: "none" };

  const duration = Math.max(1, args.arriveAt.getTime() - args.departAt.getTime());
  let left = 0;
  let right = 0;
  let overhead = 0;
  let night = 0;
  let other = 0;
  const samples: { measure: number; side: WindowSide | null }[] = [];

  for (let measure = args.from; measure <= args.to + 0.5; measure += SAMPLE_M) {
    const at = Math.min(measure, args.to);
    const weight = Math.min(SAMPLE_M, Math.max(0, args.to - at + SAMPLE_M * 0.01));
    const frac = (at - args.from) / span;
    const when = new Date(args.departAt.getTime() + duration * frac);
    const here = pointAt(args.line, at);
    const place = lngLat(here.position);
    const sun = sunAt(when, place.lat, place.lng);
    const bucket = sunBucket(sun.azimuth, sun.elevation, here.bearing);
    if (bucket === "night") night += weight;
    else if (bucket === "overhead") overhead += weight;
    else if (bucket === "left") left += weight;
    else if (bucket === "right") right += weight;
    else other += weight;
    samples.push({
      measure: at,
      side: bucket === "left" || bucket === "right" ? bucket : null,
    });
  }

  const total = left + right + overhead + night + other;
  if (total <= 0) return { kind: "none" };
  if (night / total >= 0.7) return { kind: "night" };
  if (overhead / total >= 0.55 && left + right < total * 0.3) return { kind: "overhead" };

  const sided = left + right;
  if (sided < total * 0.2) return { kind: "mixed" };

  const sunOnRight = right / sided;
  const sunOnLeft = left / sided;
  const flipAt = flipMeasure(samples);

  if (sunOnRight >= MAJORITY) {
    return {
      kind: "side",
      window: "left",
      share: sunOnRight,
      flipAt: left / sided >= FLIP_SHARE ? flipAt : undefined,
    };
  }
  if (sunOnLeft >= MAJORITY) {
    return {
      kind: "side",
      window: "right",
      share: sunOnLeft,
      flipAt: right / sided >= FLIP_SHARE ? flipAt : undefined,
    };
  }
  return { kind: "mixed" };
}

/**
 * The measure where the sun's side last switched, or undefined when it never
 * did for long enough to mention.
 */
function flipMeasure(samples: { measure: number; side: WindowSide | null }[]): number | undefined {
  let last: WindowSide | null = null;
  let lastChange: number | undefined;
  let changes = 0;
  for (const sample of samples) {
    if (!sample.side) continue;
    if (last && sample.side !== last) {
      lastChange = sample.measure;
      changes += 1;
    }
    last = sample.side;
  }
  return changes === 1 ? lastChange : undefined;
}

/**
 * Whether this kerb is the sunny one while you wait.
 *
 * Hong Kong buses stop on the left. The pavement is left of the heading, and
 * the building line is further left still. Sun from the road (right of the
 * heading) hits the waiting person across the carriageway; sun from the
 * buildings may be blocked. Without a 3D city this is a guess, and the copy
 * treats it as one.
 */
export function scoreWait(args: {
  heading: number;
  at: Date;
  lat: number;
  lng: number;
  sunAt?: SunAt;
}): WaitAdvice {
  const sun = (args.sunAt ?? solarPosition)(args.at, args.lat, args.lng);
  const bucket = sunBucket(sun.azimuth, sun.elevation, args.heading);
  if (bucket === "night") return { kind: "night" };
  if (bucket === "right") return { kind: "exposed" };
  if (bucket === "left") return { kind: "shaded" };
  return { kind: "none" };
}

/** Last-mile chord versus the sun: walking into it, or with it at your back. */
export function scoreWalk(args: {
  from: LatLng;
  to: LatLng;
  at: Date;
  sunAt?: SunAt;
}): WalkAdvice {
  const sun = (args.sunAt ?? solarPosition)(args.at, args.from.lat, args.from.lng);
  if (sun.elevation < 5) return sun.elevation < -0.83 ? { kind: "night" } : { kind: "none" };
  const heading = bearingDegrees(args.from, args.to);
  const bucket = sunBucket(sun.azimuth, sun.elevation, heading);
  const compass = compassOf(heading);
  if (bucket === "ahead") return { kind: "into", compass };
  if (bucket === "behind") return { kind: "away", compass };
  return { kind: "none" };
}

/** A line of stop-to-stop chords, when published geometry has not arrived. */
export function chordLine(stops: LatLng[]): MeasuredLine | null {
  if (stops.length < 2) return null;
  return measureLine(stops.map((stop): Position => [stop.lng, stop.lat]));
}

export interface TripSunCopy {
  /** Short chip: "呢程 · 坐右邊窗". */
  chip: string | null;
  /** Second line, only when the ride turns enough to mention. */
  detail: string | null;
  wait: string | null;
  walk: string | null;
}

export function tripSunCopy(
  ride: RideAdvice,
  wait: WaitAdvice,
  walk: WalkAdvice,
  lang: Lang,
): TripSunCopy {
  let chip: string | null = null;
  let detail: string | null = null;
  if (ride.kind === "side") {
    chip = ride.window === "left" ? t("sunRideLeft", lang) : t("sunRideRight", lang);
    if (ride.flipAt !== undefined) {
      detail = ride.window === "left" ? t("sunFlipKeepLeft", lang) : t("sunFlipKeepRight", lang);
    }
  } else if (ride.kind === "overhead") {
    chip = t("sunRideOverhead", lang);
  } else if (ride.kind === "mixed") {
    chip = t("sunRideMixed", lang);
  }

  const waitLine =
    wait.kind === "exposed"
      ? t("sunWaitExposed", lang)
      : wait.kind === "shaded"
        ? t("sunWaitShaded", lang)
        : null;

  const walkLine =
    walk.kind === "into" ? t("sunWalkInto", lang) : walk.kind === "away" ? t("sunWalkAway", lang) : null;

  return { chip, detail, wait: waitLine, walk: walkLine };
}

/**
 * Whether the daytime offer should be shown. One note, one chance: already
 * enabled, already closed, night, or no ride yet all stay quiet.
 */
export const SUN_OFFER_ID = "trip-sun-offer";
export const SUN_OFFER_DELAY_MS = 1_800;
export const SUN_OFFER_MIN_ELEVATION = 10;

export function sunOfferReady(args: {
  enabled: boolean;
  dismissed: boolean;
  elevation: number;
  hasRide: boolean;
}): boolean {
  return (
    !args.enabled &&
    !args.dismissed &&
    args.hasRide &&
    args.elevation >= SUN_OFFER_MIN_ELEVATION
  );
}
