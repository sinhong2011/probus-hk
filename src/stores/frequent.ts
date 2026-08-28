import { createEffect, createSignal } from "solid-js";

const KEY = "motherbus:frequent";
/** Anything untouched for two months has stopped being a habit. */
const MAX_AGE_MS = 60 * 24 * 60 * 60 * 1000;
const MAX_TRACKED = 60;

interface Visit {
  key: string;
  count: number;
  last: number;
}

function load(): Visit[] {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as Visit[]) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/*
 * These are app-wide stores, written from event handlers, effects and component
 * setup alike. Solid 2 flags a write from inside an owned scope unless the
 * signal says that is intentional - which for a store it is.
 */
const [visits, setVisits] = createSignal<Visit[]>(load(), { ownedWrite: true });

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
      return next
        .sort((a, b) => b.count - a.count || b.last - a.last)
        .slice(0, MAX_TRACKED);
    });
  },

  /**
   * The most-used routes. A single visit is not a habit, so routes seen only
   * once are excluded unless nothing else qualifies.
   */
  top(limit = 5): string[] {
    const ranked = visits().slice().sort((a, b) => b.count - a.count || b.last - a.last);
    const habitual = ranked.filter((v) => v.count > 1);
    return (habitual.length > 0 ? habitual : ranked).slice(0, limit).map((v) => v.key);
  },

  clear() {
    setVisits([]);
  },
};

export function installFrequentEffects() {
  createEffect(
    () => visits(),
    (list) => {
      try {
        localStorage.setItem(KEY, JSON.stringify(list));
      } catch {
        // Storage unavailable: habits last for the session only.
      }
    },
  );
}
