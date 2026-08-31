import { queryCollectionOptions } from "@tanstack/query-db-collection";
import { createCollection } from "~/lib/tanstack/db";
import { queryClient } from "~/lib/query";
import { bookmarks, saved } from "~/stores/saved";
import { settings } from "~/stores/settings";
import { loadRouteDb, routeAt } from "./db";
import { fetchEtaAllOperators } from "./eta";
import type { Eta } from "./types";
import { stopIdsFor } from "./useEta";

/**
 * The next buses for every bookmark, as one table.
 *
 * Each saved card used to fetch its own arrivals and report the soonest one
 * back up to the screen, which then ranked the cards by what it had been
 * told; the whole set of them never existed in one place. It does now: one
 * query fetches the lot on the shared cadence, TanStack DB keeps the rows,
 * and the screen asks the rows - joined to the bookmarks, ordered by the next
 * arrival - instead of collecting callbacks. A bookmark added or removed
 * refetches; the operator answers themselves come through the same request
 * cache every row on every other screen reads, so nothing is asked twice.
 */
export interface Arrival {
  /** The bookmark's own id. */
  id: string;
  /** When the soonest bus is due, in epoch milliseconds; none is `NO_NEXT`. */
  next: number;
  etas: Eta[];
  /** Whether any of them is a bus being tracked rather than a timetable. */
  live: boolean;
}

/** Sorts a bookmark with no arrival to the end of the list. */
export const NO_NEXT = Number.MAX_SAFE_INTEGER;

/** The route database, opened once for this module's fetches. */
let db: ReturnType<typeof loadRouteDb> | undefined;

export const arrivals = createCollection(
  queryCollectionOptions<Arrival, unknown, ["arrivals", "bookmarks"], string>({
    id: "arrivals",
    queryKey: ["arrivals", "bookmarks"],
    queryClient,
    getKey: (row) => row.id,
    queryFn: async () => {
      const { db: routes } = await (db ??= loadRouteDb());
      const rows = await Promise.all(
        saved.items().map(async (item): Promise<Arrival | null> => {
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

/** A bookmark made or removed is a row to add or drop: ask again. */
export function installArrivalsEffects() {
  bookmarks.subscribeChanges(() => {
    void arrivals.utils.refetch();
  });
}
