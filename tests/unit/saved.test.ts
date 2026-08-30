// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { flush } from "solid-js";

/**
 * The bookmark store on TanStack DB. Storage is a stub so each test starts
 * from a known list, and the module is re-imported so the collection is
 * built fresh against it.
 */
const memory = new Map<string, string>();
const storage = {
  getItem: (k: string) => memory.get(k) ?? null,
  setItem: (k: string, v: string) => void memory.set(k, v),
  removeItem: (k: string) => void memory.delete(k),
  clear: () => memory.clear(),
  key: () => null,
  length: 0,
};

const entry = (route: string, stop: string) => ({
  routeKey: route,
  co: "kmb" as const,
  stopId: stop,
  seq: 1,
});

/** The collection applies a change at once and publishes it a beat later. */
const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

async function fresh() {
  vi.resetModules();
  vi.stubGlobal("localStorage", storage);
  const mod = await import("~/stores/saved");
  mod.installSavedEffects();
  flush();
  return mod;
}

beforeEach(() => memory.clear());

describe("saved", () => {
  it("adopts a list saved by an older build, keeping its order", async () => {
    memory.set(
      "motherbus:saved",
      JSON.stringify([
        { id: "1@A", ...entry("1", "A"), group: "" },
        { id: "2@B", ...entry("2", "B"), group: "上班" },
      ]),
    );
    const { saved } = await fresh();
    expect(saved.items().map((i) => i.id)).toEqual(["1@A", "2@B"]);
    expect(saved.items()[1]?.order).toBe(1);
    // The old copy is left for a tab still running the old build.
    expect(memory.has("motherbus:saved")).toBe(true);
    expect(memory.has("probus:db:bookmarks")).toBe(true);
  });

  it("toggles, groups, pins and forgets", async () => {
    const { saved } = await fresh();
    saved.toggle(entry("1", "A"));
    saved.toggle(entry("2", "B"));
    await settled();
    expect(saved.has("1", "A")).toBe(true);
    expect(saved.items().map((i) => i.order)).toEqual([0, 1]);

    saved.setGroup("2@B", "週末");
    await settled();
    expect(saved.groups()).toEqual(["週末"]);
    expect(saved.grouped().map((g) => g.group)).toEqual(["週末", ""]);

    saved.togglePin("1@A");
    await settled();
    expect(saved.items()[0]?.pinned).toBe(true);
    saved.togglePin("1@A");
    await settled();
    expect(saved.items()[0]?.pinned).toBeFalsy();
    // Stored exactly as a bookmark that was never pinned.
    expect(memory.get("probus:db:bookmarks")).not.toContain('"pinned"');

    saved.toggle(entry("1", "A"));
    await settled();
    expect(saved.has("1", "A")).toBe(false);
    expect(JSON.parse(memory.get("probus:db:bookmarks") ?? "{}")).not.toHaveProperty("1@A");
  });

  it("reorders by rank, writing only what moved", async () => {
    const { saved } = await fresh();
    for (const [r, s] of [
      ["1", "A"],
      ["2", "B"],
      ["3", "C"],
    ])
      saved.toggle(entry(r!, s!));
    saved.reorder("3@C", 0);
    await settled();
    expect(saved.items().map((i) => i.id)).toEqual(["3@C", "1@A", "2@B"]);
    expect(saved.items().map((i) => i.order)).toEqual([0, 1, 2]);
  });

  it("retargets a bookmark to another stop, absorbing one already there", async () => {
    const { saved } = await fresh();
    saved.toggle(entry("1", "A"));
    saved.toggle(entry("1", "B"));
    saved.setGroup("1@A", "上班");
    saved.retarget("1@A", { co: "kmb", stopId: "B", seq: 5 });
    await settled();
    expect(saved.items().map((i) => i.id)).toEqual(["1@B"]);
    expect(saved.items()[0]).toMatchObject({ seq: 5, group: "上班", order: 0 });
  });
});
