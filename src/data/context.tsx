import { createContext, createSignal, onCleanup, useContext, type Accessor } from "solid-js";
import { createAsyncMemo } from "~/lib/async";
import { DB_UPDATED_EVENT, loadRouteDb, type CachedDb } from "./db";
import type { RouteDb } from "./types";

// Default-less form: reading it without a provider throws, which is what we want.
const DbContext = createContext<Accessor<CachedDb>>();

export function DbProvider(props: { children: unknown }) {
  // Reading this inside a <Loading> boundary suspends until the database is in
  // memory - from IndexedDB on a second run, so the app opens offline.
  const initial = createAsyncMemo(() => loadRouteDb());
  /*
   * A later copy must not go through the async memo: that would suspend again
   * and splash the whole app while 1.7 MB is swapped. The first load stays
   * where it is; anything announced after it overlays it, and the screens
   * already on it re-read.
   */
  const [live, setLive] = createSignal<CachedDb | undefined>(undefined, { ownedWrite: true });

  const adopt = (event: Event) => {
    const next = (event as CustomEvent<CachedDb>).detail;
    if (next?.db) setLive(() => next);
  };
  window.addEventListener(DB_UPDATED_EVENT, adopt);
  onCleanup(() => window.removeEventListener(DB_UPDATED_EVENT, adopt));

  const cached = () => live() ?? initial();
  return <DbContext value={cached}>{props.children as never}</DbContext>;
}

/**
 * Accessors, not values.
 *
 * The database arrives asynchronously, and Solid 2 requires a pending async
 * value to be read inside a tracking scope - a memo, an effect's compute, or
 * JSX. Returning the value directly would read it during component setup,
 * which is untracked: it happens to work, because the read suspends and the
 * component re-runs, but nothing would ever react to the database changing.
 */
export function useDb(): Accessor<RouteDb> {
  const cached = useContext(DbContext);
  return () => cached().db;
}

export function useDbMeta(): Accessor<{ fetchedAt: number; etag: string | null }> {
  const cached = useContext(DbContext);
  return () => {
    const { fetchedAt, etag } = cached();
    return { fetchedAt, etag };
  };
}
