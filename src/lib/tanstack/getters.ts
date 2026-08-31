/**
 * Merge objects without reading them.
 *
 * TanStack options are handed over as objects whose changing inputs are
 * getters onto signals - `get data() { return rows() }` - and the getter
 * must survive the merge, or the table is built from a snapshot and never
 * hears about the next one. A spread would call every getter once and keep
 * the value; this copies the descriptors instead, so each getter is still a
 * getter afterwards and is tracked wherever it is finally read. Later
 * sources win, as with a spread.
 *
 * Solid's own `merge` returns a proxy, and TanStack's cores take the merged
 * options apart with `Object.getOwnPropertyDescriptors`, which a proxy does
 * not answer in full. A plain object does.
 */
export function withGetters<T extends object>(...sources: object[]): T {
  const out: PropertyDescriptorMap = {};
  for (const source of sources) {
    for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(source))) {
      out[key] = { ...descriptor, configurable: true, enumerable: true };
    }
  }
  return Object.defineProperties({}, out) as T;
}
