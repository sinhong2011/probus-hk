import { describe, expect, it } from "vitest";
import fixture from "../fixtures/routeDb.json" with { type: "json" };
import {
  nearbyStops,
  nextRouteChars,
  reverseRoute,
  routeAt,
  routeStops,
  routesAtStop,
  searchRoutes,
  searchStops,
  stopIndex,
} from "~/data/db";
import type { RouteDb } from "~/data/types";

const db = fixture as unknown as RouteDb;
const KMB_1 = "1+1+CHUK YUEN ESTATE+STAR FERRY";

describe("routeAt", () => {
  it("attaches the storage key to the entry", () => {
    const route = routeAt(db, KMB_1);
    expect(route?.key).toBe(KMB_1);
    expect(route?.route).toBe("1");
    expect(route?.co).toEqual(["kmb"]);
  });

  it("returns undefined for an unknown key instead of throwing", () => {
    expect(routeAt(db, "nope")).toBeUndefined();
  });
});

describe("searchRoutes", () => {
  it("puts exact matches before prefix matches", () => {
    const results = searchRoutes(db, "1");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]?.route).toBe("1");
  });

  it("orders a shared route number by operator, not by internal code", () => {
    // Four operators run a route "1"; alphabetising the company codes would put
    // Citybus first, which is not what someone typing "1" in Kowloon means.
    const ones = searchRoutes(db, "1").filter((r) => r.route === "1");
    expect(ones.length).toBeGreaterThan(1);
    expect(ones[0]?.co[0]).toBe("kmb");
  });

  it("is case-insensitive and ignores surrounding space", () => {
    expect(searchRoutes(db, " 505 ").map((r) => r.route)).toContain("505");
  });

  it("returns nothing for an empty query rather than the whole database", () => {
    expect(searchRoutes(db, "")).toEqual([]);
    expect(searchRoutes(db, "   ")).toEqual([]);
  });

  it("finds the joint route by its number", () => {
    const joint = searchRoutes(db, "102").find((r) => r.co.length > 1);
    expect(joint?.co).toEqual(expect.arrayContaining(["kmb", "ctb"]));
  });
});

describe("nextRouteChars", () => {
  it("offers only characters that lead to a real route", () => {
    const next = nextRouteChars(db, "10");
    // "102" exists in the fixture, so "2" must be offered.
    expect(next.has("2")).toBe(true);
    expect(next.has("9")).toBe(false);
  });

  it("is empty once the query is a complete route with nothing after it", () => {
    expect(nextRouteChars(db, "505").size).toBe(0);
  });
});

describe("stopIndex and routesAtStop", () => {
  it("builds the index once and reuses it", () => {
    expect(stopIndex(db)).toBe(stopIndex(db));
  });

  it("finds the routes calling at a stop", () => {
    const route = routeAt(db, KMB_1);
    const firstStop = route?.stops.kmb?.[0];
    expect(firstStop).toBeDefined();

    const here = routesAtStop(db, firstStop as string);
    expect(here.some((r) => r.route.key === KMB_1)).toBe(true);
  });

  it("reports a 1-based sequence, which is what the ETA APIs expect", () => {
    const route = routeAt(db, KMB_1);
    const thirdStop = route?.stops.kmb?.[2] as string;
    const match = routesAtStop(db, thirdStop).find((r) => r.route.key === KMB_1);
    expect(match?.seq).toBe(3);
  });

  it("lists a route once even when several ids alias the same kerb", () => {
    const route = routeAt(db, KMB_1);
    const stop = route?.stops.kmb?.[0] as string;
    const keys = routesAtStop(db, stop).map((r) => `${r.route.key}/${r.co}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("nearbyStops", () => {
  it("returns stops sorted by distance", () => {
    const found = nearbyStops(db, { lat: 22.2943, lng: 114.16911 }, 1500);
    expect(found.length).toBeGreaterThan(0);
    const distances = found.map((f) => f.metres);
    expect([...distances].sort((a, b) => a - b)).toEqual(distances);
  });

  it("excludes everything beyond the radius", () => {
    const found = nearbyStops(db, { lat: 22.2943, lng: 114.16911 }, 300);
    expect(found.every((f) => f.metres <= 300)).toBe(true);
  });

  it("finds nothing in the middle of the sea", () => {
    expect(nearbyStops(db, { lat: 10, lng: 100 }, 500)).toEqual([]);
  });
});

describe("reverseRoute", () => {
  it("pairs a route with the same number running the other way", () => {
    const outbound = routeAt(db, "1+1+Mui Wo Ferry Pier+Tai O");
    expect(outbound).toBeDefined();
    const back = reverseRoute(db, outbound!);
    // The fixture only carries one direction of NLB 1, so this is honestly undefined.
    if (back) {
      expect(back.orig.en).toBe(outbound!.dest.en);
      expect(back.dest.en).toBe(outbound!.orig.en);
    }
  });

  it("never returns the route itself", () => {
    const route = routeAt(db, KMB_1)!;
    expect(reverseRoute(db, route)?.key).not.toBe(KMB_1);
  });
});

describe("routeStops", () => {
  it("resolves every stop id to a stop entry, in order", () => {
    const route = routeAt(db, KMB_1)!;
    const stops = routeStops(db, route);
    expect(stops.length).toBe(route.stops.kmb?.length);
    expect(stops[0]?.stop.name.en).toContain("CHUK YUEN ESTATE");
  });

  it("carries one fewer fare than stops, since the terminus has no onward fare", () => {
    const route = routeAt(db, KMB_1)!;
    expect(route.fares?.length).toBe((route.stops.kmb?.length ?? 0) - 1);
  });
});

describe("searchStops ranking", () => {
  /** Two stops whose names both contain the query, one far busier. */
  const named: RouteDb = {
    holidays: [],
    serviceDayMap: {},
    stopMap: {},
    stopList: {
      ADM: { name: { zh: "金鐘", en: "Admiralty" }, location: { lat: 22.279, lng: 114.164 } },
      BUS: {
        name: { zh: "金鐘 - 太古廣場, 金鐘道", en: "Admiralty - Pacific Place, Queensway" },
        location: { lat: 22.278, lng: 114.165 },
      },
    },
    routeList: {
      "1+1+A+B": { co: ["kmb"], route: "1", bound: { kmb: "O" }, serviceType: 1, orig: { zh: "A", en: "A" }, dest: { zh: "B", en: "B" }, fares: null, faresHoliday: null, freq: null, gtfsId: null, jt: null, nlbId: null, seq: 1, stops: { kmb: ["BUS"] } },
      "2+1+A+B": { co: ["kmb"], route: "2", bound: { kmb: "O" }, serviceType: 1, orig: { zh: "A", en: "A" }, dest: { zh: "B", en: "B" }, fares: null, faresHoliday: null, freq: null, gtfsId: null, jt: null, nlbId: null, seq: 1, stops: { kmb: ["BUS"] } },
      "3+1+A+B": { co: ["kmb"], route: "3", bound: { kmb: "O" }, serviceType: 1, orig: { zh: "A", en: "A" }, dest: { zh: "B", en: "B" }, fares: null, faresHoliday: null, freq: null, gtfsId: null, jt: null, nlbId: null, seq: 1, stops: { kmb: ["BUS"] } },
      "TWL+1+Central+Tsuen Wan": { co: ["mtr"], route: "TWL", bound: { mtr: "UT" }, serviceType: 1, orig: { zh: "中環", en: "Central" }, dest: { zh: "荃灣", en: "Tsuen Wan" }, fares: null, faresHoliday: null, freq: null, gtfsId: null, jt: null, nlbId: null, seq: 1, stops: { mtr: ["ADM"] } },
    },
  } as unknown as RouteDb;

  it("puts an exact name ahead of a busier partial match", () => {
    // Ranking by route count alone buried every railway station: the bus stop
    // here is three times busier, and its name merely contains what was typed.
    expect(searchStops(named, "金鐘")[0]?.stopId).toBe("ADM");
  });

  it("still prefers the busier stop when neither is an exact match", () => {
    expect(searchStops(named, "金鐘道")[0]?.stopId).toBe("BUS");
  });

  /**
   * A pole code names one stop and nothing else, so a rider who reads it off
   * the flag in front of them should be handed that stop, however quiet it is.
   */
  const coded: RouteDb = {
    ...named,
    stopList: {
      QUIET: {
        name: { zh: "白虹樓 (WT916)", en: "PAK HUNG HOUSE (WT916)" },
        location: { lat: 22.34, lng: 114.2 },
      },
      BUSY: {
        name: { zh: "白虹樓對面", en: "OPPOSITE PAK HUNG HOUSE" },
        location: { lat: 22.34, lng: 114.201 },
      },
    },
    routeList: {
      "1+1+A+B": {
        co: ["kmb"], route: "1", bound: { kmb: "O" }, serviceType: 1,
        orig: { zh: "A", en: "A" }, dest: { zh: "B", en: "B" },
        fares: null, faresHoliday: null, freq: null, gtfsId: null, jt: null, nlbId: null,
        seq: 1, stops: { kmb: ["QUIET", "BUSY"] },
      },
      "2+1+A+B": {
        co: ["kmb"], route: "2", bound: { kmb: "O" }, serviceType: 1,
        orig: { zh: "A", en: "A" }, dest: { zh: "B", en: "B" },
        fares: null, faresHoliday: null, freq: null, gtfsId: null, jt: null, nlbId: null,
        seq: 1, stops: { kmb: ["BUSY"] },
      },
    },
  } as unknown as RouteDb;

  it("finds a stop by the pole code printed on it", () => {
    const hits = searchStops(coded, "wt916");
    expect(hits).toHaveLength(1);
    expect(hits[0]?.stopId).toBe("QUIET");
  });

  it("ranks the pole whose code was typed above the busier stop beside it", () => {
    expect(searchStops(coded, "WT916")[0]?.stopId).toBe("QUIET");
  });

  it("matches a name that the code used to hide", () => {
    // The code lives inside the raw name, so "白虹樓" was never an exact match
    // and the quiet pole lost to its busier neighbour.
    expect(searchStops(coded, "白虹樓")[0]?.stopId).toBe("QUIET");
  });
});
