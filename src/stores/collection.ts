import { createSignal, type Accessor } from "solid-js";
import { createCollection, localStorageCollectionOptions } from "~/lib/tanstack/db";

/*
 * One thing a collection will not do: take a row away and put one back under
 * the same key in the same breath. The delete is accepted a beat later and
 * lands on the row that was just inserted. Replacing a row is an `update`.
 */

/**
 * Everything a rider accumulates lives in a TanStack DB collection backed by
 * localStorage: starred stops, reminders, trips, habits, settings. The
 * collection writes itself to storage, reads back what another tab wrote,
 * and makes every change a transaction. This is the few lines every store
 * needs on top of that, once.
 *
 * The rows are also published as a signal, because a store is read from
 * event handlers and component setup as well as from JSX, and a read there
 * has to answer at once rather than suspend the way a live query would.
 * The collection applies a change the moment it is asked and publishes it a
 * beat later, so anything that decides the next change - a rank, a
 * duplicate to absorb - should read `current()`, the collection itself,
 * rather than the signal.
 *
 * The app used to keep each of these as a plain JSON value under its own
 * key, and before the rename under the old name's key. A collection that
 * has never been written looks for those, once, and carries the value
 * across; the old copy is left where it is, so a tab still on the old build
 * keeps working and nothing is lost if the carry-over itself fails.
 */
export interface PersistedCollection<T extends object> {
  collection: ReturnType<typeof make<T>>;
  /** The rows, as a signal: reactive, and never suspending. */
  rows: Accessor<T[]>;
  /** The rows as the collection has them this instant. */
  current: () => T[];
  /** Adopts an older build's value and starts publishing. Once, at start-up. */
  install: () => void;
}

function make<T extends object>(id: string, storageKey: string, getKey: (item: T) => string) {
  return createCollection({
    ...localStorageCollectionOptions<T, string>({ id, storageKey, getKey }),
    startSync: true,
  });
}

export function persistedCollection<T extends object>(config: {
  id: string;
  storageKey: string;
  getKey: (item: T) => string;
  /** Where an older build kept this, newest first. */
  legacyKeys?: string[];
  /** Turns what an older build stored into rows; anything unreadable is nothing. */
  revive?: (raw: unknown) => T[];
}): PersistedCollection<T> {
  const collection = make<T>(config.id, config.storageKey, config.getKey);
  const [rows, setRows] = createSignal<T[]>([], { ownedWrite: true });
  const current = () => [...collection.values()] as T[];

  const adopt = () => {
    try {
      if (localStorage.getItem(config.storageKey) !== null) return;
      for (const key of config.legacyKeys ?? []) {
        const raw = localStorage.getItem(key);
        if (raw === null) continue;
        const list = (config.revive ?? asList)(JSON.parse(raw));
        if (list.length > 0) collection.insert(list);
        return;
      }
    } catch {
      // Storage unavailable or unreadable: start empty, as a new install would.
    }
  };

  return {
    collection,
    rows,
    current,
    install: () => {
      adopt();
      collection.subscribeChanges(() => setRows(current()), { includeInitialState: true });
      // The subscription's first delivery is a beat away; a store read in the
      // same tick as start-up - a setting, on the first render - must not
      // see an empty list while the rows are already there.
      setRows(current());
    },
  };
}

/** A stored list that is not a list is nothing. */
export const asList = <T>(raw: unknown): T[] => (Array.isArray(raw) ? (raw as T[]) : []);
