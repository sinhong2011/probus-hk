import { describe, expect, it } from "vitest";
import fixture from "../fixtures/routeDb.json" with { type: "json" };
import { planJourneys } from "~/data/planner";
import type { RouteDb } from "~/data/types";

const db = fixture as unknown as RouteDb;

/** Along KMB route 1: Chuk Yuen Estate, mid-route, and the Star Ferry end. */
const CHUK_YUEN = { lat: 22.34541, lng: 114.19264 };
const MID_ROUTE = { lat: 22.32647, lng: 114.18316 };
const STAR_FERRY = { lat: 22.2943, lng: 114.16911 };
const MIDDLE_OF_NOWHERE = { lat: 22.15, lng: 113.95 };

/** Timetables are ignored so the result does not depend on the wall clock. */
const anyTime = { includeNotRunning: true };

describe("direct journeys", () => {
  it("finds a route that serves both ends", () => {
    const journeys = planJourneys(db, CHUK_YUEN, STAR_FERRY, anyTime);
    expect(journeys.length).toBeGreaterThan(0);

    const direct = journeys.find((j) => j.legs.length === 1);
    expect(direct).toBeDefined();
    expect(direct!.legs[0]?.route.route).toBe("1");
  });

  it("boards before it alights", () => {
    const journeys = planJourneys(db, CHUK_YUEN, STAR_FERRY, anyTime);
    for (const journey of journeys) {
      for (const leg of journey.legs) {
        expect(leg.alightSeq).toBeGreaterThan(leg.boardSeq);
        expect(leg.hops).toBe(leg.alightSeq - leg.boardSeq);
      }
    }
  });

  it("refuses to run a route backwards", () => {
    // The reverse direction of KMB 1 is not in the fixture, so travelling from
    // the Star Ferry to Chuk Yuen must not reuse the outbound route.
    const journeys = planJourneys(db, STAR_FERRY, CHUK_YUEN, anyTime);
    const wrongWay = journeys.find(
      (j) => j.legs.length === 1 && j.legs[0]?.route.key === "1+1+CHUK YUEN ESTATE+STAR FERRY",
    );
    expect(wrongWay).toBeUndefined();
  });

  it("stops partway along the route when that is where you are going", () => {
    const journeys = planJourneys(db, CHUK_YUEN, MID_ROUTE, anyTime);
    const direct = journeys.find((j) => j.legs.length === 1);
    expect(direct).toBeDefined();
    // Alighting mid-route, not riding to the terminus.
    expect(direct!.legs[0]?.alightSeq).toBeLessThan(25);
  });

  it("finds nothing when there is no service anywhere near", () => {
    expect(planJourneys(db, MIDDLE_OF_NOWHERE, STAR_FERRY, anyTime)).toEqual([]);
  });
});

describe("cost and ordering", () => {
  it("counts walking at both ends into the total", () => {
    const journeys = planJourneys(db, CHUK_YUEN, STAR_FERRY, anyTime);
    const journey = journeys[0];
    expect(journey).toBeDefined();

    const ride = journey!.legs.reduce((sum, leg) => sum + leg.minutes, 0);
    // Walking is real time, so the total can never be just the riding.
    expect(journey!.totalMinutes).toBeGreaterThanOrEqual(ride);
  });

  it("prefers a direct journey over one with a change", () => {
    const journeys = planJourneys(db, CHUK_YUEN, STAR_FERRY, anyTime);
    const legCounts = journeys.map((j) => j.legs.length);
    expect([...legCounts].sort((a, b) => a - b)).toEqual(legCounts);
  });

  it("charges the fare from the stop you board at", () => {
    const journeys = planJourneys(db, CHUK_YUEN, STAR_FERRY, anyTime);
    const leg = journeys.find((j) => j.legs.length === 1)?.legs[0];
    expect(leg?.fare).toBe("$6.7");
  });

  it("returns no duplicate journeys", () => {
    const journeys = planJourneys(db, CHUK_YUEN, STAR_FERRY, anyTime);
    const ids = journeys.map((j) => j.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("walking radius", () => {
  it("finds nothing when nobody would walk that far", () => {
    // A few hundred metres off the route, with a one-metre walking budget.
    const offRoute = { lat: CHUK_YUEN.lat + 0.004, lng: CHUK_YUEN.lng + 0.004 };
    expect(planJourneys(db, offRoute, STAR_FERRY, { ...anyTime, walkRadiusM: 1 })).toEqual([]);
  });

  it("finds more as the radius grows", () => {
    const near = planJourneys(db, CHUK_YUEN, STAR_FERRY, { ...anyTime, walkRadiusM: 150 });
    const far = planJourneys(db, CHUK_YUEN, STAR_FERRY, { ...anyTime, walkRadiusM: 600 });
    expect(far.length).toBeGreaterThanOrEqual(near.length);
  });
});

describe("interchanges", () => {
  it("can be turned off", () => {
    const journeys = planJourneys(db, CHUK_YUEN, STAR_FERRY, {
      ...anyTime,
      allowInterchange: false,
    });
    expect(journeys.every((j) => j.legs.length === 1)).toBe(true);
  });

  it("never changes onto the same route it is already on", () => {
    const journeys = planJourneys(db, CHUK_YUEN, STAR_FERRY, anyTime);
    for (const journey of journeys.filter((j) => j.legs.length > 1)) {
      const keys = journey.legs.map((l) => l.route.key);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });
});
