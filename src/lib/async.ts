import { createMemo, type Accessor } from "solid-js";

/**
 * Solid 2 resolves an async `createMemo` before handing the value to whoever
 * reads it - reading inside a `<Loading>` boundary suspends until it settles.
 * The release-candidate typings still describe the accessor as returning the
 * promise, so the unwrapping is asserted here, once, instead of at every call
 * site.
 */
export function createAsyncMemo<T>(compute: () => Promise<T>): Accessor<T> {
  return createMemo(compute) as unknown as Accessor<T>;
}
