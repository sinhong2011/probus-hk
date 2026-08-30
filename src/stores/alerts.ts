import { persistedCollection } from "./collection";
import type { Company } from "~/data/types";

/**
 * `arrival` watches the feed and fires when the bus is nearly at the stop you
 * are waiting at. `destination` watches where *you* are and fires when the stop
 * you are riding to comes within range - the two questions a rider actually has
 * once they have stopped looking at the screen.
 */
export type AlertKind = "arrival" | "destination";

export interface AlertItem {
  /** Stable identity: one alert of each kind per stop on a route. */
  id: string;
  kind: AlertKind;
  routeKey: string;
  co: Company;
  stopId: string;
  seq: number;
  /** Arrival alerts: how many minutes ahead to fire. */
  leadMinutes: number;
  /** Destination alerts: how close counts as arriving, in metres. */
  radiusM: number;
  createdAt: number;
}

export function alertId(kind: AlertKind, routeKey: string, stopId: string): string {
  return `${kind}:${routeKey}@${stopId}`;
}

const store = persistedCollection<AlertItem>({
  id: "alerts",
  storageKey: "probus:db:alerts",
  getKey: (item) => item.id,
  legacyKeys: ["probus:alerts", "motherbus:alerts"],
});

export const alerts = {
  items: store.rows,

  has(kind: AlertKind, routeKey: string, stopId: string): boolean {
    const id = alertId(kind, routeKey, stopId);
    return store.rows().some((a) => a.id === id);
  },

  find(kind: AlertKind, routeKey: string, stopId: string): AlertItem | undefined {
    const id = alertId(kind, routeKey, stopId);
    return store.rows().find((a) => a.id === id);
  },

  /** Sets an alert, replacing any earlier one of the same kind at the stop. */
  arm(entry: Omit<AlertItem, "id" | "createdAt">) {
    const id = alertId(entry.kind, entry.routeKey, entry.stopId);
    const next: AlertItem = { ...entry, id, createdAt: Date.now() };
    if (store.collection.has(id)) {
      // In place: a delete and an insert under one key do not both land.
      store.collection.update(id, (draft) => Object.assign(draft, next));
    } else {
      store.collection.insert(next);
    }
  },

  remove(id: string) {
    if (store.collection.has(id)) store.collection.delete(id);
  },

  clear() {
    const ids = store.current().map((a) => a.id);
    if (ids.length > 0) store.collection.delete(ids);
  },
};

export function installAlertEffects() {
  store.install();
}
