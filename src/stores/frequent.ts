import { installPersistence, persistedSignal } from "./persisted";

// The old name, kept on purpose: renaming the key empties the routes a rider opens often on every
// device that already has one.
const KEY = "probus:frequent";
/** Anything untouched for two months has stopped being a habit. */
const MAX_AGE_MS = 60 * 24 * 60 * 60 * 1000;
const MAX_TRACKED = 60;

interface Visit {
  key: string;
  count: number;
  last: number;
}

const revive = (raw: unknown): Visit[] => (Array.isArray(raw) ? (raw as Visit[]) : []);

const [visits, setVisits] = persistedSignal<Visit[]>(KEY, [], revive);

/**
 * Which routes this person actually uses, learned rather than configured.
 *
 * Pinning is deliberate and explicit; this is the opposite - it quietly
 * notices that you check the same route every morning and puts it within
 * reach. Old habits age out so a holiday route does not linger for a year.
 */
export const frequent = {
  visits,

  /** Called when a route page is opened. */
  record(routeKey: string) {
    const now = Date.now();
    setVisits((prev) => {
      const fresh = prev.filter((v) => now - v.last < MAX_AGE_MS);
      const existing = fresh.find((v) => v.key === routeKey);

      const next = existing
        ? fresh.map((v) => (v.key === routeKey ? { ...v, count: v.count + 1, last: now } : v))
        : [...fresh, { key: routeKey, count: 1, last: now }];

      // Keep the list bounded; drop the least-used, oldest entries first.
      return next.sort((a, b) => b.count - a.count || b.last - a.last).slice(0, MAX_TRACKED);
    });
  },

  /**
   * The most-used routes. A single visit is not a habit, so routes seen only
   * once are excluded unless nothing else qualifies.
   */
  top(limit = 5): string[] {
    const ranked = visits()
      .slice()
      .sort((a, b) => b.count - a.count || b.last - a.last);
    const habitual = ranked.filter((v) => v.count > 1);
    return (habitual.length > 0 ? habitual : ranked).slice(0, limit).map((v) => v.key);
  },

  /**
   * What was opened last, newest first - the other question a search screen
   * answers before anything is typed. "The route I looked at ten minutes ago"
   * is not a habit, and `top` rightly leaves it out; this is where it goes.
   */
  recent(limit = 6): string[] {
    return visits()
      .slice()
      .sort((a, b) => b.last - a.last)
      .slice(0, limit)
      .map((v) => v.key);
  },

  /** Drop one route from the record, at the rider's request. */
  forget(routeKey: string) {
    setVisits((prev) => prev.filter((v) => v.key !== routeKey));
  },

  clear() {
    setVisits([]);
  },
};

export function installFrequentEffects() {
  installPersistence(KEY, visits, setVisits, revive);
}
