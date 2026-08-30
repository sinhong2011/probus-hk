import { useQuery } from "@tanstack/solid-query";
import { latest, type Accessor } from "solid-js";
import { useDb } from "./context";
import type { RouteAtStop } from "./db";
import { fetchStopEtas, type StopEtaMap } from "./eta/batch";
import { live } from "./live";

/**
 * Arrivals for every route calling at one kerb, fetched as a batch.
 *
 * Keyed by the stop and the routes asked about, so the stop card on the
 * nearby screen and the stop's own page - the same kerb, opened one from the
 * other - read one answer rather than each fetching their own. An empty map
 * is the honest answer both for a kerb with no routes and for a batch that
 * failed: every row then falls back to the timetable on its own.
 */
export function useStopEtas(
  stopId: () => string,
  routes: () => RouteAtStop[],
): Accessor<StopEtaMap> {
  const db = useDb();

  // Under `latest` for the reason given in `useEta`.
  const query = useQuery(() => {
    const list = latest(routes);
    const id = latest(stopId);
    return {
      ...live(),
      queryKey: ["stop", id, list.map((at) => at.route.key)] as const,
      enabled: list.length > 0,
      queryFn: async (): Promise<StopEtaMap> => {
        try {
          return await fetchStopEtas(db(), id, list);
        } catch {
          return new Map();
        }
      },
    };
  });

  return () => (routes().length > 0 ? query.data : new Map());
}
