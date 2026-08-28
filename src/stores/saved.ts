import { createEffect, createSignal } from "solid-js";
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

function load(): SavedItem[] {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as SavedItem[]) : [];
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
const [items, setItems] = createSignal<SavedItem[]>(load(), { ownedWrite: true });

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
  createEffect(
    () => items(),
    (list) => {
      try {
        localStorage.setItem(KEY, JSON.stringify(list));
      } catch {
        // Storage unavailable: pins last for the session only.
      }
    },
  );
}
