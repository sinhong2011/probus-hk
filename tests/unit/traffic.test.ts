import { describe, expect, it } from "vitest";
import type { Position } from "~/data/waypoints";
import { parseTrafficFeed, segmentsAlong, trafficLevel, type SegmentShapes } from "~/data/traffic";

/**
 * The traffic ribbon makes one promise: the colour on the line is the state
 * of this bus's own road, in this bus's own direction. Everything here guards
 * that promise - the feed read only where its detector answered, and the
 * corridor cut so the other carriageway and the cross-street stay off it.
 */

describe("parseTrafficFeed", () => {
  const xml =
    "<segments>" +
    "<segment><segment_id>101</segment_id><speed>11.5</speed><valid>Y</valid></segment>" +
    "<segment><segment_id>102</segment_id><speed>50</speed><valid>N</valid></segment>" +
    "<segment><segment_id>103</segment_id><speed>44.0</speed><valid>Y</valid></segment>" +
    "</segments>";

  it("keeps only the links whose detector answered", () => {
    const speeds = parseTrafficFeed(xml);
    expect(speeds.get(101)).toBe(11.5);
    expect(speeds.get(103)).toBe(44);
    // A dead detector reports the default 50, which is not a reading.
    expect(speeds.has(102)).toBe(false);
  });
});

describe("trafficLevel", () => {
  it("bands crawling, stuck, and free flow", () => {
    expect(trafficLevel(10)).toBe("congested");
    expect(trafficLevel(17)).toBe("congested");
    expect(trafficLevel(25)).toBe("slow");
    expect(trafficLevel(30)).toBe("slow");
    expect(trafficLevel(44)).toBeNull();
  });
});

describe("segmentsAlong", () => {
  // A route running due east along latitude 22.32 - roughly Mong Kok, so the
  // degree-to-metre maths is honest.
  const route: Position[][] = [
    [
      [114.16, 22.32],
      [114.18, 22.32],
    ],
  ];

  /** About `metres` north of the route's line. */
  const north = (metres: number) => 22.32 + metres / 111_320;

  const link = (a: Position, b: Position): Position[][] => [[a, b]];

  it("keeps a link riding the corridor the same way", () => {
    const links: SegmentShapes = new Map([[1, link([114.165, north(10)], [114.17, north(10)])]]);
    expect(segmentsAlong(route, links)).toEqual([1]);
  });

  it("drops the opposite carriageway", () => {
    // Same road, twenty metres over, running the other way.
    const links: SegmentShapes = new Map([[2, link([114.17, north(20)], [114.165, north(20)])]]);
    expect(segmentsAlong(route, links)).toEqual([]);
  });

  it("drops a cross-street that only touches the route", () => {
    // Due north through the route's line: near it at the junction, far from
    // it at both ends.
    const links: SegmentShapes = new Map([[3, link([114.17, north(-300)], [114.17, north(300)])]]);
    expect(segmentsAlong(route, links)).toEqual([]);
  });

  it("drops a parallel road outside the corridor", () => {
    const links: SegmentShapes = new Map([[4, link([114.165, north(120)], [114.17, north(120)])]]);
    expect(segmentsAlong(route, links)).toEqual([]);
  });

  it("answers nothing for a route with no drawn shape", () => {
    const links: SegmentShapes = new Map([[5, link([114.165, north(10)], [114.17, north(10)])]]);
    expect(segmentsAlong([], links)).toEqual([]);
  });
});
