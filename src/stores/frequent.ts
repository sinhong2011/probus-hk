import { persistedCollection } from "./collection";

/** Anything untouched for two months has stopped being a habit. */
const MAX_AGE_MS = 60 * 24 * 60 * 60 * 1000;
const MAX_TRACKED = 60;

export interface Visit {
  key: string;
  count: number;
  last: number;
}

const store = persistedCollection<Visit>({
  id: "frequent",
  storageKey: "probus:db:frequent",
  getKey: (visit) => visit.key,
  legacyKeys: ["probus:frequent", "motherbus:frequent"],
});

const byUse = (a: Visit, b: Visit) => b.count - a.count || b.last - a.last;

/**
 * Which routes this person actually uses, learned rather than configured.
 *
 * Pinning is deliberate and explicit; this is the opposite - it quietly
 * notices that you check the same route every morning and puts it within
 * reach. Old habits age out so a holiday route does not linger for a year.
 */
export const frequent = {
  visits: store.rows,

  /** Called when a route page is opened. */
  record(routeKey: string) {
    const now = Date.now();
    const { collection } = store;
    const existing = collection.get(routeKey);
    if (existing) {
      collection.update(routeKey, (draft) => {
        draft.count += 1;
        draft.last = now;
      });
    } else {
      collection.insert({ key: routeKey, count: 1, last: now });
    }

    // Keep the record bounded: what has aged out goes, then the least-used,
    // oldest entries past the cap.
    const kept = store
      .current()
      .filter((v) => now - v.last < MAX_AGE_MS)
      .sort(byUse)
      .slice(0, MAX_TRACKED);
    const keep = new Set(kept.map((v) => v.key));
    const drop = store
      .current()
      .map((v) => v.key)
      .filter((key) => !keep.has(key));
    if (drop.length > 0) collection.delete(drop);
  },

  /**
   * The most-used routes. A single visit is not a habit, so routes seen only
   * once are excluded unless nothing else qualifies.
   */
  top(limit = 5): string[] {
    const ranked = store.rows().slice().sort(byUse);
    const habitual = ranked.filter((v) => v.count > 1);
    return (habitual.length > 0 ? habitual : ranked).slice(0, limit).map((v) => v.key);
  },

  /**
   * What was opened last, newest first - the other question a search screen
   * answers before anything is typed. "The route I looked at ten minutes ago"
   * is not a habit, and `top` rightly leaves it out; this is where it goes.
   */
  recent(limit = 6): string[] {
    return store
      .rows()
      .slice()
      .sort((a, b) => b.last - a.last)
      .slice(0, limit)
      .map((v) => v.key);
  },

  /** Drop one route from the record, at the rider's request. */
  forget(routeKey: string) {
    if (store.collection.has(routeKey)) store.collection.delete(routeKey);
  },

  clear() {
    const keys = store.current().map((v) => v.key);
    if (keys.length > 0) store.collection.delete(keys);
  },

  replaceAll(visits: Visit[]) {
    frequent.clear();
    if (visits.length > 0) store.collection.insert(visits);
  },

  mergeAll(visits: Visit[]) {
    for (const visit of visits) {
      const existing = store.collection.get(visit.key);
      if (existing) {
        store.collection.update(visit.key, (draft) => {
          draft.count = Math.max(draft.count, visit.count);
          draft.last = Math.max(draft.last, visit.last);
        });
      } else {
        store.collection.insert(visit);
      }
    }
  },
};

export function installFrequentEffects() {
  store.install();
}
