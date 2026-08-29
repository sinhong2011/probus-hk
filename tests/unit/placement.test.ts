import { describe, expect, it } from "vitest";
import { measureOf, spreadMetres } from "~/data/placement";
import type { Vehicle } from "~/data/vehicles";
import type { StopMeasures } from "~/lib/alongLine";
import { measureLine, measureStops } from "~/lib/alongLine";
import type { Position } from "~/data/waypoints";

const NOW = Date.UTC(2026, 7, 29, 10, 0, 0);

/** Four stops on one straight road, a kilometre apart. */
const STOPS: Position[] = [
  [114.17, 22.3],
  [114.18, 22.3],
  [114.19, 22.3],
  [114.2, 22.3],
];

const track = measureStops(measureLine(STOPS), STOPS) as StopMeasures;
/** Metres between two of them, near enough. */
const HOP = track.measures[1] as number;

function bus(overrides: Partial<Vehicle> = {}): Vehicle {
  return {
    id: "bus-1",
    co: "kmb",
    nextSeq: 3,
    at: new Date(NOW + 60_000),
    segSeconds: 120,
    spreadSeconds: 20,
    ...overrides,
  };
}

describe("measureOf", () => {
  it("puts a bus part way along the segment it is on", () => {
    // Sixty seconds off a two minute segment: halfway between stops 2 and 3.
    expect(measureOf(bus(), track, NOW)).toBeCloseTo(HOP * 1.5, -1);
  });

  it("puts a bus at the stop it is due at, when it is due", () => {
    expect(measureOf(bus({ at: new Date(NOW) }), track, NOW)).toBeCloseTo(HOP * 2, -1);
  });

  it("keeps a bus moving after its arrival time has gone by", () => {
    /*
     * The bug this guards: an arrival that has passed used to pin the marker to
     * the stop until the next poll disagreed - and with times published to the
     * minute, the feed goes on repeating that stop for up to two minutes. The
     * bus a rider was watching stopped dead on the stop it had plainly just
     * left.
     */
    const overdue = measureOf(bus({ at: new Date(NOW - 30_000) }), track, NOW) as number;

    expect(overdue).toBeGreaterThan(HOP * 2);
    expect(overdue).toBeLessThan(HOP * 3);
  });

  it("stops carrying it forward once the answer is plainly stale", () => {
    // Ten minutes overdue is an expired answer, not a bus ten minutes up the
    // road: it rolls on for about the length of a stop and then holds.
    const far = measureOf(bus({ at: new Date(NOW - 600_000) }), track, NOW) as number;

    expect(far).toBeGreaterThan(HOP * 2);
    expect(far).toBeLessThan(HOP * 3);
    // And holds there rather than creeping on with the clock.
    const later = measureOf(bus({ at: new Date(NOW - 900_000) }), track, NOW) as number;
    expect(later).toBeCloseTo(far, 5);
  });

  it("will not carry a bus past a stop it has said nothing about", () => {
    // A fast segment would otherwise roll it a whole stop on in those seconds.
    const fast = measureOf(
      bus({ at: new Date(NOW - 120_000), segSeconds: 30 }),
      track,
      NOW,
    ) as number;

    expect(fast).toBeCloseTo(HOP * 3, -1);
  });

  it("holds at the terminus, which has nowhere beyond it", () => {
    const last = measureOf(bus({ nextSeq: 4, at: new Date(NOW - 300_000) }), track, NOW) as number;
    expect(last).toBeCloseTo(HOP * 3, -1);
  });

  it("has nowhere to put a bus the line does not reach", () => {
    expect(measureOf(bus({ nextSeq: 99 }), track, NOW)).toBeNull();
  });

  it("draws no bus around a stop the line does not actually reach", () => {
    // The line is right for the rest of the route and wrong at the end - the
    // shape of a campus route drawn only as far as the gates. The buses on the
    // good part still get drawn; this one does not.
    const short: StopMeasures = { ...track, offsets: [10, 10, 900, 900] };

    expect(measureOf(bus({ nextSeq: 3 }), short, NOW)).toBeNull();
    expect(measureOf(bus({ nextSeq: 2 }), short, NOW)).not.toBeNull();
  });
});

describe("spreadMetres", () => {
  it("grows with every second of extrapolation", () => {
    const due = spreadMetres(bus(), track, NOW);
    const overdue = spreadMetres(bus({ at: new Date(NOW - 45_000) }), track, NOW);

    expect(overdue).toBeGreaterThan(due);
  });

  it("stays wide enough to see and narrow enough to mean something", () => {
    const tiny = spreadMetres(bus({ spreadSeconds: 0 }), track, NOW);
    const huge = spreadMetres(bus({ spreadSeconds: 100_000 }), track, NOW);

    expect(tiny).toBe(30);
    expect(huge).toBe(800);
  });
});
