import { useQuery } from "@tanstack/solid-query";
import { latest, type Accessor } from "solid-js";
import { useDb } from "./context";
import { fetchEtaAllOperators } from "./eta";
import { live } from "./live";
import type { Company, Eta, KeyedRoute } from "./types";

/** Counts the queries that stand for no target, so each has a key of its own. */
let nextIdle = 0;

export interface EtaTarget {
  route: KeyedRoute;
  /** 1-based stop position along the route. */
  seq: number;
  /** That stop's id per operator; a joint route has one for each. */
  stopIdByCo: Partial<Record<Company, string>>;
}

/**
 * Live arrivals for one stop on one route, refetched on the shared cadence.
 * Returning `[]` rather than throwing keeps a single failing operator from
 * blanking a whole list.
 *
 * `undefined` means the answer is still in flight, which is a different thing
 * from `[]`, "there are no buses". Collapsing the two made every stop claim
 * 暫無班次 for as long as the request took.
 *
 * Two rows asking about the same stop on the same route are one query: a
 * route listed at a kerb and the same route open in a sheet share a fetch and
 * agree with each other, where they used to be two requests that could land
 * a poll apart.
 */
export function useEta(
  target: () => EtaTarget | null,
  limit = 3,
  options: {
    /**
     * Keep showing the last answer while the target is gone.
     *
     * A row in a long list stops asking the moment it scrolls off screen,
     * which is right - but it used to forget what it had been told as well,
     * so scrolling back showed a blank countdown and a notice that had
     * vanished until the next poll came in. The row is the same row and the
     * stop the same stop; the last answer is a better thing to show for a
     * second than nothing. Only for a target that never changes identity:
     * anything that follows a moving focus must not show the old focus.
     */
    keepLast?: boolean;
  } = {},
): Accessor<Eta[] | undefined> {
  const db = useDb();

  /*
   * The last real target, so a row that has scrolled away keeps pointing at
   * the query it already has an answer for instead of at nothing. The query
   * itself is disabled while the target is gone: the answer is kept, the
   * polling is not.
   */
  let last: EtaTarget | null = null;
  const subject = () => {
    const t = target();
    if (t) last = t;
    return t ?? (options.keepLast ? last : null);
  };

  /*
   * Options are read under `latest`, and this is not optional.
   *
   * A query's options are evaluated once, synchronously, as the component is
   * set up. A target that reads another query's answer - the buses placed from
   * the open stop's arrivals, say - reads a value that may still be in flight,
   * and a pending read during setup does not wait: it throws, the component is
   * torn down and set up again when the value lands, and every query in it is
   * created afresh each time. With a page of forty rows that is a storm of
   * observers that never settles. `latest` hands back the last settled value
   * instead, so the options are built from what is known and the query simply
   * re-keys when the rest arrives.
   */
  /*
   * A row with nothing to ask about still holds a query, disabled. It used
   * to hold the same one as every other such row - one key for "nothing" -
   * so forty off-screen rows were forty observers on one query, and every
   * event on it woke all forty. Each row names its own nothing.
   */
  const idle = `idle:${nextIdle++}`;

  const query = useQuery(() => {
    const t = latest(subject);
    return {
      ...live(),
      queryKey: t
        ? (["eta", t.route.key, t.seq, t.stopIdByCo, limit] as const)
        : (["eta", idle] as const),
      enabled: t !== null && latest(target) !== null,
      queryFn: async (): Promise<Eta[]> => {
        if (!t) return [];
        try {
          return await fetchEtaAllOperators(
            db(),
            { route: t.route, seq: t.seq },
            t.stopIdByCo,
            limit,
          );
        } catch {
          return [];
        }
      },
    };
  });

  return () => {
    // Reading the data while it is in flight suspends, which keeps whatever
    // was on screen there until the answer lands - the skeleton on a first
    // load, the old numbers on every poll after.
    if (target()) return query.data;
    // No target - the row is off screen, or the route has not resolved. That
    // is "no answer", not "no buses", unless an answer is being kept.
    return options.keepLast && query.isSuccess ? query.data : undefined;
  };
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
