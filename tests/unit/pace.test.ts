import { describe, expect, it } from "vitest";
import { pacedByDistance, pacedByFeed, pacedBySchedule } from "~/data/pace";
import type { Eta, KeyedRoute } from "~/data/types";
import type { EtaTable } from "~/data/vehicles";
import type { LatLng } from "~/lib/geo";

/** Five stops, half an hour end to end. */
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
    stops: { kmb: ["s1", "s2", "s3", "s4", "s5"] },
    ...overrides,
  };
}

/** Metres east of a fixed point, at Hong Kong's latitude. */
function at(metres: number): LatLng {
  return { lat: 22.3, lng: 114.17 + metres / 102_995 };
}

/*
 * Two stops fifty metres apart, then one a kilometre on, then another fifty,
 * then two kilometres - the shape of a real route, which is a cluster of stops
 * in a housing estate and then a long run down a road.
 */
const STOPS = [at(0), at(50), at(1_050), at(1_100), at(3_100)];

describe("pacedByDistance", () => {
  const route = makeRoute();
  const ride = pacedByDistance(route, STOPS);

  it("spends the route's own journey time, no more and no less", () => {
    expect(ride(1, 5)).toBeCloseTo(30 * 60, 0);
  });

  it("gives the long segments the time they need", () => {
    // Fifty metres against two kilometres: the timetable used to give both the
    // same seven and a half minutes, which is 0.4 km/h on one and 16 on the
    // other. Neither of those is a bus.
    expect(ride(4, 5)).toBeGreaterThan(ride(1, 2) * 8);
  });

  it("charges for the stop as well as the road", () => {
    // Two stops in the same doorway still cost the time the doors take.
    const doorstep = pacedByDistance(route, [at(0), at(0), at(1_000), at(2_000), at(3_000)]);
    expect(doorstep(1, 2)).toBeGreaterThan(0);
  });

  it("adds up the same whether asked in one hop or several", () => {
    expect(ride(1, 3) + ride(3, 5)).toBeCloseTo(ride(1, 5), 6);
  });

  it("never runs backwards", () => {
    for (let seq = 2; seq <= 5; seq += 1) expect(ride(seq - 1, seq)).toBeGreaterThan(0);
    expect(ride(4, 2)).toBe(0);
  });

  it("leaves time to drive in, however many stops there are", () => {
    // Forty stops and four minutes: dwell alone would eat the whole timetable
    // and leave every bus standing between doors.
    const packed = makeRoute({
      jt: "4",
      stops: { kmb: Array.from({ length: 40 }, (_, i) => `s${i}`) },
    });
    const dense = pacedByDistance(
      packed,
      Array.from({ length: 40 }, (_, i) => at(i * 100)),
    );

    expect(dense(1, 40)).toBeCloseTo(4 * 60, 0);
    expect(dense(1, 2)).toBeGreaterThan(0);
    expect(dense(1, 2)).toBeLessThan(dense(1, 40));
  });

  it("falls back to the timetable when the stops say nothing about distance", () => {
    const nowhere = [at(0), at(0), at(0), at(0), at(0)];
    const flat = pacedByDistance(route, nowhere);
    expect(flat(1, 2)).toBeCloseTo(pacedBySchedule(route)(1, 2), 6);
  });
});

const NOW = Date.UTC(2026, 7, 29, 10, 0, 0);

function eta(seconds: number, source: Eta["source"] = "live"): Eta {
  return { at: new Date(NOW + seconds * 1_000), source, co: "kmb" };
}

/** A bus due at each of the five stops, at the times given. */
function staircase(seconds: (number | null)[], source: Eta["source"] = "live"): EtaTable {
  const table: EtaTable = new Map();
  seconds.forEach((value, index) => {
    if (value !== null) table.set(index + 1, [eta(value, source)]);
  });
  return table;
}

describe("pacedByFeed", () => {
  const route = makeRoute();
  const base = pacedByDistance(route, STOPS);
  const whole = base(1, 5);

  it("leaves the timetable alone when the feed agrees with it", () => {
    const onTime = staircase([0, base(1, 2), base(1, 3), base(1, 4), base(1, 5)]);
    const ride = pacedByFeed(base, onTime, 5);

    expect(ride(1, 5)).toBeCloseTo(whole, 0);
  });

  it("slows the whole route down when the buses are running late", () => {
    // The operator's own numbers say this stretch is taking twice as long as
    // the timetable claims, which is the one thing a published journey time
    // can never know: today.
    const late = staircase([0, base(1, 2) * 2, base(1, 3) * 2, base(1, 4) * 2, base(1, 5) * 2]);
    const ride = pacedByFeed(base, late, 5);

    expect(ride(1, 5)).toBeCloseTo(whole * 2, 0);
  });

  it("carries what it learned into the stretches nobody reported", () => {
    // Only the back half of the route has a bus on it; the front half has to
    // be told what today looks like by the half that does.
    const half = staircase([null, null, 0, base(3, 4) * 2, base(3, 5) * 2]);
    const ride = pacedByFeed(base, half, 5);

    expect(ride(1, 2)).toBeCloseTo(base(1, 2) * 2, 0);
  });

  it("keeps its hands off when the numbers are not credible", () => {
    // Twenty times the timetable is not traffic; it is two different buses
    // being read as one.
    const nonsense = staircase([0, base(1, 2) * 20, base(1, 3) * 20, null, null]);
    expect(pacedByFeed(base, nonsense, 5)(1, 5)).toBeCloseTo(whole, 0);
  });

  it("learns nothing from a timetable", () => {
    const projected = staircase([0, 600, 1_200, 1_800, 2_400], "scheduled");
    expect(pacedByFeed(base, projected, 5)(1, 5)).toBeCloseTo(whole, 0);
  });

  it("does not read a run backwards through a bus that has gone", () => {
    // Stop 3's first arrival is a later bus, so the times drop: that break is
    // where one vehicle ends and the next begins, not a bus reversing.
    const broken = staircase([0, 120, 30, 150, 300]);
    const ride = pacedByFeed(base, broken, 5);

    expect(ride(1, 5)).toBeGreaterThan(0);
    expect(Number.isFinite(ride(1, 5))).toBe(true);
  });

  it("still adds up the same in one hop as in several", () => {
    const late = staircase([
      0,
      base(1, 2) * 1.5,
      base(1, 3) * 1.5,
      base(1, 4) * 1.5,
      base(1, 5) * 1.5,
    ]);
    const ride = pacedByFeed(base, late, 5);

    expect(ride(1, 3) + ride(3, 5)).toBeCloseTo(ride(1, 5), 6);
  });
});
