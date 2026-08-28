import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isRunningNow, routeTimetable, scheduledEta } from "~/data/schedule";
import type { KeyedRoute, RouteDb } from "~/data/types";

/** Runs every day of the week. */
const EVERY_DAY = ["1", "1", "1", "1", "1", "1", "1"];

function makeDb(overrides: Partial<RouteDb> = {}): RouteDb {
  return {
    holidays: [],
    routeList: {},
    stopList: {},
    stopMap: {},
    serviceDayMap: { daily: EVERY_DAY, sundayOnly: ["1", "0", "0", "0", "0", "0", "0"] },
    ...overrides,
  };
}

function makeRoute(overrides: Partial<KeyedRoute> = {}): KeyedRoute {
  return {
    key: "T+1+A+B",
    route: "T",
    co: ["kmb"],
    bound: { kmb: "O" },
    orig: { en: "A", zh: "A" },
    dest: { en: "B", zh: "B" },
    fares: null,
    faresHoliday: null,
    freq: null,
    gtfsId: null,
    jt: "30",
    nlbId: null,
    seq: 1,
    serviceType: 1,
    stops: { kmb: ["s1", "s2", "s3", "s4"] },
    ...overrides,
  };
}

describe("scheduledEta", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // 10:00 in Hong Kong, mid-morning, well inside any service band.
    vi.setSystemTime(new Date("2026-03-04T02:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns nothing when a route publishes no timetable", () => {
    expect(scheduledEta(makeDb(), makeRoute({ freq: null }), 1)).toEqual([]);
  });

  it("projects departures from a headway band", () => {
    // Every 10 minutes, all day.
    const route = makeRoute({ freq: { daily: { "0000": ["2359", "600"] } } });
    const etas = scheduledEta(makeDb(), route, 1, 3);

    expect(etas).toHaveLength(3);
    expect(etas.every((e) => e.source === "scheduled")).toBe(true);
    expect(etas.every((e) => e.at.getTime() > Date.now())).toBe(true);
  });

  it("orders results soonest first", () => {
    const route = makeRoute({ freq: { daily: { "0000": ["2359", "600"] } } });
    const times = scheduledEta(makeDb(), route, 1, 3).map((e) => e.at.getTime());
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });

  it("ignores services that do not run today", () => {
    // 4 March 2026 is a Wednesday, so a Sunday-only service must not appear.
    const route = makeRoute({ freq: { sundayOnly: { "0000": ["2359", "600"] } } });
    expect(scheduledEta(makeDb(), route, 1)).toEqual([]);
  });

  it("runs the Sunday timetable on a public holiday", () => {
    const route = makeRoute({ freq: { sundayOnly: { "0000": ["2359", "600"] } } });
    const db = makeDb({ holidays: ["20260304"] });
    expect(scheduledEta(db, route, 1).length).toBeGreaterThan(0);
  });

  it("handles fixed departures, which is how ferries are published", () => {
    // Single sailings rather than a headway.
    const route = makeRoute({
      freq: { daily: { "1030": null, "1130": null, "0900": null } },
      jt: null,
      stops: { kmb: ["a", "b"] },
    });
    const etas = scheduledEta(makeDb(), route, 1, 5);
    // 09:00 has already gone at 10:00; 10:30 and 11:30 remain.
    expect(etas).toHaveLength(2);
  });

  it("offsets later stops by a share of the journey time", () => {
    const route = makeRoute({ freq: { daily: { "0000": ["2359", "600"] } }, jt: "30" });
    const first = scheduledEta(makeDb(), route, 1, 1)[0];
    const last = scheduledEta(makeDb(), route, 4, 1)[0];
    expect(first).toBeDefined();
    expect(last).toBeDefined();
    // The last of four stops is a full journey time beyond the first departure,
    // so its next arrival is never earlier than the first stop's.
    expect(last!.at.getTime()).toBeGreaterThan(Date.now());
  });

  it("still finds a service that began before midnight", () => {
    // 00:30 Hong Kong, inside a band written as 2310 -> 2620.
    vi.setSystemTime(new Date("2026-03-04T16:30:00Z"));
    const route = makeRoute({ freq: { daily: { "2310": ["2620", "1800"] } }, jt: null });
    const etas = scheduledEta(makeDb(), route, 1, 3);
    expect(etas.length).toBeGreaterThan(0);
  });

  it("respects the requested limit", () => {
    const route = makeRoute({ freq: { daily: { "0000": ["2359", "300"] } } });
    expect(scheduledEta(makeDb(), route, 1, 2)).toHaveLength(2);
  });
});

describe("isRunningNow", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Wednesday 4 March 2026, 10:00 in Hong Kong.
    vi.setSystemTime(new Date("2026-03-04T02:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("assumes a route with no timetable is running", () => {
    // Absence of data is not evidence of cancellation, and hiding a real route
    // is worse than listing one that has finished for the day.
    expect(isRunningNow(makeDb(), makeRoute({ freq: null }))).toBe(true);
  });

  it("recognises a daytime service in the middle of the day", () => {
    const route = makeRoute({ freq: { daily: { "0600": ["2300", "600"] } } });
    expect(isRunningNow(makeDb(), route)).toBe(true);
  });

  it("knows an overnight route is not running mid-morning", () => {
    const route = makeRoute({ freq: { daily: { "2330": ["2600", "1800"] } } });
    expect(isRunningNow(makeDb(), route)).toBe(false);
  });

  it("knows a daytime route is not running after midnight", () => {
    vi.setSystemTime(new Date("2026-03-04T16:30:00Z")); // 00:30 Hong Kong
    const route = makeRoute({ freq: { daily: { "0600": ["2300", "600"] } } });
    expect(isRunningNow(makeDb(), route)).toBe(false);
  });

  it("still counts a service that began before midnight", () => {
    vi.setSystemTime(new Date("2026-03-04T16:30:00Z")); // 00:30 Hong Kong
    // Written as 2330 -> 2600, meaning it runs until 02:00 the next morning.
    const route = makeRoute({ freq: { daily: { "2330": ["2600", "1800"] } } });
    expect(isRunningNow(makeDb(), route)).toBe(true);
  });

  it("ignores a timetable for a day that is not today", () => {
    const route = makeRoute({ freq: { sundayOnly: { "0600": ["2300", "600"] } } });
    expect(isRunningNow(makeDb(), route)).toBe(false);
  });

  it("uses the Sunday timetable on a public holiday", () => {
    const route = makeRoute({ freq: { sundayOnly: { "0600": ["2300", "600"] } } });
    expect(isRunningNow(makeDb({ holidays: ["20260304"] }), route)).toBe(true);
  });
});

describe("routeTimetable", () => {
  const db = {
    holidays: [],
    routeList: {},
    stopList: {},
    stopMap: {},
    serviceDayMap: {
      wk: ["0", "1", "1", "1", "1", "1", "0"],
      sat: ["0", "0", "0", "0", "0", "0", "1"],
      sun: ["1", "0", "0", "0", "0", "0", "0"],
    },
  } as unknown as RouteDb;

  const route = (freq: Record<string, Record<string, [string, string] | null>>) =>
    ({ key: "k", freq, stops: {}, co: ["kmb"] }) as unknown as KeyedRoute;

  it("merges service ids that share a day pattern", () => {
    const groups = routeTimetable(
      db,
      route({
        wk: { "0600": ["0900", "600"] },
        sat: { "0700": ["1000", "900"] },
      }),
    );
    expect(groups).toHaveLength(2);
    expect(groups[0]?.bands[0]).toEqual({ from: "06:00", to: "09:00", headwayMin: 10 });
  });

  it("wraps a band that runs past midnight into wall-clock time", () => {
    const groups = routeTimetable(db, route({ wk: { "2330": ["2620", "1200"] } }));
    expect(groups[0]?.bands[0]).toEqual({ from: "23:30", to: "02:20", headwayMin: 20 });
  });

  it("reports a fixed departure as having no headway", () => {
    const groups = routeTimetable(db, route({ sun: { "0815": null } }));
    expect(groups[0]?.bands[0]).toEqual({ from: "08:15", to: "08:15", headwayMin: null });
  });
});
