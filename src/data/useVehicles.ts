import { createEffect, createMemo, type Accessor } from "solid-js";
import { hasLiveFeed } from "./eta";
import { fetchGmbRouteEtaTable } from "./eta/gmb";
import { fetchKmbRouteEtaTable } from "./eta/kmb";
import { live } from "./live";
import { observe } from "./observe";
import { pacedByDistance, pacedByFeed, type RideTime } from "./pace";
import type { Eta, KeyedRoute } from "./types";
import type { LatLng } from "~/lib/geo";
import { inferVehicles, trackVehicles, type EtaTable, type Vehicle } from "./vehicles";

export interface VehicleTarget {
  route: KeyedRoute;
  /**
   * Every stop on the route, in order. The count bounds what an arrival can
   * refer to, and the spacing is what turns the route's one published journey
   * time into a believable speed for each segment - see `./pace`.
   */
  stops: LatLng[];
  /**
   * Arrivals the page already has for one stop, for operators that answer only
   * per stop. One stop's arrivals place the buses approaching that stop and
   * nothing else - which is the question the rider is on the page to ask.
   */
  atStop?: { seq: number; etas: Eta[] } | null;
}

/**
 * Why the map has no buses on it, when it has none.
 *
 * An empty map is the same picture in five different situations, and a rider
 * looking at one deserves to know which they are in: still waiting, nothing
 * running, a feed that does not exist, one that failed, or a timetable standing
 * in for one. Returning a bare array made all five identical and left the
 * screen saying nothing at all - which reads as broken even when it is not.
 */
export type VehicleStatus =
  /** The operator answered, and these are the buses - possibly none. */
  | "ready"
  /** Arrivals exist but every one of them came from a timetable. */
  | "scheduled"
  /** This operator publishes no live arrivals a browser can reach. */
  | "unavailable"
  /** The request went out and did not come back. */
  | "failed";

export interface VehicleFeed {
  status: VehicleStatus;
  vehicles: Vehicle[];
  /**
   * How long this route is taking between stops, as far as anything can tell
   * right now. Handed back because it is not only the map's business: how long
   * a rider will be on the bus is the same question, and answering it from the
   * timetable while the map answers it from the feed would have the two halves
   * of one screen disagreeing.
   */
  ride: RideTime;
}

/**
 * Operators that will describe a whole route in one request. Citybus and the
 * NLB answer per stop only, so mapping their whole line would cost one request
 * per stop and the page deliberately does not - see `atStop`.
 */
export function hasRouteFeed(route: KeyedRoute): boolean {
  return route.co.some((co) => co === "kmb" || co === "gmb");
}

/** `null` is a failure; an empty table is an operator with nothing to say. */
async function routeTable(route: KeyedRoute): Promise<EtaTable | null> {
  for (const co of route.co) {
    if (co === "kmb") return fetchKmbRouteEtaTable(route, co).catch(() => null);
    if (co === "gmb") return fetchGmbRouteEtaTable(route).catch(() => null);
  }
  return new Map();
}

const empty = (status: VehicleStatus, ride: RideTime): VehicleFeed => ({
  status,
  vehicles: [],
  ride,
});

/**
 * The buses on this route, refreshed with every ETA poll.
 *
 * The estimate is only as good as the arrivals behind it, so this asks for
 * nothing the page was not already asking for: KMB's route feed is the same
 * cached URL every row on the page reads, and where there is no route feed the
 * arrivals for the open stop are reused rather than fetching more.
 *
 * `undefined` means the answer is still in flight, which is a different thing
 * from an empty feed - the same distinction `useEta` draws, and for the same
 * reason: a rider waiting is not a rider being told there is nothing.
 *
 * A plain signal, not a query read - see `./observe`. The ride time is read
 * by a memo, and a memo that read the query during a poll was held there
 * with everything downstream of it.
 */
export function useVehicles(target: () => VehicleTarget | null): Accessor<VehicleFeed | undefined> {
  let previous: Vehicle[] = [];
  let previousKey = "";

  const feed = async (t: VehicleTarget): Promise<VehicleFeed> => {
    // A different route is a different set of buses; nothing carries over.
    if (t.route.key !== previousKey) {
      previousKey = t.route.key;
      previous = [];
    }

    /*
     * The shape of the route, from how far apart its stops are. Everything
     * below either uses this as it is or scales it by what the feed says, so
     * even a route with no arrivals at all gets a better answer than the
     * published time shared out evenly.
     */
    const base = pacedByDistance(t.route, t.stops);

    // The ferries publish no arrivals at all, so there is nothing to fail at.
    if (!t.route.co.some(hasLiveFeed)) return empty("unavailable", base);

    const table = await routeTable(t.route);
    if (!table) return empty("failed", base);
    if (table.size === 0 && t.atStop) table.set(t.atStop.seq, t.atStop.etas);

    /*
     * Between a route whose buses have all finished for the night and one whose
     * arrivals are a timetable projection there is a real difference, and it is
     * the difference between "nothing is running" and "something is running but
     * nobody is tracking it".
     */
    if (table.size === 0) return empty("ready", base);
    const live = [...table.values()].some((etas) => etas.some((eta) => eta.source === "live"));
    if (!live) return empty("scheduled", base);

    const now = Date.now();
    /*
     * Scaled by what the operator is saying this minute. Worth having on its
     * own: a route running twenty minutes down on a wet Friday places every bus
     * on it wrongly if the only clock is last year's average.
     */
    const ride = pacedByFeed(base, table, t.stops.length);
    const tracked = trackVehicles(
      previous,
      inferVehicles(t.route, table, t.stops.length, now, ride),
      now,
    );
    previous = tracked;
    return { status: "ready" as const, vehicles: tracked, ride };
  };

  const query = observe<VehicleFeed>(() => {
    const t = target();
    return {
      ...live(),
      /*
       * Only the route names the query. The open stop and its arrivals used
       * to be in the key as well, so a fresh answer there was a fresh
       * placement here - but the open stop's arrivals are another query's
       * answer, and a key that changes the moment another query settles
       * re-keys this one inside the same update. On a railway line, where
       * every placement comes from the open stop, that spun the scheduler
       * until it ran out of memory. A key is built from what the page knows
       * synchronously, never from what a query answered; the answer drives a
       * refetch instead, below.
       */
      queryKey: ["vehicles", t?.route.key ?? ""],
      enabled: t !== null,
      queryFn: () => feed(t as VehicleTarget),
    };
  });

  /*
   * Where the operator only answers per stop, the open stop's arrivals are
   * what moves the buses: when they change, place again. An effect rather
   * than part of the key, so the change lands after the update that carried
   * it, not inside it - and without cancelling a placement already under
   * way. The arrivals usually land while the first placement is still being
   * worked out, and cancelling it there handed the page a rejected promise
   * in the middle of its own update, which in production spun the scheduler
   * until it ran out of memory. The placement in flight finishes; the next
   * one reads the new arrivals.
   */
  const arrivals = createMemo(() => {
    const t = target();
    return t?.atStop
      ? `${t.atStop.seq}:${t.atStop.etas.map((eta) => eta.at.getTime()).join(",")}`
      : "";
  });
  createEffect(
    () => arrivals(),
    (now, before) => {
      if (before !== undefined && now !== before) query.refetch();
    },
  );

  return () => (target() ? query.data() : undefined);
}
