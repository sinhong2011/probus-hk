import { describe, expect, it } from "vitest";
import { measureLine, measureStops, pointAt, sliceLine, stitchLines } from "~/lib/alongLine";
import type { Position } from "~/data/waypoints";

/**
 * A straight run east along one latitude, where a tenth of a degree of
 * longitude is a shade over a kilometre - close enough to check distances by
 * eye and exactly the shape a route drawn along one road has.
 */
const WEST: Position = [114.17, 22.3];
const MIDDLE: Position = [114.18, 22.3];
const EAST: Position = [114.19, 22.3];

/** Metres in 0.01 degrees of longitude at this latitude. */
const HOP = 1030;

describe("measureLine", () => {
  it("runs a distance along the points", () => {
    const line = measureLine([WEST, MIDDLE, EAST]);

    expect(line.measures[0]).toBe(0);
    expect(line.measures[1]).toBeCloseTo(HOP, -2);
    expect(line.length).toBeCloseTo(HOP * 2, -2);
  });
});

describe("stitchLines", () => {
  it("keeps a single piece as it is", () => {
    expect(stitchLines([[WEST, MIDDLE, EAST]])).toEqual([WEST, MIDDLE, EAST]);
  });

  it("joins pieces given out of order, flipping the ones drawn backwards", () => {
    const path = stitchLines([
      [MIDDLE, EAST],
      [MIDDLE, WEST],
    ]);

    // The two pieces share their western end, so the second is flipped and
    // grown off the head of the first rather than doubling back from its tail.
    expect(path).toEqual([WEST, MIDDLE, EAST]);
    expect(measureLine(path).length).toBeCloseTo(HOP * 2, -2);
  });

  it("joins many in-order segments without blowing the stack", () => {
    const segment = Array.from(
      { length: 5000 },
      (_, i) => [114.17 + i * 0.00001, 22.3] as Position,
    );
    const segments = Array.from({ length: 40 }, (_, index) =>
      segment.map(([lng, lat]) => [lng + index * 0.05, lat] as Position),
    );
    const path = stitchLines(segments);
    expect(path.length).toBeGreaterThan(5000);
  });
});

describe("measureStops", () => {
  const line = measureLine([WEST, MIDDLE, EAST]);

  it("places stops in order along the line", () => {
    const measured = measureStops(line, [WEST, MIDDLE, EAST]);

    expect(measured).not.toBeNull();
    expect(measured?.measures[0]).toBeCloseTo(0, -1);
    expect(measured?.measures[1]).toBeCloseTo(HOP, -2);
    expect(measured?.measures[2]).toBeCloseTo(HOP * 2, -2);
  });

  it("reverses geometry that was drawn back to front", () => {
    const backwards = measureLine([EAST, MIDDLE, WEST]);
    const measured = measureStops(backwards, [WEST, MIDDLE, EAST]);

    // The stops still climb, which is the whole point: a reversed line would
    // otherwise put every bus at the wrong end of the route.
    expect(measured?.measures[0]).toBeCloseTo(0, -1);
    expect(measured?.measures[2]).toBeCloseTo(HOP * 2, -2);
    expect(measured?.line.points[0]).toEqual(WEST);
  });

  it("tolerates a stop drawn beside the line", () => {
    const beside: Position = [114.18, 22.3009]; // about 100m north
    const measured = measureStops(line, [WEST, beside, EAST]);

    expect(measured?.measures[1]).toBeCloseTo(HOP, -2);
    expect(measured?.worstOffset).toBeGreaterThan(50);
  });

  it("keeps the line when one stop has wandered off it", () => {
    /*
     * Published geometry is short at one end often enough to matter - drawn to
     * the gates of a university and not to the two stops inside it. Throwing
     * the whole route away for that took eleven good stops down with the bad
     * ones, so the stop is marked instead and the rest of the line still works.
     */
    const away: Position = [114.18, 22.31]; // a kilometre north
    const measured = measureStops(line, [WEST, away, EAST]);

    expect(measured).not.toBeNull();
    expect(measured?.offsets[0]).toBeLessThan(50);
    expect(measured?.offsets[1]).toBeGreaterThan(250);
  });

  it("refuses a line that is describing another road", () => {
    // Not one stop adrift: all of them, which is a different road entirely.
    const north = (lng: number): Position => [lng, 22.31];
    expect(measureStops(line, [north(114.17), north(114.18), north(114.19)])).toBeNull();
  });

  it("keeps the two halves of a circular route apart", () => {
    // Out east and back again: the same coordinate, visited twice.
    const loop = measureLine([WEST, EAST, WEST]);
    const measured = measureStops(loop, [WEST, EAST, WEST]);

    expect(measured?.measures[1]).toBeCloseTo(HOP * 2, -2);
    expect(measured?.measures[2]).toBeCloseTo(HOP * 4, -2);
  });
});

describe("pointAt", () => {
  const line = measureLine([WEST, MIDDLE, EAST]);

  it("finds the point a given distance along", () => {
    const half = pointAt(line, HOP);

    expect(half.position[0]).toBeCloseTo(114.18, 3);
    expect(half.position[1]).toBeCloseTo(22.3, 5);
  });

  it("faces the way the line is heading", () => {
    expect(pointAt(line, HOP / 2).bearing).toBeCloseTo(90, 0);
  });

  it("clamps to the ends rather than running off them", () => {
    expect(pointAt(line, -500).position[0]).toBeCloseTo(114.17, 5);
    expect(pointAt(line, 99_999).position[0]).toBeCloseTo(114.19, 5);
  });
});

describe("sliceLine", () => {
  it("returns the stretch between two distances", () => {
    const line = measureLine([WEST, MIDDLE, EAST]);
    const slice = sliceLine(line, HOP * 0.5, HOP * 1.5);

    expect(slice[0]?.[0]).toBeCloseTo(114.175, 3);
    expect(slice[slice.length - 1]?.[0]).toBeCloseTo(114.185, 3);
    // The point it passes through on the way is kept, so the band bends with
    // the road instead of cutting the corner.
    expect(slice).toContainEqual(MIDDLE);
  });
});
