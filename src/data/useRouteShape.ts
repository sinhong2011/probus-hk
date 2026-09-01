import type { Accessor } from "solid-js";
import { observe } from "./observe";
import { fetchRouteShape, waypointUrl, type Position } from "./waypoints";
import type { KeyedRoute } from "./types";

/**
 * Published geometry for a route, cached for as long as the tab lives.
 *
 * The same fetch the map already makes; sharing the query means the ride
 * band can score the sun without a second download of a several-hundred-
 * kilobyte line.
 *
 * `undefined` is still in flight, `null` is none published.
 */
export function useRouteShape(route: () => KeyedRoute | null): Accessor<Position[][] | null | undefined> {
  const query = observe<Position[][] | null>(() => {
    const r = route();
    const url = r ? waypointUrl(r) : null;
    if (!r || !url) return null;
    return {
      queryKey: ["waypoints", url] as const,
      queryFn: () => fetchRouteShape(r),
      staleTime: Infinity,
      gcTime: 30 * 60_000,
    };
  });
  return query.data;
}
