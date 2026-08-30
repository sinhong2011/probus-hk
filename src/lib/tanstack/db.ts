import {
  BaseQueryBuilder,
  createLiveQueryCollection,
  createLiveQueryObserver,
  isCollection,
  isSingleResultCollection,
  type Collection,
  type CollectionStatus,
  type InitialQueryBuilder,
  type LiveQueryCollectionConfig,
  type QueryBuilder,
} from "@tanstack/db";
import {
  createEffect,
  createMemo,
  createSignal,
  createStore,
  reconcile,
  type Accessor,
} from "solid-js";

export * from "@tanstack/db";

/*
 * TanStack DB keeps collections and answers queries over them incrementally:
 * a live query is itself a collection that changes only where its inputs
 * changed. Solid's part is small - turn the stream of changes into a store,
 * and suspend readers until the first answer is in - and the official Solid
 * binding does it with `createResource` and a reactive `Map`, both Solid 1.
 * Here the first answer is an async memo, which is what suspends in Solid 2,
 * and the rows are a store reconciled by the collection's own key, so a
 * change to one row touches one row.
 */

/** A live query's status, plus `disabled` for a query that has no source yet. */
export type LiveQueryStatus = CollectionStatus | "disabled";

export type LiveQueryResult<T extends object> = Accessor<T[]> & {
  /** The rows, the same as calling the result. */
  readonly data: T[];
  readonly status: LiveQueryStatus;
  readonly isLoading: boolean;
  readonly isReady: boolean;
  readonly isError: boolean;
  /** The collection behind the query, for anything the rows cannot answer. */
  readonly collection: Collection<T, string | number, {}> | null;
};

type QueryFn = (q: InitialQueryBuilder) => QueryBuilder<Context> | null | undefined;
type Context = Parameters<typeof createLiveQueryCollection>[0] extends infer _ ? never : never;
type SourceFn<T extends object> = () =>
  | Collection<T, string | number, {}>
  | LiveQueryCollectionConfig<never, never>
  | null
  | undefined;

/**
 * Rows that keep themselves current.
 *
 * Give it a query - `(q) => q.from({ b: bookmarks }).where(…)` - or a
 * function returning a collection, and read the result where you read any
 * signal. Reading suspends until the first rows are in, and after that every
 * change to the source is reflected without a refetch: the query is kept
 * up to date by difference, not by running again.
 *
 * A query that reads signals of its own is re-created when they change; a
 * source function that returns nothing disables the query.
 */
export function createLiveQuery<T extends object>(
  source: QueryFn | SourceFn<T>,
): LiveQueryResult<T> {
  const collection = createMemo<Collection<T, string | number, {}> | null>(() => {
    if (source.length === 1) {
      const query = source as QueryFn;
      // Run once against a bare builder: a query that returns nothing is off.
      if (query(new BaseQueryBuilder() as InitialQueryBuilder) == null) return null;
      return createLiveQueryCollection({
        query: query as never,
        startSync: true,
      }) as unknown as Collection<T, string | number, {}>;
    }
    const inner = (source as SourceFn<T>)();
    if (!inner) return null;
    if (isCollection(inner)) {
      inner.startSyncImmediate();
      return inner as Collection<T, string | number, {}>;
    }
    return createLiveQueryCollection({
      ...(inner as never as object),
      startSync: true,
    } as never) as unknown as Collection<T, string | number, {}>;
  });

  const [rows, setRows] = createStore<{ list: T[] }>({ list: [] });
  const [status, setStatus] = createSignal<LiveQueryStatus>("idle", { ownedWrite: true });

  /*
   * The first answer, as the thing readers wait on. An async memo is pending
   * until the promise settles, and a read of a pending memo suspends the
   * reader - which is how a screen shows its loading state for a query
   * without being told to.
   */
  const ready = createMemo(async () => {
    const current = collection();
    if (!current) return true;
    await current.toArrayWhenReady();
    return true;
  });

  createEffect(
    () => collection(),
    (current) => {
      if (!current) {
        setRows(reconcile({ list: [] as T[] }));
        setStatus("disabled");
        return;
      }

      const observer = createLiveQueryObserver(current);
      const publish = () => {
        setRows(
          reconcile({ list: Array.from(current.values()) as T[] }, (item: T) =>
            current.getKeyFromItem(item),
          ),
        );
        setStatus(observer.getSnapshot().status);
      };
      const unsubscribe = observer.subscribe(publish);
      publish();

      return () => {
        unsubscribe();
        observer.dispose();
      };
    },
  );

  const read = (() => {
    void (ready() as unknown);
    const current = collection();
    // A query built for one row answers with that row, not a list of one.
    if (current && isSingleResultCollection(current)) return rows.list[0] as never;
    return rows.list;
  }) as LiveQueryResult<T>;

  Object.defineProperties(read, {
    data: { get: () => read() },
    status: { get: status },
    isLoading: { get: () => status() === "loading" },
    isReady: { get: () => status() === "ready" || status() === "disabled" },
    isError: { get: () => status() === "error" },
    collection: { get: collection },
  });

  return read;
}
