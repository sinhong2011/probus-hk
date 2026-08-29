import { describe, expect, it } from "vitest";
import { inferVehicles, progressOf, trackVehicles, type EtaTable } from "~/data/vehicles";
import type { Eta, KeyedRoute } from "~/data/types";

const NOW = Date.UTC(2026, 7, 29, 10, 0, 0);

/**
 * Seven stops and half an hour end to end, which the timetable spreads as five
 * minutes a segment - the pace every placement here is measured against.
 */
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
    stops: { kmb: ["s1", "s2", "s3", "s4", "s5", "s6", "s7"] },
    ...overrides,
  };
}

const SEGMENT = 300;

function eta(seconds: number, source: Eta["source"] = "live"): Eta {
  return { at: new Date(NOW + seconds * 1_000), source, co: "kmb" };
}

function table(rows: Record<number, Eta[]>): EtaTable {
  return new Map(Object.entries(rows).map(([seq, etas]) => [Number(seq), etas]));
}

describe("inferVehicles", () => {
  it("places a bus short of the stop it is due at", () => {
    const buses = inferVehicles(
      makeRoute(),
      table({ 2: [eta(120)], 3: [eta(420)], 4: [eta(720)] }),
      7,
      NOW,
    );

    expect(buses).toHaveLength(1);
    expect(buses[0]?.nextSeq).toBe(2);
    expect(buses[0]?.segSeconds).toBe(SEGMENT);
    // Two minutes off a five minute segment: three fifths of the way there.
    expect(progressOf(buses[0] as never, NOW)).toBeCloseTo(1.6, 2);
  });

  it("chains one bus's arrivals together instead of counting them twice", () => {
    const buses = inferVehicles(
      makeRoute(),
      table({ 2: [eta(120), eta(900)], 3: [eta(420), eta(1200)] }),
      7,
      NOW,
    );

    expect(buses).toHaveLength(2);
    expect(buses.map((bus) => bus.nextSeq)).toEqual([2, 2]);
    // The one further from arriving is the one further back.
    expect(progressOf(buses[0] as never, NOW)).toBeLessThan(progressOf(buses[1] as never, NOW));
  });

  it("will not chain arrivals no bus could have made", () => {
    // Ten seconds apart at stops five minutes apart: two buses, not one.
    const buses = inferVehicles(makeRoute(), table({ 3: [eta(120)], 4: [eta(130)] }), 7, NOW);
    expect(buses).toHaveLength(2);
  });

  it("does not split one bus in two when two stops report the same minute", () => {
    /*
     * Every operator rounds arrivals to the minute, so a bus three quarters of
     * a minute from one stop and a quarter from the next prints the same time
     * at both. Reading that as two buses is what put the same vehicle on the
     * map twice, a stop apart.
     */
    const brisk = makeRoute({ jt: "9" }); // Six segments of ninety seconds.
    const buses = inferVehicles(
      brisk,
      table({ 3: [eta(60)], 4: [eta(60)], 5: [eta(180)] }),
      7,
      NOW,
    );

    expect(buses).toHaveLength(1);
    expect(buses[0]?.nextSeq).toBe(3);
  });

  it("walks back over stops that never reported", () => {
    // Only stop 6 answers, and the bus is 700 seconds away: that is two whole
    // segments plus a hundred seconds, so it is on its way to stop 4.
    const buses = inferVehicles(makeRoute(), table({ 6: [eta(700)] }), 7, NOW);

    expect(buses[0]?.nextSeq).toBe(4);
    expect(buses[0]?.at.getTime()).toBe(NOW + 100_000);
  });

  it("stops walking back at the first stop", () => {
    const buses = inferVehicles(makeRoute(), table({ 3: [eta(9_000)] }), 7, NOW);
    expect(buses[0]?.nextSeq).toBe(2);
  });

  it("widens the band the further back the bus is", () => {
    const near = inferVehicles(makeRoute(), table({ 2: [eta(60)] }), 7, NOW);
    const far = inferVehicles(makeRoute(), table({ 6: [eta(900)] }), 7, NOW);

    expect(far[0]?.spreadSeconds).toBeGreaterThan(near[0]?.spreadSeconds as number);
  });

  it("draws no bus from a timetable", () => {
    expect(inferVehicles(makeRoute(), table({ 3: [eta(300, "scheduled")] }), 7, NOW)).toEqual([]);
  });

  it("ignores arrivals that have already gone", () => {
    expect(inferVehicles(makeRoute(), table({ 3: [eta(-300)] }), 7, NOW)).toEqual([]);
  });

  it("ignores a departure from the route's own terminus", () => {
    expect(inferVehicles(makeRoute(), table({ 1: [eta(120)] }), 7, NOW)).toEqual([]);
  });

  it("ignores an arrival past the end of the route", () => {
    expect(inferVehicles(makeRoute(), table({ 9: [eta(120)] }), 7, NOW)).toEqual([]);
  });
});

describe("trackVehicles", () => {
  const route = makeRoute();

  it("gives every bus an identity", () => {
    const tracked = trackVehicles([], inferVehicles(route, table({ 3: [eta(120)] }), 7, NOW), NOW);
    expect(tracked[0]?.id).toMatch(/^bus-\d+$/);
  });

  it("keeps a bus's identity as it moves up the route", () => {
    const first = trackVehicles([], inferVehicles(route, table({ 3: [eta(120)] }), 7, NOW), NOW);
    const later = NOW + 20_000;
    const second = trackVehicles(
      first,
      inferVehicles(route, table({ 3: [eta(100)] }), 7, later),
      later,
    );

    expect(second[0]?.id).toBe(first[0]?.id);
  });

  it("does not hand a departed bus's identity to one half a route away", () => {
    const first = trackVehicles([], inferVehicles(route, table({ 3: [eta(120)] }), 7, NOW), NOW);
    const second = trackVehicles(
      first,
      inferVehicles(route, table({ 7: [eta(120)] }), 7, NOW),
      NOW,
    );

    expect(second[0]?.id).not.toBe(first[0]?.id);
  });
});
