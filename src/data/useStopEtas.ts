import { latest, type Accessor } from "solid-js";
import { useDb } from "./context";
import type { RouteAtStop } from "./db";
import { fetchStopEtas, type StopEtaMap } from "./eta/batch";
import { live } from "./live";
import { observe } from "./observe";

/**
 * Arrivals for every route calling at one kerb, fetched as a batch.
 *
 * Keyed by the stop and the routes asked about, so the stop card on the
 * nearby screen and the stop's own page - the same kerb, opened one from the
 * other - read one answer rather than each fetching their own. An empty map
 * is the honest answer both for a kerb with no routes and for a batch that
 * failed: every row then falls back to the timetable on its own.
 *
 * A plain signal, not a query read - see `./observe`. This used to own a
 * `useQuery`, and a dozen of these on the nearby screen meant a dozen owners
 * whose rendering could be held through a poll; one position update while
 * they were held cost over a second of main thread on a phone.
 *
 * `undefined` while the first answer is still in flight - "not answered yet",
 * which is not the same thing as "no buses".
 */
export function useStopEtas(
  stopId: () => string,
  routes: () => RouteAtStop[],
): Accessor<StopEtaMap | undefined> {
  const db = useDb();

  // Under `latest` for the reason given in `useEta`.
  const query = observe<StopEtaMap>(() => {
    const list = latest(routes);
    const id = latest(stopId);
    if (list.length === 0) return null;
    return {
      ...live(),
      queryKey: ["stop", id, list.map((at) => at.route.key)] as const,
      queryFn: async (): Promise<StopEtaMap> => {
        try {
          return await fetchStopEtas(db(), id, list);
        } catch {
          return new Map();
        }
      },
    };
  });

  return () => (routes().length > 0 ? query.data() : new Map());
}
