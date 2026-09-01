import { createMemo, type Accessor } from "solid-js";
import { measureLine, measureStops, pointAt, stitchLines } from "~/lib/alongLine";
import type { LatLng } from "~/lib/geo";
import { now } from "~/stores/clock";
import { settings } from "~/stores/settings";
import { routeStops } from "./db";
import { useDb } from "./context";
import {
  chordLine,
  scoreRide,
  scoreWait,
  scoreWalk,
  tripSunCopy,
  type TripSunCopy,
  type WaitAdvice,
  type WalkAdvice,
} from "./tripSun";
import type { KeyedRoute } from "./types";
import { useRouteShape } from "./useRouteShape";
import type { Position } from "./waypoints";

/**
 * Heavy rail runs underground. Light rail, buses, minibuses and ferries do not.
 */
function outdoor(route: KeyedRoute): boolean {
  return route.co[0] !== "mtr";
}

function positionsOf(stops: { location: LatLng }[]): Position[] {
  return stops.map((stop) => [stop.location.lng, stop.location.lat]);
}

/**
 * The sun story for one ride, or `null` when the setting is off, the mode
 * is underground, the sun is down, or the geometry has not arrived yet.
 */
export function useTripSun(opts: () => {
  route: KeyedRoute;
  boardSeq: number;
  alightSeq: number | null;
  /** Next bus that has not already gone, or null to use now. */
  departAt: Date | null;
  rideMinutes: number | null;
  walkTo?: LatLng | null;
} | null): Accessor<TripSunCopy | null> {
  const db = useDb();
  const subject = () => {
    const o = opts();
    if (!o || !settings.tripSun() || !outdoor(o.route)) return null;
    return o;
  };
  const shape = useRouteShape(() => subject()?.route ?? null);

  return createMemo(() => {
    const o = subject();
    if (!o) return null;
    const stops = routeStops(db(), o.route).map((entry) => entry.stop);
    if (stops.length < 2) return null;

    const lines = shape();
    // Still fetching published geometry: wait rather than flash a chord
    // answer that the real line will replace. No URL means none is coming.
    if (lines === undefined) return null;

    const placedStops = positionsOf(stops);
    const published = lines && lines.length > 0 ? measureLine(stitchLines(lines)) : null;
    const placed = published ? measureStops(published, placedStops) : null;
    const line = placed?.line ?? published ?? chordLine(stops.map((s) => s.location));
    if (!line) return null;

    const board = o.boardSeq - 1;
    const alight = o.alightSeq !== null ? o.alightSeq - 1 : null;
    const from = placed?.measures[board] ?? 0;
    const departAt = o.departAt ?? new Date(now());

    const stop = stops[board];
    const wait: WaitAdvice = stop
      ? scoreWait({
          heading: pointAt(line, from).bearing,
          at: departAt,
          lat: stop.location.lat,
          lng: stop.location.lng,
        })
      : { kind: "none" };

    if (alight === null || o.rideMinutes === null) {
      const copy = tripSunCopy({ kind: "none" }, wait, { kind: "none" }, settings.lang());
      return copy.wait ? copy : null;
    }

    const to = placed?.measures[alight] ?? line.length;
    const arriveAt = new Date(departAt.getTime() + o.rideMinutes * 60_000);
    const ride = scoreRide({ line, from, to, departAt, arriveAt });

    const alightStop = stops[alight];
    const walk: WalkAdvice =
      o.walkTo && alightStop
        ? scoreWalk({ from: alightStop.location, to: o.walkTo, at: arriveAt })
        : { kind: "none" };

    const copy = tripSunCopy(ride, wait, walk, settings.lang());
    return copy.chip || copy.wait || copy.walk ? copy : null;
  });
}
