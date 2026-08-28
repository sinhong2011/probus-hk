import { createSignal, onCleanup, type Accessor } from "solid-js";

/**
 * Whether an element is on screen right now.
 *
 * A route page lists forty stops and every one of them wants live arrivals.
 * For KMB that is a single shared request, but most operators answer per stop,
 * so polling the whole list would mean forty calls every refresh. Reporting
 * live visibility rather than latching on first sight keeps the poll to the
 * handful of rows the rider can actually see.
 *
 * Without an IntersectionObserver (older engines, jsdom) everything counts as
 * visible: showing arrival times matters more than the saved requests.
 */
export function useInView(rootMargin = "220px"): [(el: Element) => void, Accessor<boolean>] {
  const [visible, setVisible] = createSignal(typeof IntersectionObserver === "undefined", {
    ownedWrite: true,
  });

  let observer: IntersectionObserver | undefined;

  const attach = (el: Element) => {
    if (typeof IntersectionObserver === "undefined") return;
    observer?.disconnect();
    observer = new IntersectionObserver(
      (entries) => {
        const last = entries[entries.length - 1];
        if (last) setVisible(last.isIntersecting);
      },
      { rootMargin },
    );
    observer.observe(el);
  };

  onCleanup(() => observer?.disconnect());

  return [attach, visible];
}
