import { createSignal, onCleanup, type Accessor } from "solid-js";
import { shallow, type Readable } from "@tanstack/store";

/**
 * A TanStack Store, read as a Solid signal.
 *
 * Every TanStack library that keeps state - a pacer's queue, the keys held
 * down right now, a table's atoms when nobody has given it better ones -
 * keeps it in a `@tanstack/store` and publishes changes by subscription. This
 * turns that subscription into a signal so the rest of the app can read it
 * where it reads everything else: JSX, memos and effects.
 *
 * The selector picks the slice; the comparison decides what counts as a
 * change. Shallow by default, so a selector that builds a fresh object each
 * time does not wake every reader on every store write.
 */
export function createStoreSignal<T, S = T>(
  source: Readable<T>,
  selector: (state: T) => S = (state) => state as unknown as S,
  compare: (prev: S, next: S) => boolean = shallow,
): Accessor<S> {
  const [selected, setSelected] = createSignal(selector(source.get()) as Exclude<S, Function>, {
    equals: compare,
    /*
     * Written from the store's own notifications, which arrive from timers,
     * keyboard events and promise callbacks - never from inside a computation.
     */
    ownedWrite: true,
  });
  const subscription = source.subscribe((snapshot) => {
    setSelected(() => selector(snapshot));
  });
  onCleanup(() => subscription.unsubscribe());
  return selected;
}
