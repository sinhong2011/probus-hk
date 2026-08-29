import { createSignal } from "solid-js";

export interface Toast {
  id: number;
  title: string;
  body: string;
  /** `alert` is the loud one: a reminder the rider asked to be interrupted by. */
  tone: "plain" | "alert";
}

/** How long a banner stays before it withdraws itself. */
const LIFETIME_MS = 9_000;

/*
 * App-wide store, written from effects and event handlers alike; Solid 2 wants
 * that declared rather than inferred.
 */
const [items, setItems] = createSignal<Toast[]>([], { ownedWrite: true });

let nextId = 1;

export const toast = {
  items,

  show(title: string, body: string, tone: Toast["tone"] = "plain") {
    const id = nextId++;
    setItems((prev) => [...prev, { id, title, body, tone }]);
    window.setTimeout(() => toast.dismiss(id), LIFETIME_MS);
    return id;
  },

  dismiss(id: number) {
    setItems((prev) => prev.filter((t) => t.id !== id));
  },
};
