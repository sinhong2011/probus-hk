import { QueryObserver, type QueryKey, type QueryObserverOptions } from "@tanstack/solid-query";
import { createEffect, createSignal, type Accessor } from "solid-js";
import { queryClient } from "~/lib/query";

/** A query watched from outside the reactive graph. */
export interface Observed<T> {
  /** The last answer, or `undefined` while the first is still in flight. */
  data: Accessor<T | undefined>;
  /** Ask again now, without cancelling a fetch already under way. */
  refetch: () => void;
}

/**
 * A polled query, read as a plain signal.
 *
 * `useQuery` hands the engine a promise on every refetch, so that a read of
 * its data while a poll is in flight is a pending read and the previous value
 * is held in place until the poll lands. On this engine that costs more than
 * it gives. A component that owns such a query - owns, not reads - has its
 * rendering held for as long as its poll takes, and a `<Show>` that flips
 * while it is held never flips at all: the poll lands, the next one lands,
 * and the branch stays where it was until the page is reloaded. With every
 * arrival on screen polling, a tap that lands during a poll is not rare. It
 * is how choosing where to get off left the band above the list still asking
 * for the other end while the row already said 落車, and how the rows between
 * the two ends lost their countdowns when the chips offering them were taken
 * away.
 *
 * So the hooks that poll do not go through `useQuery`. The observer is
 * TanStack's own - it still polls on the interval, pauses in the background
 * and refetches on focus - and each answer is written into a signal from its
 * callback. Nothing on that path is async, so a read of it is never pending,
 * nothing is held, and the previous numbers stay on screen through a poll
 * for the plain reason that the signal has not been written yet. The cache
 * is still the one cache: the same key from two hooks is one query, one
 * fetch, and one answer.
 *
 * `null` options mean nothing to ask about: the answer is dropped, and
 * whether a stale one should be kept instead is the caller's decision.
 */
export function observe<T, TKey extends QueryKey = QueryKey>(
  options: () => QueryObserverOptions<T, Error, T, T, TKey> | null,
): Observed<T> {
  // Written from the observer's callback rather than a computation, so the
  // write has to be declared intentional - see `~/data/live`.
  const [data, setData] = createSignal<T | undefined>(undefined, { ownedWrite: true });
  let current: QueryObserver<T, Error, T, T, TKey> | null = null;

  createEffect(
    () => options(),
    (opts) => {
      if (!opts) {
        current = null;
        setData(undefined);
        return;
      }
      const observer = new QueryObserver<T, Error, T, T, TKey>(queryClient, opts);
      current = observer;
      // Whatever the cache already holds under this key is the answer until
      // the observer has a newer one - a fresh answer from another hook on
      // the same key is served without a fetch.
      setData(() => observer.getCurrentResult().data);
      const unsubscribe = observer.subscribe((result) => {
        if (result.data !== undefined) setData(() => result.data);
      });
      // Returned, not passed to onCleanup: inside an effect callback only the
      // returned function runs.
      return () => {
        unsubscribe();
        if (current === observer) current = null;
      };
    },
  );

  return {
    data,
    refetch: () => {
      void current?.refetch({ cancelRefetch: false });
    },
  };
}
