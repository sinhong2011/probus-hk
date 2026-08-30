import { installPersistence, persistedSignal } from "./persisted";

// The old name, kept on purpose: renaming the key empties a rider's saved trips on every
// device that already has one.
const KEY = "probus:trips";

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

/** A stored list that is not a list is not a list of trips. */
const revive = (raw: unknown): SavedTrip[] => (Array.isArray(raw) ? (raw as SavedTrip[]) : []);

const [items, setItems] = persistedSignal<SavedTrip[]>(KEY, [], revive);

/**
 * The journeys a rider makes over and over.
 *
 * A bus app is asked the same question most days - home to work, work to the
 * station - and answering it should not mean typing both ends again. Only the
 * ends are kept: the buses that serve them change through the day, so the plan
 * is worked out afresh every time the trip is opened.
 */
export const trips = {
  items,

  has(from: TripEnd, to: TripEnd): boolean {
    const id = tripId(from, to);
    return items().some((t) => t.id === id);
  },

  toggle(from: TripEnd, to: TripEnd, label: string) {
    const id = tripId(from, to);
    setItems((prev) =>
      prev.some((t) => t.id === id)
        ? prev.filter((t) => t.id !== id)
        : [...prev, { id, from, to, label }],
    );
  },

  remove(id: string) {
    setItems((prev) => prev.filter((t) => t.id !== id));
  },
};

export function installTripEffects() {
  installPersistence(KEY, items, setItems, revive);
}
