import { installPersistence, persistedSignal } from "./persisted";

/**
 * Notes the rider has closed, and does not want to see again.
 *
 * A closeable note that comes back on the next visit is not closeable, it is
 * nagging. Each note names itself with a stable id, and once closed that id is
 * kept - in storage, so it survives a reload and reaches the other tabs. There
 * is no way to bring one back from the app, on purpose: a note is for the
 * first reading, and a rider who closed it has done that.
 */
const KEY = "probus:dismissed";

const revive = (raw: unknown): string[] =>
  Array.isArray(raw) ? raw.filter((id): id is string => typeof id === "string") : [];

const [ids, setIds] = persistedSignal<string[]>(KEY, [], revive);

export const dismissed = {
  has: (id: string) => ids().includes(id),
  dismiss: (id: string) => {
    if (!ids().includes(id)) setIds([...ids(), id]);
  },
};

/** Once at start-up, from an owner that lives as long as the app. */
export function installDismissedEffects() {
  installPersistence(KEY, ids, setIds, revive);
}
