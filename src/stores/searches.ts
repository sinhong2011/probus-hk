import { persistedCollection } from "./collection";

/** A history that reaches back further than this is a filing cabinet. */
const MAX_KEPT = 12;

interface Search {
  /** The words themselves, as typed - this is what the row shows. */
  query: string;
  last: number;
}

const store = persistedCollection<Search>({
  id: "searches",
  storageKey: "probus:db:searches",
  getKey: (search) => search.query,
});

/**
 * What this rider has actually searched for, newest first.
 *
 * The field's own history, and the distinction from `frequent` is the whole
 * point of it: `frequent` remembers the *routes* a rider opened, which is a
 * record of destinations; this remembers the *words they typed*, which is a
 * record of questions. "彌敦道" is not a route and never appears in the other
 * list, but it is exactly the thing a rider types twice.
 *
 * Only searches a rider did something with are kept - one that led to a tap,
 * or one they pressed enter on. Every keystroke is a query on the way to the
 * one they meant, and a history of 1, 11, 11X, 11 is not a history.
 */
export const searches = {
  entries: store.rows,

  /** The searches themselves, newest first. */
  recent(limit = MAX_KEPT): string[] {
    return store
      .rows()
      .slice()
      .sort((a, b) => b.last - a.last)
      .slice(0, limit)
      .map((entry) => entry.query);
  },

  /**
   * Called when a search turned into something: a result opened, or entered.
   *
   * Searching the same thing again moves it to the top rather than adding a
   * second row - a history with the same word three times over is three rows
   * saying one thing.
   */
  remember(raw: string) {
    const query = raw.trim();
    if (query === "") return;

    const now = Date.now();
    const { collection } = store;
    if (collection.has(query)) {
      collection.update(query, (draft) => {
        draft.last = now;
      });
    } else {
      collection.insert({ query, last: now });
    }

    const keep = new Set(
      store
        .current()
        .sort((a, b) => b.last - a.last)
        .slice(0, MAX_KEPT)
        .map((entry) => entry.query),
    );
    const drop = store
      .current()
      .map((entry) => entry.query)
      .filter((query) => !keep.has(query));
    if (drop.length > 0) collection.delete(drop);
  },

  /** Take one search off the list, at the rider's request. */
  forget(query: string) {
    if (store.collection.has(query)) store.collection.delete(query);
  },

  clear() {
    const keys = store.current().map((entry) => entry.query);
    if (keys.length > 0) store.collection.delete(keys);
  },
};

export function installSearchEffects() {
  store.install();
}
