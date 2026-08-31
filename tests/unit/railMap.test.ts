import { describe, expect, it } from "vitest";
import {
  LIGHT_RAIL_SHAPE,
  MAP_BENDS,
  MAP_EDGES,
  MAP_STATIONS,
  RACECOURSE,
  RACECOURSE_LOOP,
} from "~/data/railMap";

/**
 * The schematic map's geometry is generated once and then corrected by hand,
 * which is the part that needs a net under it. Moving one station to make room
 * for its name silently bends the two segments either side of it off the grid,
 * or slides it on top of a neighbour - and neither shows up until someone looks
 * at the right corner of the diagram at the right zoom.
 *
 * These are the rules the drawing depends on rather than opinions about how it
 * should look: run at a compass direction, stations far enough apart to be
 * separate things, and every segment joining two stations that exist.
 */

const byId = new Map(MAP_STATIONS.map((s) => [s.id, s]));
const edges = Object.entries(MAP_EDGES).flatMap(([line, pairs]) =>
  pairs.map(([a, b]) => ({ line, a, b })),
);

/** How far off the nearest of the eight compass directions, in degrees. */
function skew(ax: number, ay: number, bx: number, by: number): number {
  const degrees = (Math.atan2(by - ay, bx - ax) * 180) / Math.PI;
  return Math.abs(((((degrees + 22.5) % 45) + 45) % 45) - 22.5);
}

describe("the schematic map's geometry", () => {
  it("joins only stations it has", () => {
    const missing = edges.filter((e) => !byId.has(e.a) || !byId.has(e.b));
    expect(missing).toEqual([]);
  });

  it("gives every station at least one line", () => {
    expect(MAP_STATIONS.filter((s) => s.lines.length === 0)).toEqual([]);
  });

  /*
   * Not a round number: it is where the drawing actually breaks. At the zoom
   * that shows every name, a grid square is 34 pixels and an interchange bead
   * is 13 across, so two of them touch at 0.39 squares apart. This leaves half
   * again on top of that.
   *
   * The generator aims for a full square, which is roomier than this - the
   * point of the looser figure is that a hand correction is allowed to put two
   * stations genuinely close where the railway does, as Tsim Sha Tsui and its
   * East counterpart are, without being told it has broken something.
   */
  const CLEARANCE = 0.6;

  it("puts no two stations on top of each other", () => {
    const tooClose: string[] = [];
    for (let i = 0; i < MAP_STATIONS.length; i++) {
      for (let j = i + 1; j < MAP_STATIONS.length; j++) {
        const a = MAP_STATIONS[i]!;
        const b = MAP_STATIONS[j]!;
        if (Math.hypot(a.x - b.x, a.y - b.y) < CLEARANCE) tooClose.push(`${a.id}/${b.id}`);
      }
    }
    expect(tooClose).toEqual([]);
  });

  /*
   * A segment may turn between its stations - the elbows in `MAP_BENDS` - and
   * then it is every leg of the way that has to be on the grid, not the line
   * from one station to the other.
   */
  const legsOf = (a: string, b: string): [number, number][] => {
    const key = a < b ? `${a}:${b}` : `${b}:${a}`;
    const via = MAP_BENDS[key] ?? [];
    const from = byId.get(a)!;
    const to = byId.get(b)!;
    return [[from.x, from.y], ...(a < b ? via : [...via].reverse()), [to.x, to.y]];
  };

  it("runs every leg of every segment at a multiple of 45 degrees", () => {
    const bent = edges
      .filter((e) => {
        const legs = legsOf(e.a, e.b);
        return legs.some(
          (p, i) => i > 0 && skew(legs[i - 1]![0], legs[i - 1]![1], p[0], p[1]) > 0.5,
        );
      })
      .map((e) => `${e.line} ${e.a}-${e.b}`);
    expect(bent).toEqual([]);
  });

  it("bends only segments that exist", () => {
    const segments = new Set(edges.map((e) => (e.a < e.b ? `${e.a}:${e.b}` : `${e.b}:${e.a}`)));
    expect(Object.keys(MAP_BENDS).filter((key) => !segments.has(key))).toEqual([]);
  });

  it("draws the light rail's shape on the grid", () => {
    const off = LIGHT_RAIL_SHAPE.flatMap((shape) =>
      shape.filter((p, i) => i > 0 && skew(shape[i - 1]![0], shape[i - 1]![1], p[0], p[1]) > 0.5),
    );
    expect(off).toEqual([]);
  });

  /*
   * The Racecourse loop is drawn from nothing but these constants - the route
   * database has no station to anchor it - so the rules the other track lives
   * by are asserted for it directly: legs on the grid, and the marker actually
   * on the loop it names.
   */
  it("draws the racecourse loop on the grid, with its marker on it", () => {
    const off = RACECOURSE_LOOP.filter(
      (p, i) =>
        i > 0 && skew(RACECOURSE_LOOP[i - 1]![0], RACECOURSE_LOOP[i - 1]![1], p[0], p[1]) > 0.5,
    );
    expect(off).toEqual([]);

    const onLoop = RACECOURSE_LOOP.slice(0, -1).some((p, i) => {
      const q = RACECOURSE_LOOP[i + 1]!;
      const cross = (q[0] - p[0]) * (RACECOURSE[1] - p[1]) - (q[1] - p[1]) * (RACECOURSE[0] - p[0]);
      const along = (q[0] - p[0]) * (RACECOURSE[0] - p[0]) + (q[1] - p[1]) * (RACECOURSE[1] - p[1]);
      const length = (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2;
      return cross === 0 && along >= 0 && along <= length;
    });
    expect(onLoop).toBe(true);
  });

  it("gives every segment a length to draw", () => {
    const zero = edges.filter((e) => {
      const a = byId.get(e.a)!;
      const b = byId.get(e.b)!;
      return a.x === b.x && a.y === b.y;
    });
    expect(zero).toEqual([]);
  });
});
