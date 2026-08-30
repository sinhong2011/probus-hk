import {
  constructTable,
  type Cell,
  type Header,
  type RowData,
  type Table,
  type TableFeatures,
  type TableOptions,
} from "@tanstack/table-core";
import type { TableAtomOptions, TableReactivityBindings } from "@tanstack/table-core/reactivity";
import type { Atom, ReadonlyAtom, Subscription } from "@tanstack/store";
import {
  createEffect,
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  getOwner,
  onCleanup,
  runWithOwner,
  untrack,
  type Owner,
} from "solid-js";
import { Match, Show, Switch, createComponent, type JSX } from "@solidjs/web";
import { withGetters } from "./getters";

export * from "@tanstack/table-core";

/*
 * TanStack Table v9 is headless twice over: it owns no markup, and it owns no
 * reactivity either. Every piece of table state is an "atom" it asks the host
 * framework to create, so a Solid table can be built out of Solid signals and
 * memos - which means `table.getRowModel().rows` read in JSX is tracked like
 * any other read, and re-renders only the rows that changed.
 *
 * The official Solid adapter does exactly this for Solid 1. It reaches for
 * `createComputed`, `mergeProps` and `observable`, none of which survived into
 * Solid 2, so this is the same design on the primitives Solid 2 has.
 */

/**
 * What the table asks of an atom's subscription: tell me when this changes.
 *
 * Solid has no observable any more; a root with an effect in it is the same
 * thing. The effect's first run is the subscription being set up, not a
 * change, and is not reported - a TanStack Store atom does not report it
 * either, and the table's own bookkeeping assumes it will not.
 */
function subscribeSignal<T>(
  read: () => T,
  owner: Owner | null,
  next: (value: T) => void,
): Subscription {
  const dispose = runWithOwner(owner, () =>
    createRoot((dispose) => {
      let first = true;
      createEffect(read, (value) => {
        if (first) {
          first = false;
          return;
        }
        next(value);
      });
      return dispose;
    }),
  );
  return { unsubscribe: () => dispose?.() };
}

/** The table's reactivity, made of Solid signals and memos under one owner. */
function solidReactivity(owner: Owner | null): TableReactivityBindings {
  const subscriptions = new Set<Subscription>();

  return {
    createOptionsStore: true,
    wrapExternalAtoms: true,
    addSubscription: (subscription) => {
      subscriptions.add(subscription);
    },
    unmount: () => {
      subscriptions.forEach((subscription) => subscription.unsubscribe());
      subscriptions.clear();
    },
    schedule: (fn) => queueMicrotask(fn),
    createReadonlyAtom: <T,>(fn: () => T, options?: TableAtomOptions<T>): ReadonlyAtom<T> => {
      const read = createMemo(fn, { name: options?.debugName });
      return {
        get: () => read(),
        subscribe: ((observer: { next?: (value: T) => void } | ((value: T) => void)) =>
          subscribeSignal(read, owner, (value) =>
            typeof observer === "function" ? observer(value) : observer.next?.(value),
          )) as ReadonlyAtom<T>["subscribe"],
      };
    },
    createWritableAtom: <T,>(value: T, options?: TableAtomOptions<T>): Atom<T> => {
      const [read, write] = createSignal(value as Exclude<T, Function>, {
        equals: options?.compare,
        name: options?.debugName,
        // Written by the table from event handlers and its own scheduler.
        ownedWrite: true,
      });
      return {
        get: () => read(),
        set: ((next: T | ((prev: T) => T)) => {
          // A signal setter treats a function as an updater; a table state
          // value is never a function, so this is the same distinction.
          write(next as never);
        }) as Atom<T>["set"],
        subscribe: ((observer: { next?: (value: T) => void } | ((value: T) => void)) =>
          subscribeSignal(read, owner, (value) =>
            typeof observer === "function" ? observer(value) : observer.next?.(value),
          )) as Atom<T>["subscribe"],
      };
    },
    untrack,
    // Solid 2 batches on its own; there is nothing to open or close.
    batch: (fn) => fn(),
  };
}

export type SolidTable<TFeatures extends TableFeatures, TData extends RowData> = Table<
  TFeatures,
  TData
> & {
  /** Render a header, cell or footer through its column definition. */
  FlexRender: typeof FlexRender;
};

/**
 * A table whose every read is a Solid read.
 *
 * Give it changing inputs through getters - `get data() { return rows() }` -
 * and the row models recompute when they change, and nothing recomputes when
 * they do not. Feature sets and column definitions should be built once,
 * outside the component: they are the shape of the table, not its state.
 *
 * ```tsx
 * const features = tableFeatures({ rowSortingFeature, sortedRowModel: createSortedRowModel() });
 * const table = createTable({ features, columns, get data() { return rows(); } });
 * <For each={table.getRowModel().rows}>{(row) => …}</For>
 * ```
 */
export function createTable<TFeatures extends TableFeatures, TData extends RowData>(
  tableOptions: TableOptions<TFeatures, TData>,
): SolidTable<TFeatures, TData> {
  const owner = getOwner();
  const reactivity = solidReactivity(owner);

  const withReactivity = withGetters<TableOptions<TFeatures, TData>>(tableOptions, {
    features: { coreReactivityFeature: reactivity, ...tableOptions.features },
  });

  const resolved = withGetters<TableOptions<TFeatures, TData>>(
    {
      // Getters stay getters through every merge the table does later, so an
      // option read from a signal is read from the signal each time.
      mergeOptions: (
        defaults: TableOptions<TFeatures, TData>,
        next: Partial<TableOptions<TFeatures, TData>>,
      ) => withGetters<TableOptions<TFeatures, TData>>(defaults, next),
    },
    withReactivity,
  );

  const table = constructTable(resolved);

  /*
   * State the caller controls arrives through `options.state`. Reading each
   * key subscribes to it; the effect then hands the table its options again,
   * which is how a controlled sort or filter reaches the row models.
   */
  createRenderEffect(
    () => {
      const state = tableOptions.state;
      if (state) for (const key in state) void state[key as keyof typeof state];
    },
    () => {
      untrack(() => table.setOptions((prev) => withGetters(prev, withReactivity)));
    },
  );

  onCleanup(() => reactivity.unmount?.());

  return Object.assign(table, { FlexRender });
}

type Renderable<TProps> =
  | ((props: TProps) => JSX.Element)
  | JSX.Element
  | string
  | null
  | undefined;

/**
 * Render a column definition's `header`, `cell` or `footer`.
 *
 * A definition may be a string, a static piece of JSX, or a component that
 * takes the cell's context; this is the one place that has to know which.
 */
export function flexRender<TProps extends object>(
  component: Renderable<TProps>,
  props: TProps,
): JSX.Element {
  if (component === null || component === undefined) return null;
  if (typeof component === "function") return createComponent(component, props);
  return component;
}

type FlexRenderProps<TFeatures extends TableFeatures, TData extends RowData> =
  | { cell: Cell<TFeatures, TData, unknown> }
  | { header: Header<TFeatures, TData, unknown> }
  | { footer: Header<TFeatures, TData, unknown> };

/**
 * `flexRender` as a component: `<table.FlexRender cell={cell} />`.
 *
 * A grouped table has cells that are aggregates of the rows under them, and
 * placeholders for the columns a group row does not span; both are drawn as
 * their definition says, or not at all.
 */
export function FlexRender<TFeatures extends TableFeatures, TData extends RowData>(
  props: FlexRenderProps<TFeatures, TData>,
): JSX.Element {
  return (
    <Switch>
      <Match when={"cell" in props ? props.cell : undefined} keyed>
        {(cell) => {
          const def = cell.column.columnDef as {
            cell?: Renderable<unknown>;
            aggregatedCell?: Renderable<unknown>;
          };
          const grouping = cell as {
            getIsAggregated?: () => boolean;
            getIsPlaceholder?: () => boolean;
          };
          return (
            <Show
              when={grouping.getIsAggregated?.()}
              fallback={
                <Show when={!grouping.getIsPlaceholder?.()}>
                  {flexRender(def.cell, cell.getContext())}
                </Show>
              }
            >
              {flexRender(def.aggregatedCell ?? def.cell, cell.getContext())}
            </Show>
          );
        }}
      </Match>
      <Match when={"header" in props ? props.header : undefined} keyed>
        {(header) =>
          flexRender(
            (header.column.columnDef as { header?: Renderable<unknown> }).header,
            header.getContext(),
          )
        }
      </Match>
      <Match when={"footer" in props ? props.footer : undefined} keyed>
        {(footer) =>
          flexRender(
            (footer.column.columnDef as { footer?: Renderable<unknown> }).footer,
            footer.getContext(),
          )
        }
      </Match>
    </Switch>
  );
}
