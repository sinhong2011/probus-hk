import { installPersistence, persistedSignal } from "./persisted";
import type { Company } from "~/data/types";

const KEY = "motherbus:saved";

export interface SavedItem {
  /** Stable identity so reorder and removal do not depend on array position. */
  id: string;
  routeKey: string;
  co: Company;
  stopId: string;
  seq: number;
  /** Free-text grouping such as 上班 / 週末, or "" for ungrouped. */
  group: string;
}

export function savedId(routeKey: string, stopId: string): string {
  return `${routeKey}@${stopId}`;
}

/** A stored list that is not a list is not a bookmark list. */
const revive = (raw: unknown): SavedItem[] => (Array.isArray(raw) ? (raw as SavedItem[]) : []);

const [items, setItems] = persistedSignal<SavedItem[]>(KEY, [], revive);

export const saved = {
  items,

  has(routeKey: string, stopId: string): boolean {
    const id = savedId(routeKey, stopId);
    return items().some((i) => i.id === id);
  },

  toggle(entry: Omit<SavedItem, "id" | "group"> & { group?: string }) {
    const id = savedId(entry.routeKey, entry.stopId);
    setItems((prev) =>
      prev.some((i) => i.id === id)
        ? prev.filter((i) => i.id !== id)
        : [...prev, { ...entry, id, group: entry.group ?? "" }],
    );
  },

  remove(id: string) {
    setItems((prev) => prev.filter((i) => i.id !== id));
  },

  setGroup(id: string, group: string) {
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, group } : i)));
  },

  /** Moves `id` to sit at `toIndex` in the flat list, preserving the rest. */
  reorder(id: string, toIndex: number) {
    setItems((prev) => {
      const from = prev.findIndex((i) => i.id === id);
      if (from < 0) return prev;
      const next = prev.slice();
      const [moved] = next.splice(from, 1);
      if (!moved) return prev;
      next.splice(Math.max(0, Math.min(toIndex, next.length)), 0, moved);
      return next;
    });
  },

  /** Every group a bookmark has been put in, in the order they were made. */
  groups(): string[] {
    const seen: string[] = [];
    for (const item of items()) {
      if (item.group && !seen.includes(item.group)) seen.push(item.group);
    }
    return seen;
  },

  /** Grouped for display, in insertion order, ungrouped last. */
  grouped(): { group: string; items: SavedItem[] }[] {
    const buckets = new Map<string, SavedItem[]>();
    for (const item of items()) {
      const bucket = buckets.get(item.group);
      if (bucket) bucket.push(item);
      else buckets.set(item.group, [item]);
    }
    return [...buckets.entries()]
      .map(([group, list]) => ({ group, items: list }))
      .sort((a, b) => (a.group === "" ? 1 : b.group === "" ? -1 : 0));
  },
};

export function installSavedEffects() {
  installPersistence(KEY, items, setItems, revive);
}
