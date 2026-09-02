import { persistedCollection } from "./collection";

/** An end of a trip: where the rider is, or a stop they named. */
export type TripEnd = { kind: "me" } | { kind: "stop"; id: string };

export interface SavedTrip {
  /** Stable identity, so a trip can be dropped without depending on position. */
  id: string;
  from: TripEnd;
  to: TripEnd;
  /** What to call it in a list: the two ends, as they read when it was saved. */
  label: string;
}

export function tripId(from: TripEnd, to: TripEnd): string {
  const end = (e: TripEnd) => (e.kind === "me" ? "me" : e.id);
  return `${end(from)}>${end(to)}`;
}

const store = persistedCollection<SavedTrip>({
  id: "trips",
  storageKey: "probus:db:trips",
  getKey: (trip) => trip.id,
  legacyKeys: ["probus:trips", "motherbus:trips"],
});

/**
 * The journeys a rider makes over and over.
 *
 * A bus app is asked the same question most days - home to work, work to the
 * station - and answering it should not mean typing both ends again. Only the
 * ends are kept: the buses that serve them change through the day, so the plan
 * is worked out afresh every time the trip is opened.
 */
export const trips = {
  items: store.rows,

  has(from: TripEnd, to: TripEnd): boolean {
    const id = tripId(from, to);
    return store.rows().some((t) => t.id === id);
  },

  toggle(from: TripEnd, to: TripEnd, label: string) {
    const id = tripId(from, to);
    if (store.collection.has(id)) store.collection.delete(id);
    else store.collection.insert({ id, from, to, label });
  },

  remove(id: string) {
    if (store.collection.has(id)) store.collection.delete(id);
  },

  replaceAll(items: SavedTrip[]) {
    const ids = store.current().map((trip) => trip.id);
    if (ids.length > 0) store.collection.delete(ids);
    if (items.length > 0) store.collection.insert(items);
  },

  mergeAll(items: SavedTrip[]) {
    for (const item of items) {
      if (store.collection.has(item.id)) {
        store.collection.update(item.id, (draft) => Object.assign(draft, item));
      } else {
        store.collection.insert(item);
      }
    }
  },
};

export function installTripEffects() {
  store.install();
}
