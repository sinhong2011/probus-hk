import {
  Virtualizer,
  elementScroll,
  observeElementOffset,
  observeElementRect,
  observeWindowOffset,
  observeWindowRect,
  windowScroll,
  type PartialKeys,
  type VirtualItem,
  type VirtualizerOptions,
} from "@tanstack/virtual-core";
import {
  createEffect,
  createRenderEffect,
  createSignal,
  createStore,
  reconcile,
  runWithOwner,
  type Accessor,
} from "solid-js";
import { withGetters } from "./getters";

export * from "@tanstack/virtual-core";

/**
 * A list that only draws the rows in the window.
 *
 * Exported as the general form for a list whose scroll container is decided
 * at runtime - a pane on a wide window, the page on a phone - and given every
 * option by hand. `createVirtualizer` and `createWindowVirtualizer` are the
 * two usual cases, filled in.
 *
 * The core measures, scrolls and decides which rows are in range; this is the
 * few lines that let Solid see its answer. The row list is a store reconciled
 * by index, so a scroll that brings two new rows into view creates two rows
 * and leaves the rest of the DOM alone - a plain signal of a fresh array
 * would have torn every row down and built it again on every frame.
 *
 * Options are read through a lazy merge, so `count`, `getScrollElement` and
 * the rest can be getters onto signals and the virtualizer follows them.
 */
export function createCustomVirtualizer<
  TScrollElement extends Element | Window,
  TItemElement extends Element,
>(
  options: VirtualizerOptions<TScrollElement, TItemElement>,
): SolidVirtualizer<TScrollElement, TItemElement> {
  const instance = new Virtualizer<TScrollElement, TItemElement>(options);

  const [items, setItems] = createStore<{ list: VirtualItem[] }>({
    list: instance.getVirtualItems(),
  });
  const [totalSize, setTotalSize] = createSignal(instance.getTotalSize(), { ownedWrite: true });

  /*
   * The core reports from wherever it happens to be - a resize observer, a
   * scroll listener, and also from inside the render flush that handed it new
   * options, when a row measured differently. A write made there is a write
   * inside a computation, which Solid 2 refuses for a store (a signal can be
   * told `ownedWrite`; a store cannot). The publish is stepped outside the
   * owner for its duration: it creates nothing that would need disposing,
   * only writes, which is the one thing the guard is there to question.
   */
  const publish = () =>
    runWithOwner(null, () => {
      setItems(reconcile({ list: instance.getVirtualItems() }, "index"));
      setTotalSize(instance.getTotalSize());
    });

  const virtualizer = new Proxy(instance, {
    get(target, prop) {
      // The two reads that have to be reactive; everything else is the core's.
      if (prop === "getVirtualItems") return () => items.list;
      if (prop === "getTotalSize") return () => totalSize();
      return Reflect.get(target, prop);
    },
  }) as SolidVirtualizer<TScrollElement, TItemElement>;

  const resolved = withGetters<VirtualizerOptions<TScrollElement, TItemElement>>(options, {
    onChange: (changed: Virtualizer<TScrollElement, TItemElement>, sync: boolean) => {
      changed._willUpdate();
      publish();
      options.onChange?.(changed, sync);
    },
  });

  /*
   * The compute phase only reads - every option, so a change to any of them
   * re-arms the virtualizer - and the effect phase does the arming. Handing
   * the core new options can make it notify at once, and a notification is a
   * write, which the compute phase is not allowed to make.
   */
  createRenderEffect(
    () => {
      for (const key in resolved) void resolved[key as keyof typeof resolved];
    },
    () => {
      instance.setOptions(resolved);
      instance._willUpdate();
      publish();
    },
  );

  // Once the DOM is there: observe the scroll element, and let go of it after.
  createEffect(
    () => undefined,
    () => {
      const cleanup = instance._didMount();
      instance._willUpdate();
      return cleanup;
    },
  );

  return virtualizer;
}

export type SolidVirtualizer<
  TScrollElement extends Element | Window,
  TItemElement extends Element,
> = Omit<Virtualizer<TScrollElement, TItemElement>, "getVirtualItems" | "getTotalSize"> & {
  /** The rows in range right now, as a reactive read. */
  getVirtualItems: Accessor<VirtualItem[]>;
  /** How tall (or wide) the whole list would be if it were all drawn. */
  getTotalSize: Accessor<number>;
};

/** Virtualise inside a scrolling element - a pane with `overflow: auto`. */
export function createVirtualizer<TScrollElement extends Element, TItemElement extends Element>(
  options: PartialKeys<
    VirtualizerOptions<TScrollElement, TItemElement>,
    "observeElementRect" | "observeElementOffset" | "scrollToFn"
  >,
): SolidVirtualizer<TScrollElement, TItemElement> {
  return createCustomVirtualizer<TScrollElement, TItemElement>(
    withGetters<VirtualizerOptions<TScrollElement, TItemElement>>(
      { observeElementRect, observeElementOffset, scrollToFn: elementScroll },
      options,
    ),
  );
}

/** Virtualise against the window - a list that is the page itself. */
export function createWindowVirtualizer<TItemElement extends Element>(
  options: PartialKeys<
    VirtualizerOptions<Window, TItemElement>,
    "getScrollElement" | "observeElementRect" | "observeElementOffset" | "scrollToFn"
  >,
): SolidVirtualizer<Window, TItemElement> {
  return createCustomVirtualizer<Window, TItemElement>(
    withGetters<VirtualizerOptions<Window, TItemElement>>(
      {
        getScrollElement: () => (typeof document !== "undefined" ? window : null),
        observeElementRect: observeWindowRect,
        observeElementOffset: observeWindowOffset,
        scrollToFn: windowScroll,
      },
      options,
    ),
  );
}
