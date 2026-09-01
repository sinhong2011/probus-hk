// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { flush } from "solid-js";

/**
 * The starred store on TanStack DB. Storage is a stub so each test starts
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
  const mod = await import("~/stores/starred");
  mod.installStarredEffects();
  flush();
  return mod;
}

beforeEach(() => memory.clear());

describe("starred", () => {
  it("adopts a list saved by an older build, keeping its order", async () => {
    memory.set(
      "motherbus:saved",
      JSON.stringify([
        { id: "1@A", ...entry("1", "A"), group: "" },
        { id: "2@B", ...entry("2", "B"), group: "上班" },
      ]),
    );
    const { starred } = await fresh();
    expect(starred.items().map((i) => i.id)).toEqual(["1@A", "2@B"]);
    expect(starred.items()[1]?.order).toBe(1);
    // The old copy is left for a tab still running the old build.
    expect(memory.has("motherbus:saved")).toBe(true);
    expect(memory.has("probus:db:starred")).toBe(true);
  });

  it("toggles, groups, pins and forgets", async () => {
    const { starred } = await fresh();
    starred.toggle(entry("1", "A"));
    starred.toggle(entry("2", "B"));
    await settled();
    expect(starred.has("1", "A")).toBe(true);
    expect(starred.items().map((i) => i.order)).toEqual([0, 1]);

    starred.setGroup("2@B", "週末");
    await settled();
    expect(starred.groups()).toEqual(["週末"]);
    expect(starred.grouped().map((g) => g.group)).toEqual(["週末", ""]);

    starred.togglePin("1@A");
    await settled();
    expect(starred.items()[0]?.pinned).toBe(true);
    starred.togglePin("1@A");
    await settled();
    expect(starred.items()[0]?.pinned).toBeFalsy();
    // Stored exactly as a star that was never pinned.
    expect(memory.get("probus:db:starred")).not.toContain('"pinned"');

    starred.toggle(entry("1", "A"));
    await settled();
    expect(starred.has("1", "A")).toBe(false);
    expect(JSON.parse(memory.get("probus:db:starred") ?? "{}")).not.toHaveProperty("1@A");
  });

  it("reorders by rank, writing only what moved", async () => {
    const { starred } = await fresh();
    for (const [r, s] of [
      ["1", "A"],
      ["2", "B"],
      ["3", "C"],
    ])
      starred.toggle(entry(r!, s!));
    starred.reorder("3@C", 0);
    await settled();
    expect(starred.items().map((i) => i.id)).toEqual(["3@C", "1@A", "2@B"]);
    expect(starred.items().map((i) => i.order)).toEqual([0, 1, 2]);
  });

  it("adopts a shown order as the stored ranks", async () => {
    const { starred } = await fresh();
    for (const [r, s] of [
      ["1", "A"],
      ["2", "B"],
      ["3", "C"],
    ])
      starred.toggle(entry(r!, s!));
    starred.adopt(["3@C", "1@A", "2@B"]);
    await settled();
    expect(starred.items().map((i) => i.id)).toEqual(["3@C", "1@A", "2@B"]);
    expect(starred.items().map((i) => i.order)).toEqual([0, 1, 2]);
  });

  it("stars a stop without binding a route", async () => {
    const { starred, isStopStar } = await fresh();
    starred.toggle({ routeKey: "", co: "kmb", stopId: "A", seq: 0 });
    await settled();
    expect(starred.has("", "A")).toBe(true);
    expect(starred.items()[0]).toMatchObject({ id: "stop:A", routeKey: "", stopId: "A" });
    expect(isStopStar(starred.items()[0]!)).toBe(true);

    starred.toggle(entry("1", "A"));
    await settled();
    expect(starred.has("1", "A")).toBe(true);
    expect(starred.items()).toHaveLength(2);

    starred.toggle({ routeKey: "", co: "kmb", stopId: "A", seq: 0 });
    await settled();
    expect(starred.has("", "A")).toBe(false);
    expect(starred.has("1", "A")).toBe(true);
  });

  it("retargets a star to another stop, absorbing one already there", async () => {
    const { starred } = await fresh();
    starred.toggle(entry("1", "A"));
    starred.toggle(entry("1", "B"));
    starred.setGroup("1@A", "上班");
    starred.retarget("1@A", { co: "kmb", stopId: "B", seq: 5 });
    await settled();
    expect(starred.items().map((i) => i.id)).toEqual(["1@B"]);
    expect(starred.items()[0]).toMatchObject({ seq: 5, group: "上班", order: 0 });
  });
});
