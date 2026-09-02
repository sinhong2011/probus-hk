import { persistedCollection } from "./collection";
import type { Company } from "~/data/types";

/*
 * Stars are the one thing a rider builds up in this app, and they live
 * in a TanStack DB collection: every change is a transaction, the collection
 * writes itself to storage and reads back what another tab wrote, and the
 * list any screen shows is derived from it. The store's surface is the same
 * as it was when this was a signal and a `JSON.stringify` - the screens did
 * not have to learn anything.
 */

export interface StarredItem {
  /** Stable identity so reorder and removal do not depend on array position. */
  id: string;
  /**
   * Empty when this is the stop itself, not a route that happens to call
   * there. The Starred screen then shows every line at the kerb.
   */
  routeKey: string;
  co: Company;
  stopId: string;
  seq: number;
  /** Free-text grouping such as 上班 / 週末, or "" for ungrouped. */
  group: string;
  /**
   * Held at the top of the list, whatever the order says.
   *
   * The one star you actually leave the house by should not move because a
   * bus on another route happens to be closer this minute. Absent on every
   * star that has never been pinned, so an old stored list needs no
   * migration.
   */
  pinned?: boolean;
  /**
   * The rider's own arrangement, as a rank. A collection is a set, not a
   * list, so the order the array used to carry by position is a field now.
   */
  order: number;
}

export function starredId(routeKey: string, stopId: string): string {
  return routeKey === "" ? `stop:${stopId}` : `${routeKey}@${stopId}`;
}

export const STARRED_EXPORT_VERSION = 1;

export interface StarredExport {
  version: typeof STARRED_EXPORT_VERSION;
  exportedAt: string;
  items: StarredItem[];
}

export type StarredImportMode = "merge" | "replace";

export interface StarredImportResult {
  added: number;
  skipped: number;
  invalid: number;
}

const COMPANIES = new Set<Company>([
  "kmb",
  "ctb",
  "nlb",
  "gmb",
  "mtr",
  "lightRail",
  "lrtfeeder",
  "sunferry",
  "hkkf",
  "fortuneferry",
]);

function isCompany(value: unknown): value is Company {
  return typeof value === "string" && COMPANIES.has(value as Company);
}

function normalizeItem(raw: unknown, fallbackOrder: number): StarredItem | null {
  if (!raw || typeof raw !== "object") return null;
  const item = raw as Partial<StarredItem>;
  if (typeof item.stopId !== "string" || !item.stopId) return null;
  if (typeof item.seq !== "number" || !Number.isFinite(item.seq)) return null;
  if (!isCompany(item.co)) return null;

  const routeKey = typeof item.routeKey === "string" ? item.routeKey : "";
  const group = typeof item.group === "string" ? item.group : "";
  const id = typeof item.id === "string" && item.id ? item.id : starredId(routeKey, item.stopId);
  const order =
    typeof item.order === "number" && Number.isFinite(item.order) ? item.order : fallbackOrder;
  const pinned = item.pinned === true ? true : undefined;

  return {
    id,
    routeKey,
    co: item.co,
    stopId: item.stopId,
    seq: item.seq,
    group,
    ...(pinned ? { pinned } : {}),
    order,
  };
}

function parsePayload(raw: unknown): { items: StarredItem[]; invalid: number } | null {
  const list = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object" && Array.isArray((raw as StarredExport).items)
      ? (raw as StarredExport).items
      : null;
  if (!list) return null;

  const items: StarredItem[] = [];
  for (let index = 0; index < list.length; index++) {
    const item = normalizeItem(list[index], index);
    if (item) items.push(item);
  }
  return { items, invalid: list.length - items.length };
}

function exportStarred(): StarredExport {
  const items = current().map(({ id, routeKey, co, stopId, seq, group, pinned, order }) => {
    const item: StarredItem = { id, routeKey, co, stopId, seq, group, order };
    if (pinned) item.pinned = true;
    return item;
  });
  return {
    version: STARRED_EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    items,
  };
}

function downloadStarredExport() {
  const payload = exportStarred();
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `probus-starred-${payload.exportedAt.slice(0, 10)}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function importStarred(raw: unknown, mode: StarredImportMode = "merge"): StarredImportResult {
  const parsed = parsePayload(raw);
  if (!parsed) throw new Error("invalid starred export");

  const result: StarredImportResult = { added: 0, skipped: 0, invalid: parsed.invalid };
  const incoming = parsed.items.slice().sort((a, b) => a.order - b.order);

  if (mode === "replace") {
    for (const item of current()) stars.delete(item.id);
    incoming.forEach((item, order) => {
      stars.insert({ ...item, order });
      result.added++;
    });
    return result;
  }

  const existing = new Set(current().map((item) => item.id));
  let order = nextOrder();
  for (const item of incoming) {
    if (existing.has(item.id)) {
      result.skipped++;
      continue;
    }
    stars.insert({ ...item, order });
    existing.add(item.id);
    order++;
    result.added++;
  }
  return result;
}

/** A star of the kerb, not of one line that calls there. */
export function isStopStar(item: Pick<StarredItem, "routeKey">): boolean {
  return item.routeKey === "";
}

/** A stored list that is not a list is not a star list. */
const revive = (raw: unknown): StarredItem[] =>
  Array.isArray(raw)
    ? (raw as Omit<StarredItem, "order">[]).map((item, order) => ({ ...item, order }))
    : [];

const store = persistedCollection<StarredItem>({
  id: "starred",
  storageKey: "probus:db:starred",
  getKey: (item) => item.id,
  // The keys an older build kept: each star's position in the array becomes its rank.
  legacyKeys: ["probus:db:bookmarks", "probus:saved", "motherbus:saved"],
  revive,
});
export const stars = store.collection;

const byOrder = (a: StarredItem, b: StarredItem) => a.order - b.order;
/** The list, in rank order, as a signal. */
const items = () => store.rows().slice().sort(byOrder);
/** The list as the collection has it this instant - see `persistedCollection`. */
const current = () => store.current().sort(byOrder);

/** One past the highest rank, for a star joining the end of the list. */
const nextOrder = () => current().reduce((max, item) => Math.max(max, item.order + 1), 0);

export const starred = {
  items,

  has(routeKey: string, stopId: string): boolean {
    const id = starredId(routeKey, stopId);
    return items().some((i) => i.id === id);
  },

  toggle(entry: Omit<StarredItem, "id" | "group" | "order"> & { group?: string }) {
    const id = starredId(entry.routeKey, entry.stopId);
    if (stars.has(id)) stars.delete(id);
    else stars.insert({ ...entry, id, group: entry.group ?? "", order: nextOrder() });
  },

  remove(id: string) {
    if (stars.has(id)) stars.delete(id);
  },

  setGroup(id: string, group: string) {
    if (!stars.has(id)) return;
    stars.update(id, (draft) => {
      draft.group = group;
    });
  },

  /**
   * Pins or unpins one star.
   *
   * The flag is cleared rather than set to `false` when it comes off - a
   * collection cannot take a field away from a row, but storage drops an
   * `undefined` on the way out - so an unpinned star is stored exactly
   * as one that was never pinned.
   */
  togglePin(id: string) {
    if (!stars.has(id)) return;
    stars.update(id, (draft) => {
      draft.pinned = draft.pinned ? undefined : true;
    });
  },

  /**
   * Points a star at another stop on the same route.
   *
   * Its identity follows the stop, so a star already sitting at the target
   * absorbs this one rather than ending up beside it as a duplicate. The place
   * in the list and the group are the rider's own arrangement and are kept.
   */
  retarget(id: string, to: { co: Company; stopId: string; seq: number }) {
    const item = stars.get(id);
    if (!item || isStopStar(item)) return;
    const next = starredId(item.routeKey, to.stopId);
    if (next === id) return;
    const { id: _old, ...carried } = item;
    if (stars.has(next)) {
      // Absorbed in place: the star already there takes this one's
      // arrangement. A delete and an insert under one key do not both land.
      stars.update(next, (draft) => Object.assign(draft, carried, to));
    } else {
      stars.insert({ ...carried, ...to, id: next });
    }
    stars.delete(id);
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

    // Only the stars whose rank actually changed are written.
    const changed = next.filter((item, order) => item.order !== order).map((item) => item.id);
    if (changed.length === 0) return;
    const rank = new Map(next.map((item, order) => [item.id, order]));
    stars.update(changed, (drafts) => {
      for (const draft of drafts) draft.order = rank.get(draft.id) ?? draft.order;
    });
  },

  /**
   * Takes an order the rider is already looking at and makes it the stored
   * one, so switching to manual order does not shuffle the list on the way in:
   * the ranked view they were dragging towards becomes the starting point.
   */
  adopt(ids: string[]) {
    const rank = new Map(ids.map((id, index) => [id, index]));
    const changed = current()
      .filter((item) => rank.has(item.id) && item.order !== rank.get(item.id))
      .map((item) => item.id);
    if (changed.length === 0) return;
    stars.update(changed, (drafts) => {
      for (const draft of drafts) draft.order = rank.get(draft.id) ?? draft.order;
    });
  },

  /** Every group a star has been put in, in the order they were made. */
  groups(): string[] {
    const seen: string[] = [];
    for (const item of items()) {
      if (item.group && !seen.includes(item.group)) seen.push(item.group);
    }
    return seen;
  },

  /** Grouped for display, in insertion order, ungrouped last. */
  grouped(): { group: string; items: StarredItem[] }[] {
    const buckets = new Map<string, StarredItem[]>();
    for (const item of items()) {
      const bucket = buckets.get(item.group);
      if (bucket) bucket.push(item);
      else buckets.set(item.group, [item]);
    }
    return [...buckets.entries()]
      .map(([group, list]) => ({ group, items: list }))
      .sort((a, b) => (a.group === "" ? 1 : b.group === "" ? -1 : 0));
  },

  export: exportStarred,
  downloadExport: downloadStarredExport,
  import: importStarred,
};

/**
 * Brings the list in. Called once at start-up, before any screen reads it:
 * an older build's list is adopted if there is one, and from then on every
 * change the collection sees - this tab's or another's - lands in `items`.
 */
export function installStarredEffects() {
  store.install();
}
