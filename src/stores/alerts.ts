import { installPersistence, persistedSignal } from "./persisted";
import type { Company } from "~/data/types";

const KEY = "motherbus:alerts";

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

/** A stored list that is not a list is not an alert list. */
const revive = (raw: unknown): AlertItem[] => (Array.isArray(raw) ? (raw as AlertItem[]) : []);

const [items, setItems] = persistedSignal<AlertItem[]>(KEY, [], revive);

export const alerts = {
  items,

  has(kind: AlertKind, routeKey: string, stopId: string): boolean {
    const id = alertId(kind, routeKey, stopId);
    return items().some((a) => a.id === id);
  },

  find(kind: AlertKind, routeKey: string, stopId: string): AlertItem | undefined {
    const id = alertId(kind, routeKey, stopId);
    return items().find((a) => a.id === id);
  },

  /** Sets an alert, replacing any earlier one of the same kind at the stop. */
  arm(entry: Omit<AlertItem, "id" | "createdAt">) {
    const id = alertId(entry.kind, entry.routeKey, entry.stopId);
    const next: AlertItem = { ...entry, id, createdAt: Date.now() };
    setItems((prev) => [...prev.filter((a) => a.id !== id), next]);
  },

  remove(id: string) {
    setItems((prev) => prev.filter((a) => a.id !== id));
  },

  clear() {
    setItems([]);
  },
};

export function installAlertEffects() {
  installPersistence(KEY, items, setItems, revive);
}
