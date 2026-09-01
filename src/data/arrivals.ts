import { queryCollectionOptions } from "@tanstack/query-db-collection";
import { createCollection } from "~/lib/tanstack/db";
import { queryClient } from "~/lib/query";
import { stars, starred, isStopStar } from "~/stores/starred";
import { settings } from "~/stores/settings";
import { loadRouteDb, routeAt, routesAtCluster } from "./db";
import { fetchEtaAllOperators } from "./eta";
import { fetchStopEtas } from "./eta/batch";
import type { Eta } from "./types";
import { stopIdsFor } from "./useEta";

/**
 * The next buses for every starred stop, as one table.
 *
 * Each starred card used to fetch its own arrivals and report the soonest one
 * back up to the screen, which then ranked the cards by what it had been
 * told; the whole set of them never existed in one place. It does now: one
 * query fetches the lot on the shared cadence, TanStack DB keeps the rows,
 * and the screen asks the rows - joined to the stars, ordered by the next
 * arrival - instead of collecting callbacks. A star added or removed
 * refetches; the operator answers themselves come through the same request
 * cache every row on every other screen reads, so nothing is asked twice.
 */
export interface Arrival {
  /** The star's own id. */
  id: string;
  /** When the soonest bus is due, in epoch milliseconds; none is `NO_NEXT`. */
  next: number;
  etas: Eta[];
  /** Whether any of them is a bus being tracked rather than a timetable. */
  live: boolean;
}

/** Sorts a star with no arrival to the end of the list. */
export const NO_NEXT = Number.MAX_SAFE_INTEGER;

/** The route database, opened once for this module's fetches. */
let db: ReturnType<typeof loadRouteDb> | undefined;

export const arrivals = createCollection(
  queryCollectionOptions<Arrival, unknown, ["arrivals", "starred"], string>({
    id: "arrivals",
    queryKey: ["arrivals", "starred"],
    queryClient,
    getKey: (row) => row.id,
    queryFn: async () => {
      const { db: routes } = await (db ??= loadRouteDb());
      const rows = await Promise.all(
        starred.items().map(async (item): Promise<Arrival | null> => {
          if (isStopStar(item)) {
            const members = new Set<string>([item.stopId]);
            for (const [, alias] of routes.stopMap[item.stopId] ?? []) members.add(alias);
            const calling = routesAtCluster(routes, [...members]);
            const map = await fetchStopEtas(routes, item.stopId, calling).catch(
              () => new Map<string, Eta[]>(),
            );
            const etas = [...map.values()]
              .flat()
              .sort((a, b) => a.at.getTime() - b.at.getTime())
              .slice(0, 3);
            return {
              id: item.id,
              next: etas[0]?.at.getTime() ?? NO_NEXT,
              etas,
              live: etas.some((eta) => eta.source === "live"),
            };
          }
          const route = routeAt(routes, item.routeKey);
          if (!route) return null;
          const etas = await fetchEtaAllOperators(
            routes,
            { route, seq: item.seq },
            stopIdsFor(route, item.seq),
            3,
          ).catch(() => [] as Eta[]);
          return {
            id: item.id,
            next: etas[0]?.at.getTime() ?? NO_NEXT,
            etas,
            live: etas.some((eta) => eta.source === "live"),
          };
        }),
      );
      return rows.filter((row): row is Arrival => row !== null);
    },
    // The cadence is a setting; read each time the interval is armed.
    refetchInterval: () => settings.refreshSeconds() * 1_000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    retry: false,
  }),
);

/** A star made or removed is a row to add or drop: ask again. */
export function installArrivalsEffects() {
  stars.subscribeChanges(() => {
    void arrivals.utils.refetch();
  });
}
