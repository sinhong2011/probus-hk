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

  it("reads one bus's arrivals as one bus, and its next trip as none", () => {
    // The later pair of times is the following departure: fifteen minutes from
    // stop 2 on a five-minute first segment is a bus still on the stand.
    const buses = inferVehicles(
      makeRoute(),
      table({ 2: [eta(120), eta(900)], 3: [eta(420), eta(1200)] }),
      7,
      NOW,
    );

    expect(buses).toHaveLength(1);
    expect(buses[0]?.nextSeq).toBe(2);
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

  it("does not mint a second bus when adjacent stops print seconds crossed", () => {
    /*
     * The A33 at the Gold Coast: one bus between two stops whose independently
     * computed ETAs land seconds apart and out of order. Taking the later
     * stop's earlier print as a chain head stranded the earlier stop's
     * arrival, which started a chain of its own - the same vehicle on the map
     * twice, a stop apart.
     */
    const brisk = makeRoute({ jt: "9" });
    const buses = inferVehicles(
      brisk,
      table({ 3: [eta(40)], 4: [eta(30)], 5: [eta(180)] }),
      7,
      NOW,
    );

    expect(buses).toHaveLength(1);
    expect(buses[0]?.nextSeq).toBe(3);
  });

  it("keeps a slow stretch as one bus instead of minting an echo", () => {
    /*
     * The A33's airport loop: the road takes five minutes over a segment the
     * chords call seventy seconds. The times still climb, so it is still one
     * bus - however far off the timetable's pace - and reading the slow hop
     * as a break is what drew the same vehicle twice.
     */
    const buses = inferVehicles(
      makeRoute(),
      table({ 2: [eta(60)], 3: [eta(360)], 4: [eta(1300)] }),
      7,
      NOW,
    );

    expect(buses).toHaveLength(1);
    expect(buses[0]?.nextSeq).toBe(2);
  });

  it("counts a bus wherever the curve falls back", () => {
    // Stop 6 reporting sooner than stop 3 means a nearer bus has passed the
    // stops between: two climbing runs, two buses.
    const buses = inferVehicles(makeRoute(), table({ 3: [eta(500)], 6: [eta(300)] }), 7, NOW);

    expect(buses).toHaveLength(2);
    expect(buses.map((bus) => bus.nextSeq)).toEqual([2, 6]);
  });

  it("strings a per-stop operator's arrivals back along the road", () => {
    // Citybus answers for one stop only: its arrivals are the buses
    // approaching it, spaced by the pace between them - except the last,
    // whose time outruns the road back to the start: still on the stand.
    const buses = inferVehicles(
      makeRoute(),
      table({ 4: [eta(120), eta(700), eta(1_400)] }),
      7,
      NOW,
    );

    expect(buses).toHaveLength(2);
    expect(buses.map((bus) => bus.nextSeq)).toEqual([2, 4]);
  });

  it("reads a mid-route stop's later arrival as a bus already drawn", () => {
    // Stop 4's second arrival is the bus behind - the one stop 3's own soonest
    // time already places. Reading it again drew every bus twice.
    const buses = inferVehicles(
      makeRoute(),
      table({ 3: [eta(120)], 4: [eta(420), eta(2_000)], 5: [eta(720)] }),
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

  it("will not walk back past a stop whose own arrivals rule it out", () => {
    /*
     * The A33 at the bridge: the bus due at stop 5 in 700 seconds would walk
     * back two segments, but stop 4's next arrival - the following trip, on
     * the timetable - is fifty minutes out. A bus still short of stop 4 would
     * be stop 4's next arrival, so this one has passed it, however short the
     * pace claims the road is.
     */
    const buses = inferVehicles(
      makeRoute(),
      table({ 4: [eta(3_000, "scheduled")], 5: [eta(700)] }),
      7,
      NOW,
    );

    expect(buses).toHaveLength(1);
    expect(buses[0]?.nextSeq).toBe(5);
    // More time left than the segment holds: pinned to the stop just passed.
    expect(progressOf(buses[0] as never, NOW)).toBe(4);
  });

  it("takes a live next trip as the same evidence", () => {
    const buses = inferVehicles(makeRoute(), table({ 4: [eta(3_000)], 5: [eta(700)] }), 7, NOW);

    // The fifty-minute arrival at stop 4 is the next trip, and fifty minutes
    // cannot fit on the road behind stop 4: it has not departed, so only the
    // bus the near arrival describes is drawn - pinned where stop 4's
    // territory begins.
    expect(buses).toHaveLength(1);
    expect(buses[0]?.nextSeq).toBe(5);
  });

  it("still walks past a stop reporting within the rounding minute", () => {
    // Stop 4 prints the same minute as the bus's own arrival at stop 5 -
    // which is this bus, rounded, not proof it has passed.
    const buses = inferVehicles(
      makeRoute(),
      table({ 4: [eta(740, "scheduled")], 5: [eta(700)] }),
      7,
      NOW,
    );

    // Two whole segments back plus a hundred seconds: on its way to stop 3.
    expect(buses[0]?.nextSeq).toBe(3);
  });

  it("stops walking back at the first stop", () => {
    const buses = inferVehicles(makeRoute(), table({ 3: [eta(550)] }), 7, NOW);
    expect(buses[0]?.nextSeq).toBe(2);
  });

  it("does not draw a departure the road cannot hold", () => {
    // Two and a half hours from stop 3 is not a bus two segments back - it is
    // a future trip, still in the depot however "live" its remark.
    expect(inferVehicles(makeRoute(), table({ 3: [eta(9_000)] }), 7, NOW)).toEqual([]);
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

  it("keeps the bus the road holds when the terminus prints a departure too", () => {
    /*
     * The 42 at 順利總站: the terminus lists its next departure in the same
     * minute as the bus genuinely short of stop 2. Over a ninety-second first
     * segment the pace check cannot cut the run between them, so reading the
     * terminus as curve evidence put the run's head on stop 1 - and dropping
     * that head (a departure is not a bus) took the on-road bus with it.
     */
    const brisk = makeRoute({ jt: "9" });
    const buses = inferVehicles(
      brisk,
      table({ 1: [eta(10)], 2: [eta(40)], 3: [eta(130)] }),
      7,
      NOW,
    );

    expect(buses).toHaveLength(1);
    expect(buses[0]?.nextSeq).toBe(2);
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
