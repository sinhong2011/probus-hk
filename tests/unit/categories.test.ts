import { describe, expect, it } from "vitest";
import fixture from "../fixtures/routeDb.json" with { type: "json" };
import { CATEGORIES, categoryById, categoryCounts, routesInCategory } from "~/data/categories";
import { routeAt } from "~/data/db";
import type { KeyedRoute, RouteDb } from "~/data/types";

const db = fixture as unknown as RouteDb;

function match(id: string, route: KeyedRoute): boolean {
  const category = categoryById(id);
  expect(category).toBeDefined();
  return category!.matches(route, db);
}

const kmb1 = routeAt(db, "1+1+CHUK YUEN ESTATE+STAR FERRY")!;
const nlb1 = routeAt(db, "1+1+Mui Wo Ferry Pier+Tai O")!;
const gmb1 = routeAt(
  db,
  "1+1+Central (Hong Kong Station Public Transport Interchange)+The Peak (Public Transport Terminus)",
)!;
const lr505 = routeAt(db, "505+1+Sam Shing+Siu Hong")!;

/** Builds a route that exists only to exercise one rule. */
function fake(overrides: Partial<KeyedRoute>): KeyedRoute {
  return { ...kmb1, key: "fake", ...overrides };
}

describe("catalogue", () => {
  it("has a unique id and both languages for every category", () => {
    const ids = CATEGORIES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of CATEGORIES) {
      expect(c.name.zh).not.toBe("");
      expect(c.name.en).not.toBe("");
      expect(c.hint.zh).not.toBe("");
    }
  });

  it("looks a category up by id and returns nothing for a bad one", () => {
    expect(categoryById("overnight")?.id).toBe("overnight");
    expect(categoryById("nope")).toBeUndefined();
  });
});

describe("overnight", () => {
  it("catches N routes", () => {
    expect(match("overnight", fake({ route: "N216" }))).toBe(true);
  });

  it("catches a route that runs through the small hours whatever its number", () => {
    // A band written 2310 -> 2620 runs until 02:20 the next morning.
    expect(match("overnight", fake({ route: "999", freq: { s: { "2310": ["2620", "1800"] } } }))).toBe(
      true,
    );
  });

  it("leaves an ordinary daytime route alone", () => {
    expect(match("overnight", fake({ route: "1", freq: { s: { "0600": ["2300", "600"] } } }))).toBe(
      false,
    );
  });
});

describe("airport", () => {
  it("catches the lettered airport families", () => {
    for (const route of ["A21", "E23", "S1", "NA29"]) {
      expect(match("airport", fake({ route }))).toBe(true);
    }
  });

  it("does not mistake an ordinary route for one", () => {
    expect(match("airport", kmb1)).toBe(false);
  });
});

describe("cross-boundary", () => {
  it("catches B routes", () => {
    expect(match("crossBoundary", fake({ route: "B3X" }))).toBe(true);
  });

  it("catches a route terminating at a control point", () => {
    expect(
      match("crossBoundary", fake({ route: "618", dest: { zh: "深圳灣口岸", en: "Shenzhen Bay" } })),
    ).toBe(true);
  });

  it("ignores a route that merely passes one", () => {
    // Airport routes call at the bridge port without being cross-boundary.
    expect(match("crossBoundary", fake({ route: "A11" }))).toBe(false);
  });
});

describe("cross-harbour", () => {
  it("is decided from stop coordinates, not the route number", () => {
    // The fixture's 102 runs Mei Foo to Shau Kei Wan.
    const joint = routesInCategory(db, categoryById("crossHarbour")!);
    expect(joint.some((r) => r.route === "102")).toBe(true);
  });

  it("does not flag a route that stays on one side", () => {
    // NLB 1 runs entirely on Lantau.
    expect(match("crossHarbour", nlb1)).toBe(false);
  });
});

describe("operator-based categories", () => {
  it("puts green minibus under minibus", () => {
    expect(match("minibus", gmb1)).toBe(true);
    expect(match("minibus", kmb1)).toBe(false);
  });

  it("puts a Citybus route, joint ones included, under Citybus", () => {
    expect(match("citybus", fake({ co: ["ctb"] }))).toBe(true);
    expect(match("citybus", fake({ co: ["kmb", "ctb"] }))).toBe(true);
    expect(match("citybus", kmb1)).toBe(false);
  });

  it("puts a KMB route under KMB and an NLB one under NLB", () => {
    expect(match("kmb", kmb1)).toBe(true);
    expect(match("kmb", nlb1)).toBe(false);
    expect(match("nlb", nlb1)).toBe(true);
  });

  it("puts light rail under rail", () => {
    expect(match("rail", lr505)).toBe(true);
  });

  it("puts Lantau bus under outlying islands", () => {
    expect(match("islands", nlb1)).toBe(true);
  });
});

describe("shape-based categories", () => {
  it("spots an express route by its suffix", () => {
    expect(match("express", fake({ route: "271X" }))).toBe(true);
    expect(match("express", fake({ route: "271" }))).toBe(false);
  });

  it("spots a circular route by its termini", () => {
    const same = { zh: "尖沙咀", en: "Tsim Sha Tsui" };
    expect(match("circular", fake({ orig: same, dest: same }))).toBe(true);
    expect(match("circular", kmb1)).toBe(false);
  });

  it("spots an MTR feeder by prefix, suffix or operator", () => {
    expect(match("feeder", fake({ route: "K12" }))).toBe(true);
    expect(match("feeder", fake({ route: "46M" }))).toBe(true);
  });
});

describe("counts", () => {
  it("reports a number for every category", () => {
    const counts = categoryCounts(db);
    for (const category of CATEGORIES) {
      expect(counts[category.id]).toBeGreaterThanOrEqual(0);
    }
  });

  it("counts each route once even though the database repeats it", () => {
    const counts = categoryCounts(db);
    const listed = routesInCategory(db, categoryById("minibus")!);
    expect(counts.minibus).toBe(listed.length);
  });

  it("never counts more routes than the database holds", () => {
    const counts = categoryCounts(db);
    const total = Object.keys(db.routeList).length;
    for (const value of Object.values(counts)) expect(value).toBeLessThanOrEqual(total);
  });
});
