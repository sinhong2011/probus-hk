import { For, Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js";
import type { JSX } from "@solidjs/web";
import {
  createCustomVirtualizer,
  elementScroll,
  observeElementOffset,
  observeElementRect,
  observeWindowOffset,
  observeWindowRect,
  windowScroll,
  type VirtualizerOptions,
} from "~/lib/tanstack/virtual";
import { Hairline } from "./Chrome";

/** The nearest ancestor that scrolls, or nothing if the page does. */
function scrollParent(el: HTMLElement): HTMLElement | null {
  for (let node = el.parentElement; node; node = node.parentElement) {
    const overflow = getComputedStyle(node).overflowY;
    if (overflow === "auto" || overflow === "scroll") return node;
  }
  return null;
}

/**
 * A long list of rows, only the visible ones in the DOM.
 *
 * Two thousand routes is more than any screen shows, and it used to be paged
 * - sixty at a time, a button at the bottom - which meant the list was never
 * all there to scroll through, and the scrollbar lied about its length. This
 * draws the rows in the window and a few beyond it, and the list is as long
 * as it is.
 *
 * What scrolls is not the list's business: on a phone it is the page, on a
 * wide window it is the pane the list sits in. The container is found from
 * the DOM when the list mounts and again when the window changes size, and
 * the virtualiser is pointed at whichever it is.
 */
export function VirtualRows<T>(props: {
  items: T[];
  /** A typical row height in pixels; rows are measured once drawn. */
  estimate: number;
  /** A hairline between rows, as a card of rows has. */
  divided?: boolean;
  children: (item: T, index: number) => JSX.Element;
}) {
  const [list, setList] = createSignal<HTMLDivElement>();
  const [scroller, setScroller] = createSignal<HTMLElement | Window>(window, {
    ownedWrite: true,
  });
  /** Where the list starts inside whatever scrolls, so row 0 is at the top of the list, not of the pane. */
  const [margin, setMargin] = createSignal(0, { ownedWrite: true });

  const place = () => {
    const el = list();
    if (!el) return;
    const pane = scrollParent(el);
    setScroller(pane ?? window);
    const top = el.getBoundingClientRect().top;
    setMargin(
      pane ? top - pane.getBoundingClientRect().top + pane.scrollTop : top + window.scrollY,
    );
  };

  // Placed once mounted, and again whenever the list above it could have
  // changed height - a different set of rows means a different screen.
  createEffect(
    () => [list(), props.items.length] as const,
    () => {
      place();
    },
  );
  window.addEventListener("resize", place);
  onCleanup(() => window.removeEventListener("resize", place));

  const isWindow = (target: HTMLElement | Window): target is Window => target === window;

  type Options = VirtualizerOptions<HTMLElement | Window, HTMLDivElement>;
  const virtualizer = createCustomVirtualizer<HTMLElement | Window, HTMLDivElement>({
    get count() {
      return props.items.length;
    },
    get estimateSize() {
      const size = props.estimate;
      return () => size;
    },
    // Read here so a change of scroller re-arms the virtualiser.
    get getScrollElement() {
      const target = scroller();
      return () => target;
    },
    get observeElementRect() {
      return (
        isWindow(scroller()) ? observeWindowRect : observeElementRect
      ) as Options["observeElementRect"];
    },
    get observeElementOffset() {
      return (
        isWindow(scroller()) ? observeWindowOffset : observeElementOffset
      ) as Options["observeElementOffset"];
    },
    get scrollToFn() {
      return (isWindow(scroller()) ? windowScroll : elementScroll) as Options["scrollToFn"];
    },
    get scrollMargin() {
      return margin();
    },
    overscan: 6,
  });

  const first = () => virtualizer.getVirtualItems()[0]?.index ?? 0;

  /*
   * When the list last became a different list. Rows drawn in that moment
   * are the list arriving and rise in a stagger, like every other list on
   * the app; rows drawn later are the rider scrolling, and a row that is
   * scrolled to must already be there - one that fades in a beat late reads
   * as the screen struggling to keep up.
   */
  let arrived = performance.now();
  createEffect(
    () => props.items,
    () => {
      arrived = performance.now();
    },
  );
  const arriving = () => performance.now() - arrived < 120;

  /*
   * The rows in range, and only the ones the list still has. The virtualiser
   * is told the new count in a later phase than the rows read the new items,
   * so for one flush after a list shrinks a row can point past its end. A row
   * handed no item threw, and the boundary above the whole app swapped every
   * screen out and back - which read as the page reloading on a keystroke,
   * with the field's focus gone.
   */
  const rows = createMemo(() =>
    virtualizer.getVirtualItems().filter((item) => item.index < props.items.length),
  );

  return (
    <div
      ref={setList}
      class="relative w-full"
      style={{ height: `${virtualizer.getTotalSize()}px` }}
    >
      <For each={rows()}>
        {(item) => (
          <div
            data-index={item.index}
            /* Measured when the row actually has a size, not once on a
               microtask. A row born inside a sheet or a switching screen is
               created before it is in the document, and a measurement taken
               there is 0 - which the virtualiser cached, so a one-route
               recent list stood zero pixels tall and its row lay over the
               categories under it. The observer's first report arrives once
               the row is laid out, and it keeps the measurement honest if
               the row later changes size. It reads the index off the
               element, so it must observe only after the attributes are on -
               which holds here, since nothing fires before layout. */
            ref={(el) => {
              if (typeof ResizeObserver === "undefined") {
                queueMicrotask(() => virtualizer.measureElement(el));
                return;
              }
              const watcher = new ResizeObserver(() => {
                if (el.isConnected) virtualizer.measureElement(el);
              });
              watcher.observe(el);
              onCleanup(() => watcher.disconnect());
            }}
            class="absolute left-0 top-0 w-full"
            style={{ transform: `translateY(${item.start - margin()}px)` }}
          >
            <Show when={props.divided && item.index > 0}>
              <Hairline />
            </Show>
            {/* Rows arrive a beat apart from the top of what is visible, so a
                new list is seen to arrive rather than to blink. Capped, so
                the bottom is not still arriving while the top is read. A
                rise, not a pop: a pop is for something small landing on a
                row, and a whole list of rows springing in from four-fifths
                size made the search screen shudder on every visit. */}
            <div
              class={{ "motion-safe:app-rise": arriving() }}
              style={{ "animation-delay": `${Math.min(item.index - first(), 8) * 24}ms` }}
            >
              {props.children(props.items[item.index] as T, item.index)}
            </div>
          </div>
        )}
      </For>
    </div>
  );
}
