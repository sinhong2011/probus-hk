import type { Accessor } from "solid-js";
import { createAsyncMemo } from "~/lib/async";
import { etaTick } from "~/stores/clock";
import { useDb } from "./context";
import { fetchEtaAllOperators } from "./eta";
import type { Company, Eta, KeyedRoute } from "./types";

export interface EtaTarget {
  route: KeyedRoute;
  /** 1-based stop position along the route. */
  seq: number;
  /** That stop's id per operator; a joint route has one for each. */
  stopIdByCo: Partial<Record<Company, string>>;
}

/**
 * Live arrivals for one stop on one route, refetched whenever the shared poll
 * ticks. Returning `[]` rather than throwing keeps a single failing operator
 * from blanking a whole list.
 *
 * `undefined` means the answer is still in flight, which is a different thing
 * from `[]`, "there are no buses". Collapsing the two made every stop claim
 * 暫無班次 for as long as the request took.
 */
export function useEta(target: () => EtaTarget | null, limit = 3): Accessor<Eta[] | undefined> {
  const db = useDb();

  return createAsyncMemo(async () => {
    // Read the ticker before awaiting, so this memo actually subscribes to it.
    etaTick();

    const t = target();
    // No target yet - the row is off screen, or the route has not resolved.
    // That is "no answer", not "no buses".
    if (!t) return undefined;

    try {
      return await fetchEtaAllOperators(db(), { route: t.route, seq: t.seq }, t.stopIdByCo, limit);
    } catch {
      return [];
    }
  });
}

/** Convenience for the common case of a route whose stop ids we already know. */
export function stopIdsFor(route: KeyedRoute, seq: number): Partial<Record<Company, string>> {
  const out: Partial<Record<Company, string>> = {};
  for (const co of route.co) {
    const id = route.stops[co]?.[seq - 1];
    if (id) out[co] = id;
  }
  return out;
}
