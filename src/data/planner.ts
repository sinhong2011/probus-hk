import { nearbyStops, routesAtStop, type RouteAtStop } from "./db";
import { isRunningNow } from "./schedule";
import type { Company, KeyedRoute, RouteDb, StopEntry } from "./types";
import { distanceM, walkMinutes, type LatLng } from "~/lib/geo";
import { formatFare } from "~/lib/format";

/**
 * A journey planner built from the route database rather than a routing
 * service: find the routes that pass both ends, in the right order.
 *
 * It deliberately stops at one interchange. Two-interchange journeys are rarely
 * what someone wants on a phone at a bus stop, and every extra hop multiplies
 * both the search space and the number of plausible-but-useless suggestions.
 */

/** Minutes assumed for a stop-to-stop hop when a route publishes no journey time. */
const FALLBACK_MINUTES_PER_STOP = 2;
/** Assumed wait when changing vehicles - a headway you cannot see in advance. */
const INTERCHANGE_WAIT_MINUTES = 4;
/** Journeys are not worth showing beyond this many results. */
const MAX_RESULTS = 12;

export interface Leg {
  route: KeyedRoute;
  co: Company;
  boardSeq: number;
  boardStopId: string;
  boardStop: StopEntry;
  alightSeq: number;
  alightStopId: string;
  alightStop: StopEntry;
  /** Stops travelled, which is what a rider counts. */
  hops: number;
  fare: string | null;
  minutes: number;
}

export interface Journey {
  id: string;
  legs: Leg[];
  /** Metres on foot at each end, and between legs. */
  walkStart: number;
  walkEnd: number;
  walkTransfer: number;
  totalMinutes: number;
}

export interface PlanOptions {
  /** How far someone will walk to a stop at either end. */
  walkRadiusM?: number;
  allowInterchange?: boolean;
  /** Include routes that are not running at this hour. Off by default. */
  includeNotRunning?: boolean;
}

/** Minutes per stop for this route, from its published journey time. */
function perStopMinutes(route: KeyedRoute, co: Company): number {
  const count = route.stops[co]?.length ?? 0;
  const total = route.jt ? Number(route.jt) : NaN;
  if (!Number.isFinite(total) || count < 2) return FALLBACK_MINUTES_PER_STOP;
  return total / (count - 1);
}

/**
 * Operators name the same kerb differently, so interchanges are matched on a
 * canonical id: the lowest id in the group `stopMap` records as equivalent.
 */
function canonicalStopId(db: RouteDb, stopId: string): string {
  const aliases = db.stopMap[stopId];
  if (!aliases || aliases.length === 0) return stopId;
  let lowest = stopId;
  for (const [, alias] of aliases) if (alias < lowest) lowest = alias;
  return lowest;
}

interface Boarding {
  at: RouteAtStop;
  stopId: string;
  stop: StopEntry;
  metres: number;
}

/** The closest boarding point on each route within walking distance. */
function candidatesNear(
  db: RouteDb,
  centre: LatLng,
  radiusM: number,
  running: (route: KeyedRoute) => boolean,
): Map<string, Boarding> {
  const best = new Map<string, Boarding>();

  for (const near of nearbyStops(db, centre, radiusM)) {
    for (const at of routesAtStop(db, near.stopId)) {
      if (!running(at.route)) continue;
      const existing = best.get(at.route.key);
      if (existing && existing.metres <= near.metres) continue;
      best.set(at.route.key, {
        at,
        stopId: near.stopId,
        stop: near.stop,
        metres: near.metres,
      });
    }
  }
  return best;
}

function makeLeg(
  db: RouteDb,
  route: KeyedRoute,
  co: Company,
  boardSeq: number,
  alightSeq: number,
): Leg | null {
  const ids = route.stops[co];
  const boardStopId = ids?.[boardSeq - 1];
  const alightStopId = ids?.[alightSeq - 1];
  const boardStop = boardStopId ? db.stopList[boardStopId] : undefined;
  const alightStop = alightStopId ? db.stopList[alightStopId] : undefined;
  if (!boardStopId || !alightStopId || !boardStop || !alightStop) return null;

  const hops = alightSeq - boardSeq;
  return {
    route,
    co,
    boardSeq,
    boardStopId,
    boardStop,
    alightSeq,
    alightStopId,
    alightStop,
    hops,
    // Fares are charged from the boarding stop to the terminus.
    fare: formatFare(route.fares?.[boardSeq - 1]),
    minutes: Math.max(1, Math.round(hops * perStopMinutes(route, co))),
  };
}

function totalOf(journey: Omit<Journey, "totalMinutes" | "id">): number {
  const ride = journey.legs.reduce((sum, leg) => sum + leg.minutes, 0);
  const walk =
    walkMinutes(journey.walkStart) +
    walkMinutes(journey.walkEnd) +
    (journey.walkTransfer > 0 ? walkMinutes(journey.walkTransfer) : 0);
  const waits = (journey.legs.length - 1) * INTERCHANGE_WAIT_MINUTES;
  return ride + walk + waits;
}

function finish(draft: Omit<Journey, "totalMinutes" | "id">): Journey {
  return {
    ...draft,
    id: draft.legs.map((l) => `${l.route.key}@${l.boardSeq}-${l.alightSeq}`).join("|"),
    totalMinutes: totalOf(draft),
  };
}

export function planJourneys(
  db: RouteDb,
  from: LatLng,
  to: LatLng,
  options: PlanOptions = {},
): Journey[] {
  const radius = options.walkRadiusM ?? 500;

  // Whether a route runs now is asked once per route, not once per stop.
  const runningCache = new Map<string, boolean>();
  const running = (route: KeyedRoute) => {
    if (options.includeNotRunning) return true;
    const cached = runningCache.get(route.key);
    if (cached !== undefined) return cached;
    const value = isRunningNow(db, route);
    runningCache.set(route.key, value);
    return value;
  };

  const origin = candidatesNear(db, from, radius, running);
  const destination = candidatesNear(db, to, radius, running);

  const journeys: Journey[] = [];

  // ---- direct ----------------------------------------------------------
  for (const [key, board] of origin) {
    const alight = destination.get(key);
    if (!alight || alight.at.seq <= board.at.seq) continue;

    const leg = makeLeg(db, board.at.route, board.at.co, board.at.seq, alight.at.seq);
    if (!leg) continue;

    journeys.push(
      finish({ legs: [leg], walkStart: board.metres, walkEnd: alight.metres, walkTransfer: 0 }),
    );
  }

  if (options.allowInterchange !== false && journeys.length < MAX_RESULTS) {
    // Every stop reachable without changing, and the cheapest way to reach it.
    const reachable = new Map<string, { board: Boarding; seq: number }>();

    for (const board of origin.values()) {
      const ids = board.at.route.stops[board.at.co] ?? [];
      for (let seq = board.at.seq + 1; seq <= ids.length; seq++) {
        const id = ids[seq - 1];
        if (!id) continue;
        const canonical = canonicalStopId(db, id);
        const existing = reachable.get(canonical);
        // Prefer the option that gets there in fewer stops.
        if (existing && existing.seq - existing.board.at.seq <= seq - board.at.seq) continue;
        reachable.set(canonical, { board, seq });
      }
    }

    for (const alight of destination.values()) {
      const ids = alight.at.route.stops[alight.at.co] ?? [];

      for (let seq = 1; seq < alight.at.seq; seq++) {
        const id = ids[seq - 1];
        if (!id) continue;
        const hit = reachable.get(canonicalStopId(db, id));
        if (!hit || hit.board.at.route.key === alight.at.route.key) continue;

        const first = makeLeg(db, hit.board.at.route, hit.board.at.co, hit.board.at.seq, hit.seq);
        const second = makeLeg(db, alight.at.route, alight.at.co, seq, alight.at.seq);
        if (!first || !second) continue;

        const transfer = distanceM(first.alightStop.location, second.boardStop.location);
        // A "change" that means walking half a kilometre is a different journey.
        if (transfer > 400) continue;

        journeys.push(
          finish({
            legs: [first, second],
            walkStart: hit.board.metres,
            walkEnd: alight.metres,
            walkTransfer: transfer,
          }),
        );
        break; // one option per destination route is enough
      }
    }
  }

  // Fewer changes first, then quicker; a direct route people trust beats a
  // theoretically faster one with a change.
  const seen = new Set<string>();
  return journeys
    .filter((j) => (seen.has(j.id) ? false : seen.add(j.id)))
    .sort((a, b) => a.legs.length - b.legs.length || a.totalMinutes - b.totalMinutes)
    .slice(0, MAX_RESULTS);
}
