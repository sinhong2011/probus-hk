import { createContext, useContext, type Accessor } from "solid-js";
import { createAsyncMemo } from "~/lib/async";
import { loadRouteDb, type CachedDb } from "./db";
import type { RouteDb } from "./types";

// Default-less form: reading it without a provider throws, which is what we want.
const DbContext = createContext<Accessor<CachedDb>>();

export function DbProvider(props: { children: unknown }) {
  // Reading this inside a <Loading> boundary suspends until the database is in
  // memory - from IndexedDB on a second run, so the app opens offline.
  const cached = createAsyncMemo(() => loadRouteDb());
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
