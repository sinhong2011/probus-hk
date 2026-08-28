import { createEffect, createSignal, onCleanup, type Accessor, type Setter } from "solid-js";

/**
 * A signal backed by `localStorage`, kept in step across tabs.
 *
 * `@solid-primitives/storage` is the library for this, but it peers on
 * `solid-js@^1`, and this app runs Solid 2 - the same wall the motion libraries
 * hit. Hand-rolling it is a dozen lines and gets one thing the three separate
 * copies it replaces did not: another tab's writes land here. Bookmarking a
 * route in one tab used to leave every other tab showing the old list until it
 * was reloaded.
 *
 * Every read and write is guarded: private mode and blocked site data both
 * throw rather than return null, and neither is a reason to lose the session.
 */
export function persistedSignal<T>(
  key: string,
  fallback: T,
  /** Repairs a stored value that no longer matches the current shape. */
  revive: (raw: unknown) => T = (raw) => raw as T,
): [Accessor<T>, Setter<T>] {
  const read = (): T => {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? fallback : revive(JSON.parse(raw));
    } catch {
      return fallback;
    }
  };

  /*
   * App-wide state, written from event handlers, effects and component setup
   * alike; Solid 2 wants that declared rather than inferred.
   */
  const [value, setValue] = createSignal(read() as Exclude<T, Function>, {
    ownedWrite: true,
  }) as unknown as [Accessor<T>, Setter<T>];

  return [value, setValue as Setter<T>];
}

/**
 * Wires a persisted signal to storage: writes on change, and reads back what
 * another tab wrote. Called once at start-up, from an owner that lives as long
 * as the app.
 */
export function installPersistence<T>(
  key: string,
  value: Accessor<T>,
  setValue: (next: T) => void,
  revive: (raw: unknown) => T = (raw) => raw as T,
) {
  createEffect(
    () => value(),
    (current) => {
      try {
        localStorage.setItem(key, JSON.stringify(current));
      } catch {
        // Storage unavailable: the session still works, it just will not last.
      }
    },
  );

  // `storage` only fires in the *other* tabs, so this cannot echo its own write.
  const onStorage = (event: StorageEvent) => {
    if (event.key !== key || event.newValue === null) return;
    try {
      setValue(revive(JSON.parse(event.newValue)));
    } catch {
      // Another tab wrote something unreadable; keep what is already here.
    }
  };

  window.addEventListener("storage", onStorage);
  onCleanup(() => window.removeEventListener("storage", onStorage));
}
