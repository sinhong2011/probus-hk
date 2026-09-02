import { persistedCollection } from "./collection";

/**
 * Notes the rider has closed, and does not want to see again.
 *
 * A closeable note that comes back on the next visit is not closeable, it is
 * nagging. Each note names itself with a stable id, and once closed that id is
 * kept - in storage, so it survives a reload and reaches the other tabs. There
 * is no way to bring one back from the app, on purpose: a note is for the
 * first reading, and a rider who closed it has done that.
 */
interface Dismissal {
  id: string;
}

const store = persistedCollection<Dismissal>({
  id: "dismissed",
  storageKey: "probus:db:dismissed",
  getKey: (row) => row.id,
  legacyKeys: ["probus:dismissed", "motherbus:dismissed"],
  revive: (raw) =>
    Array.isArray(raw)
      ? raw.filter((id): id is string => typeof id === "string").map((id) => ({ id }))
      : [],
});

export const dismissed = {
  has: (id: string) => store.rows().some((row) => row.id === id),
  dismiss: (id: string) => {
    if (!store.collection.has(id)) store.collection.insert({ id });
  },

  ids(): string[] {
    return store.current().map((row) => row.id);
  },

  replaceAll(ids: string[]) {
    const current = store.current().map((row) => row.id);
    if (current.length > 0) store.collection.delete(current);
    if (ids.length > 0) store.collection.insert(ids.map((id) => ({ id })));
  },

  mergeAll(ids: string[]) {
    for (const id of ids) {
      if (!store.collection.has(id)) store.collection.insert({ id });
    }
  },
};

/** Once at start-up, from an owner that lives as long as the app. */
export function installDismissedEffects() {
  store.install();
}
