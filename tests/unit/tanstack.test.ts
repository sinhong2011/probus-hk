// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot, createSignal, flush } from "solid-js";
import { Store } from "@tanstack/store";
import { createStoreSignal } from "~/lib/tanstack/store";
import {
  createColumnHelper,
  createSortedRowModel,
  createTable,
  rowSortingFeature,
  sortFns,
  tableFeatures,
} from "~/lib/tanstack/table";
import { createVirtualizer } from "~/lib/tanstack/virtual";
import { createAsyncQueuer, createDebouncedSignal } from "~/lib/tanstack/pacer";
import { createHotkey } from "~/lib/tanstack/hotkeys";

/**
 * The Solid 2 bindings over the TanStack cores. Each test is the smallest
 * thing that proves the binding is reactive: a change on one side shows up on
 * the other without anything being called by hand.
 */

describe("createStoreSignal", () => {
  it("follows the store", () => {
    createRoot((dispose) => {
      const store = new Store({ n: 1 });
      const n = createStoreSignal(store, (s) => s.n);
      expect(n()).toBe(1);
      store.setState(() => ({ n: 2 }));
      flush();
      expect(n()).toBe(2);
      dispose();
    });
  });
});

describe("createTable", () => {
  type Person = { name: string };
  const features = tableFeatures({
    rowSortingFeature,
    sortedRowModel: createSortedRowModel(sortFns),
  });
  const helper = createColumnHelper<typeof features, Person>();
  const columns = helper.columns([helper.accessor("name", { header: "Name" })]);

  it("re-derives rows from a data getter, and sorts on request", () => {
    createRoot((dispose) => {
      // Written from inside the root, which Solid counts as an owned scope.
      const [data, setData] = createSignal<Person[]>([{ name: "Zed" }, { name: "Ada" }], {
        ownedWrite: true,
      });
      const table = createTable({
        features,
        columns,
        get data() {
          return data();
        },
      });

      expect(table.getRowModel().rows.map((r) => r.original.name)).toEqual(["Zed", "Ada"]);

      setData([{ name: "Zed" }, { name: "Ada" }, { name: "Mia" }]);
      flush();
      expect(table.getRowModel().rows).toHaveLength(3);

      table.setSorting([{ id: "name", desc: false }]);
      flush();
      expect(table.getRowModel().rows.map((r) => r.original.name)).toEqual(["Ada", "Mia", "Zed"]);
      dispose();
    });
  });
});

describe("createVirtualizer", () => {
  it("draws only what fits, and follows the count", () => {
    createRoot((dispose) => {
      const pane = document.createElement("div");
      document.body.appendChild(pane);
      const [count, setCount] = createSignal(100, { ownedWrite: true });
      const virtualizer = createVirtualizer({
        get count() {
          return count();
        },
        getScrollElement: () => pane,
        estimateSize: () => 50,
        // jsdom lays nothing out; this is the viewport it would have measured.
        initialRect: { width: 300, height: 200 },
        observeElementRect: (_instance, cb) => cb({ width: 300, height: 200 }),
        observeElementOffset: (_instance, cb) => cb(0, false),
        overscan: 0,
      });
      flush();

      const drawn = virtualizer.getVirtualItems().length;
      expect(drawn).toBeGreaterThan(0);
      expect(drawn).toBeLessThan(100);
      expect(virtualizer.getTotalSize()).toBe(100 * 50);

      setCount(2);
      flush();
      expect(virtualizer.getVirtualItems()).toHaveLength(2);
      expect(virtualizer.getTotalSize()).toBe(100);
      dispose();
    });
  });
});

describe("pacer", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("a debounced signal settles once the writes stop", () => {
    createRoot((dispose) => {
      const [value, set] = createDebouncedSignal(0, { wait: 100 });
      set(1);
      set(2);
      flush();
      expect(value()).toBe(0);
      vi.advanceTimersByTime(100);
      flush();
      expect(value()).toBe(2);
      dispose();
    });
  });

  it("an async queuer caps how many run at once", async () => {
    vi.useRealTimers();
    let running = 0;
    let peak = 0;
    const done: number[] = [];
    await createRoot(async (dispose) => {
      const queuer = createAsyncQueuer(
        async (n: number) => {
          running += 1;
          peak = Math.max(peak, running);
          await new Promise((r) => setTimeout(r, 5));
          running -= 1;
          done.push(n);
        },
        { concurrency: 2 },
      );
      for (const n of [1, 2, 3, 4, 5]) queuer.addItem(n);
      await vi.waitFor(() => expect(done).toHaveLength(5));
      expect(peak).toBe(2);
      dispose();
    });
  });
});

describe("createHotkey", () => {
  it("fires on the key, and stops when disposed", () => {
    const pressed = vi.fn();
    const press = () =>
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "K", code: "KeyK", shiftKey: true, bubbles: true }),
      );

    const dispose = createRoot((dispose) => {
      createHotkey("Shift+K", pressed);
      return dispose;
    });
    flush();
    press();
    expect(pressed).toHaveBeenCalledTimes(1);

    dispose();
    press();
    expect(pressed).toHaveBeenCalledTimes(1);
  });
});

describe("createLiveQuery", () => {
  it("answers, then keeps answering as the collection changes", async () => {
    // jsdom under vitest hands out a localStorage with no methods on it, and
    // TanStack DB reads one key from it for its index dev-mode switch.
    const memory = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => memory.get(k) ?? null,
      setItem: (k: string, v: string) => void memory.set(k, v),
      removeItem: (k: string) => void memory.delete(k),
    });
    const { createCollection, localOnlyCollectionOptions, eq } = await import("~/lib/tanstack/db");
    const { createLiveQuery } = await import("~/lib/tanstack/db");
    const { resolve } = await import("solid-js");
    type Todo = { id: number; done: boolean };
    const todos = createCollection(
      localOnlyCollectionOptions<Todo, number>({
        getKey: (todo) => todo.id,
        initialData: [
          { id: 1, done: true },
          { id: 2, done: false },
        ],
      }),
    );

    await createRoot(async (dispose) => {
      const done = createLiveQuery<Todo>((q) =>
        q.from({ t: todos }).where(({ t }) => eq(t.done, true)),
      );
      expect(await resolve(() => done().map((t) => t.id))).toEqual([1]);

      todos.insert({ id: 3, done: true });
      await vi.waitFor(() => expect(done().map((t) => t.id)).toEqual([1, 3]));

      todos.update(1, (draft) => {
        draft.done = false;
      });
      await vi.waitFor(() => expect(done().map((t) => t.id)).toEqual([3]));
      dispose();
    });
  });
});
