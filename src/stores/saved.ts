import { createSignal } from "solid-js";
import { createCollection, localStorageCollectionOptions } from "~/lib/tanstack/db";
import type { Company } from "~/data/types";

/*
 * Bookmarks are the one thing a rider builds up in this app, and they live
 * in a TanStack DB collection: every change is a transaction, the collection
 * writes itself to storage and reads back what another tab wrote, and the
 * list any screen shows is derived from it. The store's surface is the same
 * as it was when this was a signal and a `JSON.stringify` - the screens did
 * not have to learn anything.
 */

const STORAGE_KEY = "probus:bookmarks";
/**
 * Where the list used to live: a plain array under the app's current name
 * and, before the rename, its old one. Read once, if the collection has
 * nothing of its own yet, and left in place - see `adoptLegacy`.
 */
const LEGACY_KEYS = ["probus:saved", "motherbus:saved"];

export interface SavedItem {
  /** Stable identity so reorder and removal do not depend on array position. */
  id: string;
  routeKey: string;
  co: Company;
  stopId: string;
  seq: number;
  /** Free-text grouping such as 上班 / 週末, or "" for ungrouped. */
  group: string;
  /**
   * Held at the top of the list, whatever the order says.
   *
   * The one bookmark you actually leave the house by should not move because a
   * bus on another route happens to be closer this minute. Absent on every
   * bookmark that has never been pinned, so an old stored list needs no
   * migration.
   */
  pinned?: boolean;
  /**
   * The rider's own arrangement, as a rank. A collection is a set, not a
   * list, so the order the array used to carry by position is a field now.
   */
  order: number;
}

export function savedId(routeKey: string, stopId: string): string {
  return `${routeKey}@${stopId}`;
}

const bookmarks = createCollection({
  ...localStorageCollectionOptions<SavedItem, string>({
    id: "bookmarks",
    storageKey: STORAGE_KEY,
    getKey: (item) => item.id,
  }),
  startSync: true,
});

/*
 * The list, as a signal: the collection publishes every change, this side
 * keeps them sorted. A signal rather than a live query because the store is
 * read from event handlers and component setup as well as from JSX, and a
 * read there must answer at once rather than suspend.
 */
const [items, setItems] = createSignal<SavedItem[]>([], { ownedWrite: true });
const byOrder = (a: SavedItem, b: SavedItem) => a.order - b.order;
const publish = () => setItems([...bookmarks.values()].sort(byOrder));

/** A stored list that is not a list is not a bookmark list. */
const revive = (raw: unknown): Omit<SavedItem, "order">[] =>
  Array.isArray(raw) ? (raw as Omit<SavedItem, "order">[]) : [];

/**
 * A list saved by an earlier build, carried into the collection.
 *
 * Only when the collection has never been written: the array's position
 * becomes each bookmark's rank. The old copy is not removed, so a tab still
 * on the old build keeps its list and nothing is lost if this fails.
 */
function adoptLegacy() {
  try {
    if (localStorage.getItem(STORAGE_KEY) !== null) return;
    for (const key of LEGACY_KEYS) {
      const raw = localStorage.getItem(key);
      if (raw === null) continue;
      const list = revive(JSON.parse(raw));
      if (list.length > 0) bookmarks.insert(list.map((item, order) => ({ ...item, order })));
      return;
    }
  } catch {
    // Storage unavailable or unreadable: start empty, as a new install would.
  }
}

/**
 * The list as the collection has it this instant, in rank order.
 *
 * The collection applies a change the moment it is asked and publishes it a
 * beat later; anything deciding the next change - a rank, an absorbed
 * duplicate - reads the collection, not the signal, so two quick taps do
 * not both see the list as it was before either.
 */
const current = () => [...bookmarks.values()].sort(byOrder);

/** One past the highest rank, for a bookmark joining the end of the list. */
const nextOrder = () => current().reduce((max, item) => Math.max(max, item.order + 1), 0);

export const saved = {
  items,

  has(routeKey: string, stopId: string): boolean {
    const id = savedId(routeKey, stopId);
    return items().some((i) => i.id === id);
  },

  toggle(entry: Omit<SavedItem, "id" | "group" | "order"> & { group?: string }) {
    const id = savedId(entry.routeKey, entry.stopId);
    if (bookmarks.has(id)) bookmarks.delete(id);
    else bookmarks.insert({ ...entry, id, group: entry.group ?? "", order: nextOrder() });
  },

  remove(id: string) {
    if (bookmarks.has(id)) bookmarks.delete(id);
  },

  setGroup(id: string, group: string) {
    if (!bookmarks.has(id)) return;
    bookmarks.update(id, (draft) => {
      draft.group = group;
    });
  },

  /**
   * Pins or unpins one bookmark.
   *
   * The flag is cleared rather than set to `false` when it comes off - a
   * collection cannot take a field away from a row, but storage drops an
   * `undefined` on the way out - so an unpinned bookmark is stored exactly
   * as one that was never pinned.
   */
  togglePin(id: string) {
    if (!bookmarks.has(id)) return;
    bookmarks.update(id, (draft) => {
      draft.pinned = draft.pinned ? undefined : true;
    });
  },

  /**
   * Points a bookmark at another stop on the same route.
   *
   * Its identity follows the stop, so a bookmark already sitting at the target
   * absorbs this one rather than ending up beside it as a duplicate. The place
   * in the list and the group are the rider's own arrangement and are kept.
   */
  retarget(id: string, to: { co: Company; stopId: string; seq: number }) {
    const item = bookmarks.get(id);
    if (!item) return;
    const next = savedId(item.routeKey, to.stopId);
    if (next === id) return;
    if (bookmarks.has(next)) bookmarks.delete(next);
    bookmarks.delete(id);
    bookmarks.insert({ ...item, ...to, id: next });
  },

  /** Moves `id` to sit at `toIndex` in the flat list, preserving the rest. */
  reorder(id: string, toIndex: number) {
    const list = current();
    const from = list.findIndex((i) => i.id === id);
    if (from < 0) return;
    const next = list.slice();
    const [moved] = next.splice(from, 1);
    if (!moved) return;
    next.splice(Math.max(0, Math.min(toIndex, next.length)), 0, moved);

    // Only the bookmarks whose rank actually changed are written.
    const changed = next.filter((item, order) => item.order !== order).map((item) => item.id);
    if (changed.length === 0) return;
    const rank = new Map(next.map((item, order) => [item.id, order]));
    bookmarks.update(changed, (drafts) => {
      for (const draft of drafts) draft.order = rank.get(draft.id) ?? draft.order;
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

/**
 * Brings the list in. Called once at start-up, before any screen reads it:
 * an older build's list is adopted if there is one, and from then on every
 * change the collection sees - this tab's or another's - lands in `items`.
 */
export function installSavedEffects() {
  adoptLegacy();
  bookmarks.subscribeChanges(publish, { includeInitialState: true });
}
