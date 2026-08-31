import {
  LIGHT_RAIL,
  LIGHT_RAIL_SHAPE,
  MAP_BENDS,
  MAP_EDGES,
  MAP_STATIONS,
  RACECOURSE_LOOP,
  type MapStation,
} from "~/data/railMap";
import { lineRank } from "~/data/rail";

/**
 * The schematic map's geometry, worked out once from `railMap`: the chains
 * each line draws as, with their elbows and the offsets of shared track; the
 * directions the track leaves each station in; the rounded paths; and where
 * every station's name goes. None of it knows about the screen - the diagram
 * component asks for it at a zoom and draws the answer.
 */

/**
 * How wide a corner turns, in pixels - the radius of every bend in the map.
 *
 * Generous on purpose. The railway's own map is rows and columns joined by
 * curves you could roll a coin round, and that is most of what makes it look
 * drawn rather than wired. The cut is never more than half a leg, so a tight
 * corner on a short leg simply turns tighter rather than eating its neighbour.
 */
export const CORNER = 30;
/** A line is this wide, and a tram line this. */
export const LINE = 6;
export const TRAM_LINE = 3.5;
/**
 * Two lines on one stretch of track sit this far apart, centre to centre: a
 * hairline of background between them, so they read as two lines running
 * together rather than one line with a coloured edge.
 */
export const PAIR = LINE + 1.5;
export const MIN_SCALE = 4;
export const MAX_SCALE = 95;

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Point {
  x: number;
  y: number;
}

export const byId = new Map(MAP_STATIONS.map((s) => [s.id, s]));

/** Fit-to-window leaves this much air around the network, in grid squares. */
const MARGIN = 2.4;

/** The whole network's extent, with air around it. */
export const WORLD: Box = (() => {
  const xs = MAP_STATIONS.map((s) => s.x);
  const ys = MAP_STATIONS.map((s) => s.y);
  const x = Math.min(...xs) - MARGIN;
  const y = Math.min(...ys) - MARGIN;
  return { x, y, w: Math.max(...xs) + MARGIN - x, h: Math.max(...ys) + MARGIN - y };
})();

/**
 * The light rail is the map's second layer.
 *
 * Sixty-eight tram stops in the north-west corner, drawn at half the pitch of
 * the railway: at the zoom that shows the whole network they would be a solid
 * block, and the printed map does not draw them either - it draws the network
 * as a few loops in its colour and leaves it at that. So does this, until the
 * rider zooms into it, when the loops give way to the stops and their names,
 * the way a game map reveals a district. Touching the loops, or the network's
 * entry in the key, flies in.
 *
 * The threshold sits above the zoom the map opens at on a station, so the tram
 * stops are folded until the rider goes to them rather than there from the start.
 */
export const LIGHT_RAIL_FROM = 36;

/**
 * How many pixels a grid square needs before the ordinary stations' names are
 * worth drawing. Below it a three-character name is wider than the two squares
 * to the next station, so a fitted phone was ninety names on top of each
 * other; what survives at that zoom is the interchanges - the map's landmarks,
 * which is also all the printed map's folded-out cousins label first.
 */
export const EVERY_NAME_FROM = 10;

export const isLightRailOnly = (station: MapStation) =>
  station.lines.length === 1 && station.lines[0] === LIGHT_RAIL;

/** Where the light rail is, for flying into it. */
export const LIGHT_RAIL_BOX: Box = (() => {
  const on = MAP_STATIONS.filter((s) => s.lines.includes(LIGHT_RAIL));
  const xs = on.map((s) => s.x);
  const ys = on.map((s) => s.y);
  const x = Math.min(...xs) - 1.5;
  const y = Math.min(...ys) - 1.5;
  return { x, y, w: Math.max(...xs) + 1.5 - x, h: Math.max(...ys) + 1.5 - y };
})();

const pairKey = (a: string, b: string) => (a < b ? `${a}:${b}` : `${b}:${a}`);

/** The elbows between two stations, in the order they are met going a to b. */
function bendsBetween(a: string, b: string): Point[] {
  const points = (MAP_BENDS[pairKey(a, b)] ?? []).map(([x, y]) => ({ x, y }));
  return a < b ? points : points.reverse();
}

/**
 * The normal a leg's offset is pushed along, taken the same way whichever way
 * the chain happens to be walked - always the one that points east, or north
 * on a horizontal leg. Taken from the walk instead, two lines walked in
 * opposite directions were pushed to the same side and lay on top of each
 * other, which is how the Kwun Tong line vanished under Nathan Road.
 */
const across = (a: Point, b: Point): Point => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const d = Math.hypot(dx, dy) || 1;
  const n = { x: -dy / d, y: dx / d };
  return n.x < 0 || (n.x === 0 && n.y > 0) ? { x: -n.x, y: -n.y } : n;
};

const unit = (dx: number, dy: number): Point => {
  const d = Math.hypot(dx, dy) || 1;
  return { x: dx / d, y: dy / d };
};

/**
 * Where a line rides a shared stretch straight in from its own approach - the
 * Kwun Tong and Tseung Kwan O lines both turn onto the Yau Tong row before
 * the station - the approach's last leg carries the stretch's offset too,
 * keyed here as `line:pair` for `chainGeometry` to pick up. Without it both
 * approaches ran the centreline into the junction, one hiding the other; with
 * it each curve lands on the track it will ride, which is how the railway's
 * own map draws the merge.
 */
const EXTENDED = new Map<string, { junction: string; offset: number }>();

/**
 * Every segment to draw, each already offset off any segment it shares its two
 * stations with - the Airport Express and the Tung Chung line run between Hong
 * Kong and Kowloon together, and drawn honestly one simply hides the other.
 *
 * Which line takes which side is the side its own approach arrives from,
 * or the tracks cross at the junction - green from Lam Tin keeps the north
 * track into Yau Tong and purple from Quarry Bay the south, the Express
 * from its seaward shadow keeps the west track under Kowloon. Lines whose
 * approach rides the stretch's own axis take the running order of the
 * railway's key between whatever the sided ones have claimed.
 */
const SEGMENTS = (() => {
  const groups = new Map<string, { line: string; a: MapStation; b: MapStation }[]>();

  for (const code of Object.keys(MAP_EDGES)) {
    for (const [from, to] of MAP_EDGES[code] ?? []) {
      const a = byId.get(from);
      const b = byId.get(to);
      if (!a || !b) continue;
      const key = pairKey(from, to);
      groups.set(key, [...(groups.get(key) ?? []), { line: code, a, b }]);
    }
  }

  /**
   * How a line comes into one end of a shared stretch: which side of the
   * stretch's axis its approach arrives from, read off the first approach
   * point that stands off the axis - the elbow the curve turns at sits on
   * it - or null when the approach rides the axis itself. `straight` says
   * whether it runs straight through the junction, which is what decides
   * whether the stretch's offset reaches back along it.
   */
  const approach = (
    line: string,
    junction: MapStation,
    other: MapStation,
  ): { side: number; pair: string; straight: boolean } | null => {
    const legs = (MAP_EDGES[line] ?? []).filter(
      ([p, q]) => (p === junction.id || q === junction.id) && p !== other.id && q !== other.id,
    );
    if (legs.length !== 1) return null;
    const [p, q] = legs[0]!;
    const from = byId.get(p === junction.id ? q : p);
    if (!from) return null;

    const start = bendsBetween(junction.id, other.id)[0] ?? { x: other.x, y: other.y };
    const dir = unit(start.x - junction.x, start.y - junction.y);
    const n = across({ x: junction.x, y: junction.y }, start);

    const points = [{ x: from.x, y: from.y }, ...bendsBetween(from.id, junction.id)];
    const last = points[points.length - 1]!;
    const into = unit(junction.x - last.x, junction.y - last.y);
    const straight = into.x * dir.x + into.y * dir.y > 0.99;

    for (let i = points.length - 1; i >= 0; i--) {
      const side = (points[i]!.x - junction.x) * n.x + (points[i]!.y - junction.y) * n.y;
      if (Math.abs(side) > 0.1) return { side, pair: pairKey(from.id, junction.id), straight };
    }
    return null;
  };

  return [...groups.values()].flatMap((shared) => {
    let ordered = [...shared].sort((p, q) => lineRank(p.line) - lineRank(q.line));

    if (shared.length > 1) {
      const { a, b } = shared[0]!;
      for (const [junction, other] of [
        [a, b],
        [b, a],
      ] as const) {
        const sides = new Map<string, { side: number; pair: string; straight: boolean }>();
        for (const seg of shared) {
          const came = approach(seg.line, junction, other);
          if (came) sides.set(seg.line, came);
        }
        if (sides.size === 0) continue;

        ordered = [...shared].sort(
          (p, q) =>
            (sides.get(p.line)?.side ?? 0) - (sides.get(q.line)?.side ?? 0) ||
            lineRank(p.line) - lineRank(q.line),
        );
        ordered.forEach((seg, i) => {
          const came = sides.get(seg.line);
          if (!came?.straight) return;
          EXTENDED.set(`${seg.line}:${came.pair}`, {
            junction: junction.id,
            offset: i - (ordered.length - 1) / 2,
          });
        });
        break;
      }
    }

    return ordered.map((seg, i) => ({
      ...seg,
      /** In pair-widths, so the gap holds at every zoom. */
      offset: i - (ordered.length - 1) / 2,
    }));
  });
})();

/** How far a shared stretch is pushed off centre, in pair-widths. */
const OFFSET_OF = new Map<string, number>();
for (const seg of SEGMENTS) OFFSET_OF.set(`${seg.line}:${pairKey(seg.a.id, seg.b.id)}`, seg.offset);

/**
 * Which ways the track leaves each station, as unit vectors - one per line per
 * segment, towards the first elbow where there is one and the next station
 * where there is not. The elbow matters: a line that leaves Kowloon Bay
 * eastwards and turns south before Ngau Tau Kok leaves Kowloon Bay eastwards,
 * whatever direction Ngau Tau Kok is in.
 */
export const DIRECTIONS = new Map<string, Point[]>();
for (const seg of SEGMENTS) {
  for (const [from, to] of [
    [seg.a, seg.b],
    [seg.b, seg.a],
  ] as const) {
    const next = bendsBetween(from.id, to.id)[0] ?? to;
    const dx = next.x - from.x;
    const dy = next.y - from.y;
    const d = Math.hypot(dx, dy) || 1;
    DIRECTIONS.set(from.id, [...(DIRECTIONS.get(from.id) ?? []), { x: dx / d, y: dy / d }]);
  }
}

/**
 * A line, in running order, as the paths that draw it.
 *
 * Drawing each segment as its own straight line is what made the diagram look
 * like a wiring schematic: a railway on a map turns corners, and a corner is a
 * curve, not a mitre. A curve needs to know what comes before and after, which
 * a loose segment does not - so the edges are walked back into the sequences
 * the trains actually run, and each sequence becomes one path.
 *
 * A branch is simply a station with three neighbours, so the walk yields more
 * than one chain for East Rail and Tseung Kwan O and nothing has to know that.
 */
function chainsOf(code: string): MapStation[][] {
  const pairs = MAP_EDGES[code] ?? [];
  const adjacent = new Map<string, string[]>();
  for (const [a, b] of pairs) {
    adjacent.set(a, [...(adjacent.get(a) ?? []), b]);
    adjacent.set(b, [...(adjacent.get(b) ?? []), a]);
  }

  const walked = new Set<string>();
  const chains: string[][] = [];

  const walk = (from: string, to: string) => {
    const chain = [from, to];
    walked.add(pairKey(from, to));
    let previous = from;
    let at = to;

    // Straight through a two-neighbour station; stop at a junction or an end,
    // where the next stretch is somebody else's chain.
    while ((adjacent.get(at)?.length ?? 0) === 2) {
      const next = adjacent.get(at)!.find((n) => n !== previous);
      if (!next || walked.has(pairKey(at, next))) break;
      walked.add(pairKey(at, next));
      chain.push(next);
      previous = at;
      at = next;
    }
    return chain;
  };

  // From the ends and the junctions first, so the long runs come out whole.
  const ordered = [...adjacent.keys()].sort(
    (a, b) => (adjacent.get(a)?.length ?? 0) - (adjacent.get(b)?.length ?? 0),
  );
  for (const start of ordered) {
    for (const next of adjacent.get(start) ?? []) {
      if (walked.has(pairKey(start, next))) continue;
      chains.push(walk(start, next));
    }
  }

  return chains.map((ids) => ids.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : [])));
}

/**
 * A chain as the points its path goes through - stations and the elbows
 * between them - with the offset each leg carries for the stretch it is on.
 * A leg that runs straight into a shared stretch carries the stretch's offset
 * on the piece that touches the junction, so its curve lands on its own track.
 */
function chainGeometry(
  code: string,
  stations: MapStation[],
): { points: Point[]; shifts: number[] } {
  const points: Point[] = [];
  const shifts: number[] = [];
  stations.forEach((station, i) => {
    points.push({ x: station.x, y: station.y });
    const next = stations[i + 1];
    if (!next) return;
    const pair = pairKey(station.id, next.id);
    const shift = OFFSET_OF.get(`${code}:${pair}`) ?? 0;
    const elbows = bendsBetween(station.id, next.id);
    const legShifts = new Array<number>(elbows.length + 1).fill(shift);
    const extended = shift === 0 ? EXTENDED.get(`${code}:${pair}`) : undefined;
    if (extended?.junction === next.id) legShifts[legShifts.length - 1] = extended.offset;
    else if (extended?.junction === station.id) legShifts[0] = extended.offset;
    points.push(...elbows);
    shifts.push(...legShifts);
  });
  return { points, shifts };
}

export const CHAINS = Object.keys(MAP_EDGES).flatMap((code) =>
  chainsOf(code).map((stations) => ({ code, stations, ...chainGeometry(code, stations) })),
);

/**
 * Every straight piece of track on the map, for keeping names off it. A leg
 * runs between two consecutive points of a chain, elbows included.
 */
const LEGS: { a: Point; b: Point; tram: boolean }[] = [
  ...CHAINS.flatMap((chain) =>
    chain.points
      .slice(0, -1)
      .map((a, i) => ({ a, b: chain.points[i + 1]!, tram: chain.code === LIGHT_RAIL })),
  ),
  // The Racecourse loop is track too, as far as a name is concerned: Fo Tan's
  // name flipping east would sit on it.
  ...RACECOURSE_LOOP.slice(0, -1).map(([x, y], i) => {
    const [bx, by] = RACECOURSE_LOOP[i + 1]!;
    return { a: { x, y }, b: { x: bx, y: by }, tram: false };
  }),
];

/** The light rail's loops, as legs, for the zooms at which they stand for it. */
const SHAPE_LEGS: { a: Point; b: Point }[] = LIGHT_RAIL_SHAPE.flatMap((shape) =>
  shape
    .slice(0, -1)
    .map(([x, y]) => ({ x, y }))
    .map((a, i) => {
      const [bx, by] = shape[i + 1]!;
      return { a, b: { x: bx, y: by } };
    }),
);

const towards = (from: Point, to: Point, by: number): Point => {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const d = Math.hypot(dx, dy) || 1;
  return { x: from.x + (dx / d) * by, y: from.y + (dy / d) * by };
};

/** How far back from a corner its curve begins: the radius, or half a leg. */
const cutAt = (before: Point, corner: Point, after: Point, radius: number) =>
  Math.min(
    radius,
    Math.hypot(corner.x - before.x, corner.y - before.y) / 2,
    Math.hypot(after.x - corner.x, after.y - corner.y) / 2,
  );

const bend = (before: Point, corner: Point, after: Point, radius: number) => {
  const cut = cutAt(before, corner, after, radius);
  const enter = towards(corner, before, cut);
  const leave = towards(corner, after, cut);
  return ` L ${enter.x} ${enter.y} Q ${corner.x} ${corner.y} ${leave.x} ${leave.y}`;
};

/**
 * The path for one run, with its corners rounded.
 *
 * Each corner is cut back along both of its legs by the radius and rejoined
 * through the corner itself as a quadratic curve, which is the shape a drawn
 * railway uses. The cut is never more than half a leg, so two corners on a
 * short segment cannot eat each other and turn the line inside out.
 */
export function roundedPath(points: Point[], radius: number): string {
  if (points.length < 2) return "";
  let d = `M ${points[0]!.x} ${points[0]!.y}`;
  for (let i = 1; i < points.length - 1; i++) {
    d += bend(points[i - 1]!, points[i]!, points[i + 1]!, radius);
  }
  const end = points[points.length - 1]!;
  return `${d} L ${end.x} ${end.y}`;
}

/**
 * A run's points, each leg pushed off centre where it shares its two stations
 * with another line, so parallel track reads as two lines running together
 * rather than one hiding the other.
 *
 * At a corner the two legs' offsets are not averaged but met: the point moves
 * to where *both* legs sit their own offset off their centreline - a full one
 * round a bend, which keeps a pair the same distance apart through a turn,
 * and each leg's own where a line turns onto a shared stretch, which lands
 * the turning curve on its track. Averaging did neither: it pinched every
 * pair at every turn, and ran every merge down the centreline. Where the two
 * legs run the same way - a shared stretch ending at a station on a straight
 * - there is no corner to meet at, and the mean keeps the path continuous:
 * there the pinch is the point.
 */
export function offsetPoints(points: Point[], shifts: number[], width: number): Point[] {
  return points.map((point, i) => {
    const before = i > 0 ? points[i - 1]! : null;
    const after = i < points.length - 1 ? points[i + 1]! : null;
    const d1 = (before ? (shifts[i - 1] ?? 0) : 0) * width;
    const d2 = (after ? (shifts[i] ?? 0) : 0) * width;

    if (!before || !after) {
      const n = before ? across(before, point) : across(point, after!);
      const d = before ? d1 : d2;
      return { x: point.x + n.x * d, y: point.y + n.y * d };
    }

    const n1 = across(before, point);
    const n2 = across(point, after);
    const det = n1.x * n2.y - n1.y * n2.x;
    if (Math.abs(det) > 0.1) {
      return {
        x: point.x + (d1 * n2.y - d2 * n1.y) / det,
        y: point.y + (d2 * n1.x - d1 * n2.x) / det,
      };
    }
    return { x: point.x + (n1.x * d1 + n2.x * d2) / 2, y: point.y + (n1.y * d1 + n2.y * d2) / 2 };
  });
}

/*
 * An interchange is a capsule with one short coloured bar per line through it,
 * drawn across the direction those lines run - which is how the railway draws
 * it on its own map, and says at a glance what a single larger circle cannot:
 * how many lines meet here, and which. A station on one line is a ringed bead
 * on that line.
 */
/** The capsule's short axis, in pixels. */
export const CAPSULE = 13;
/** One bar per line, this far apart and this big. */
export const BAR_GAP = 6;
export const BAR_W = 7.5;
export const BAR_H = 2.4;
/** A station on one line only. */
export const BEAD_R = 5.2;
/** The circles inside a branch interchange's capsule. */
export const TWIN_R = 3;

/**
 * Stations that are an interchange within one line: their two branches meet
 * across a platform, and the railway's own map gives each the capsule with a
 * white circle per branch rather than a bead - Sheung Shui between Lo Wu and
 * Lok Ma Chau, Tseung Kwan O between Po Lam and LOHAS Park. Which forks earn
 * this is the map's judgement, not something the topology can say.
 */
export const TWIN = new Set(["SHS", "TKO"]);
/** How many marks a station's marker carries: bars, circles, or one bead. */
export const slotsOf = (station: MapStation): number =>
  TWIN.has(station.id) ? 2 : station.lines.length;

/**
 * Which way to lay the capsule: across the axis most of the track runs on.
 *
 * Counting the ways the track leaves, by axis, rather than averaging them:
 * an average of a vertical pair and one horizontal line is a tilt, and a
 * tilted capsule on a map of rights angles is the one thing on it that looks
 * wrong. At Prince Edward two lines run south and one arrives from the west
 * and one from the north-east, and the capsule lies across the pair. A tie
 * goes to the vertical, then the horizontal: on this map the diagonals are
 * the connectors, and the rows and columns are the lines.
 */
export function capsuleAngle(directions: Point[]): number {
  const count = [0, 0, 0, 0];
  for (const { x, y } of directions) {
    const degrees = (Math.atan2(y, x) * 180) / Math.PI;
    count[((Math.round(degrees / 45) % 4) + 4) % 4]! += 1;
  }
  let best = 2;
  for (const axis of [2, 0, 1, 3]) if (count[axis]! > count[best]!) best = axis;
  return best * 45;
}

/**
 * The order a capsule's bars are drawn in: each line's bar on the side its
 * track actually passes the station. Drawn in the key's order instead, the
 * bars at Mong Kok read green-red while the tracks run red-green, and a
 * rider lining the map up with the platform got the answer backwards. Lines
 * whose track runs the centreline keep the key's order between the rest.
 */
export const BAR_LINES = new Map<string, string[]>();
for (const station of MAP_STATIONS) {
  if (station.lines.length < 2) continue;
  const rad = (capsuleAngle(DIRECTIONS.get(station.id) ?? []) * Math.PI) / 180;
  /** Where along the capsule bar `i + 1` sits relative to bar `i`. */
  const axis = { x: -Math.sin(rad), y: Math.cos(rad) };

  /** How far off the centreline this line's track passes, along the axis. */
  const shiftOf = (line: string): number => {
    for (const seg of SEGMENTS) {
      if (seg.line !== line || seg.offset === 0) continue;
      const other = seg.a.id === station.id ? seg.b : seg.b.id === station.id ? seg.a : null;
      if (!other) continue;
      const start = bendsBetween(station.id, other.id)[0] ?? { x: other.x, y: other.y };
      const n = across({ x: station.x, y: station.y }, start);
      return (n.x * axis.x + n.y * axis.y) * seg.offset;
    }
    return 0;
  };
  BAR_LINES.set(
    station.id,
    [...station.lines].sort((p, q) => shiftOf(p) - shiftOf(q)),
  );
}

/*
 * Where each station's name goes.
 *
 * A printed map's names are placed one at a time by somebody looking at the
 * whole sheet: on the free side of the track, off the next name along, off
 * any other line that happens to pass. This does the same, greedily, with
 * every rule written down as a cost. Each name tries the eight compass
 * placements, pays for every name, marker and stretch of track it would sit
 * on, pays a little for being on a side it would rather not be, and takes the
 * cheapest. Interchanges go first - their names are larger and their free side
 * is the one their own tracks leave, which is a better answer than any stagger
 * - and the rest follow in running order along each line, so on a straight
 * run where names are wider than the pitch the second name finds the first
 * already on one side and takes the other. That alternation is not a rule
 * here; it is what the costs produce when the names are tight, and it stops
 * happening by itself when the zoom gives them room, which is when a printed
 * map stops doing it too.
 *
 * Names are measured in pixels and the map in squares, so the answer depends
 * on the zoom: the placement is re-made when the scale moves by a large step,
 * evaluated at the smaller end of the step so a name never gets less room
 * than it was placed with.
 */
export interface Placement {
  dx: number;
  dy: number;
  anchor: "start" | "middle" | "end";
  baseline: "auto" | "middle" | "hanging";
}

const DIAG = Math.SQRT1_2;
export const PLACEMENTS: Placement[] = [
  { dx: 1, dy: 0, anchor: "start", baseline: "middle" },
  { dx: -1, dy: 0, anchor: "end", baseline: "middle" },
  { dx: DIAG, dy: -DIAG, anchor: "start", baseline: "auto" },
  { dx: -DIAG, dy: -DIAG, anchor: "end", baseline: "auto" },
  { dx: DIAG, dy: DIAG, anchor: "start", baseline: "hanging" },
  { dx: -DIAG, dy: DIAG, anchor: "end", baseline: "hanging" },
  { dx: 0, dy: -1, anchor: "middle", baseline: "auto" },
  { dx: 0, dy: 1, anchor: "middle", baseline: "hanging" },
];

/** Type sizes, in pixels: the name, and the other language under it. */
export const NAME_SIZE = { interchange: 12.5, station: 11, tram: 9.5 };
export const OTHER_SIZE = { interchange: 9.2, station: 9.2, tram: 8 };
/** How far below the name's baseline the second line sits, lifted or hung. */
export const STACK = 10;

/**
 * Roughly how wide a name draws, in pixels: an ideograph is an em, Latin is
 * about half of one. It only has to be right enough to know what collides.
 */
function textWidth(text: string, size: number): number {
  let w = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (code >= 0x2e80) w += size;
    else if (ch === " ") w += 0.28 * size;
    else if (/[A-Z0-9]/.test(ch)) w += 0.64 * size;
    else w += 0.52 * size;
  }
  return w;
}

/**
 * Which side a station would rather have its name on, before anything else is
 * considered: a corner or a terminus has a side the track cannot be on, and a
 * station on a straight run has two, either as good as the other.
 */
function freeSide(directions: Point[]): { x: number; y: number; straight: boolean } {
  let sx = 0;
  let sy = 0;
  for (const d of directions) {
    sx += d.x;
    sy += d.y;
  }
  const strength = Math.hypot(sx, sy);
  if (strength >= 0.25) return { x: -sx / strength, y: -sy / strength, straight: false };
  const along = directions[0] ?? { x: 1, y: 0 };
  return { x: -along.y, y: along.x, straight: true };
}

/** How much of `a` lies under `b`, as a fraction of `a`: none, some, or all. */
function covered(a: Box, b: Box): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  if (w <= 0 || h <= 0 || a.w <= 0 || a.h <= 0) return 0;
  return (w * h) / (a.w * a.h);
}

/**
 * What a collision costs: a little for touching, and steeply more the deeper
 * it goes. A name that grazes the edge of a marker is a name a rider can still
 * read; two names printed on top of each other are neither. The flat part is
 * small so that a graze does not cost as much as a real overlap somewhere
 * else, which is what used to push names diagonally into their neighbours'
 * room to avoid touching anything at all.
 */
const collide = (weight: number, fraction: number) =>
  fraction > 0 ? weight * (0.1 + fraction + fraction * fraction) : 0;

/** Whether a box comes within `pad` of a segment. */
function nearLeg(box: Box, a: Point, b: Point, pad: number): boolean {
  const grown = { x: box.x - pad, y: box.y - pad, w: box.w + pad * 2, h: box.h + pad * 2 };
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  // Liang-Barsky: clip the segment to the box, and see if anything survives.
  let t0 = 0;
  let t1 = 1;
  for (const [p, q] of [
    [-dx, a.x - grown.x],
    [dx, grown.x + grown.w - a.x],
    [-dy, a.y - grown.y],
    [dy, grown.y + grown.h - a.y],
  ] as const) {
    if (p === 0) {
      if (q < 0) return false;
      continue;
    }
    const r = q / p;
    if (p < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
  }
  return t0 <= t1;
}

export function placeLabels(options: {
  /** Pixels per square, at the small end of the step the map is in. */
  scale: number;
  name: (id: string) => string;
  other: (id: string) => string;
  bilingual: boolean;
  tramShown: boolean;
  tramBilingual: boolean;
  /** Whether ordinary stations are named at this zoom, or interchanges only. */
  minorShown: boolean;
  /** Every candidate considered, with what it would have cost: for tooling. */
  trace?: (id: string, placement: Placement, cost: number, why: string[]) => void;
  /** Where each name ended up, as a box: for tooling. */
  placed?: (id: string, placement: Placement, box: Box) => void;
}): Map<string, Placement> {
  const k = 1 / options.scale;
  const chosen = new Map<string, { placement: Placement; cost: number; box: Box }>();

  const kind = (station: MapStation) =>
    slotsOf(station) > 1 ? "interchange" : isLightRailOnly(station) ? "tram" : "station";

  /**
   * A station's marker, as a box, for keeping other names off it: a bead, or
   * a capsule the way it actually lies - a vertical capsule beside a row is
   * narrow, and boxing it square walled off the row's names.
   */
  const marker = (station: MapStation): Box => {
    if (slotsOf(station) > 1) {
      const long = ((slotsOf(station) - 1) * BAR_GAP + CAPSULE) * k;
      const short = CAPSULE * k;
      const angle = capsuleAngle(DIRECTIONS.get(station.id) ?? []);
      const w = angle === 0 ? short : angle === 90 ? long : long * DIAG;
      const h = angle === 0 ? long : angle === 90 ? short : long * DIAG;
      return { x: station.x - w / 2, y: station.y - h / 2, w, h };
    }
    const r = (isLightRailOnly(station) ? BEAD_R * 0.7 : BEAD_R) * k;
    return { x: station.x - r, y: station.y - r, w: r * 2, h: r * 2 };
  };
  const markers = MAP_STATIONS.filter((s) => options.tramShown || !isLightRailOnly(s)).map(
    (s) => [s.id, marker(s)] as const,
  );
  const legs = LEGS.filter((leg) => options.tramShown || !leg.tram);
  const shape = options.tramShown ? [] : SHAPE_LEGS;
  const track = (LINE / 2 + 1.5) * k;

  /** The cheapest placement for a station, given every other name as it stands. */
  const evaluate = (station: MapStation) => {
    const which = kind(station);
    const two = which === "tram" ? options.tramBilingual : options.bilingual;
    const bold = which !== "tram";
    const w =
      Math.max(
        textWidth(options.name(station.id), NAME_SIZE[which]) * (bold ? 1.06 : 1),
        two ? textWidth(options.other(station.id), OTHER_SIZE[which]) : 0,
      ) * k;
    const h1 = NAME_SIZE[which] * 1.15 * k;
    const h2 = two ? STACK * k : 0;
    const clear = (which === "interchange" ? CAPSULE / 2 + 3 : BEAD_R + 4) * k;
    const prefer = freeSide(DIRECTIONS.get(station.id) ?? []);

    let best: { placement: Placement; cost: number; box: Box } | null = null;
    for (const placement of PLACEMENTS) {
      const px = station.x + placement.dx * clear;
      const py = station.y + placement.dy * clear;
      const x =
        placement.anchor === "start" ? px : placement.anchor === "end" ? px - w : px - w / 2;
      // Above the marker the pair is lifted so the second line clears it;
      // level with it or below, the second line hangs under the first.
      const y =
        placement.baseline === "auto"
          ? py - h1 - h2
          : placement.baseline === "hanging"
            ? py
            : py - h1 / 2;
      const box: Box = { x, y, w, h: h1 + h2 };

      /*
       * On a straight run the two sides across the line are the answer and
       * a diagonal is a poor third: it is the next station's room. At a
       * corner or an end, the free side is best and the side the track is on
       * is worst, with everything else in between.
       */
      const along = placement.dx * prefer.x + placement.dy * prefer.y;
      let cost = prefer.straight ? (1 - Math.abs(along)) * 4 : (1 - along) * 2;
      const why: string[] = [];
      for (const [id, other] of chosen) {
        if (id === station.id) continue;
        const c = collide(8, covered(box, other.box));
        if (c > 0) why.push(`label ${id} ${c.toFixed(1)}`);
        cost += c;
      }
      for (const [id, m] of markers) {
        if (id === station.id) continue;
        const c = collide(5, covered(m, box));
        if (c > 0) why.push(`marker ${id} ${c.toFixed(1)}`);
        cost += c;
      }
      for (const leg of legs) {
        if (!nearLeg(box, leg.a, leg.b, track)) continue;
        why.push(`leg ${leg.a.x},${leg.a.y}-${leg.b.x},${leg.b.y}`);
        cost += 4;
      }
      for (const leg of shape) if (nearLeg(box, leg.a, leg.b, track)) cost += 2;

      options.trace?.(station.id, placement, cost, why);
      if (!best || cost < best.cost) best = { placement, cost, box };
      if (cost === 0) break;
    }
    return best!;
  };

  /*
   * Interchanges first, then the rest in running order along each line, then
   * the tram stops if they are drawn. Then twice more round the same order,
   * each name re-choosing with every other name where it now is: the first
   * pass is greedy, and a name placed early can turn out to have taken the
   * only room its neighbour had. A second look moves it if that is cheaper
   * overall, and a third settles what the second disturbed.
   */
  const order: MapStation[] = [];
  const queue = (station: MapStation) => {
    if (!order.includes(station)) order.push(station);
  };
  for (const station of [...MAP_STATIONS]
    .filter((s) => slotsOf(s) > 1)
    .sort((p, q) => slotsOf(q) - slotsOf(p) || (p.id < q.id ? -1 : 1)))
    queue(station);
  if (options.minorShown)
    for (const chain of CHAINS) if (chain.code !== LIGHT_RAIL) chain.stations.forEach(queue);
  if (options.tramShown) {
    for (const chain of CHAINS) if (chain.code === LIGHT_RAIL) chain.stations.forEach(queue);
  }

  for (const station of order) chosen.set(station.id, evaluate(station));
  for (let pass = 0; pass < 2; pass++) {
    for (const station of order) {
      // The stored cost is from when this name last chose, before later names
      // landed around it, so it cannot be compared against: re-choose with
      // everything where it now stands and keep whichever placement that is.
      chosen.set(station.id, evaluate(station));
    }
  }

  const placements = new Map<string, Placement>();
  for (const [id, { placement, box }] of chosen) {
    placements.set(id, placement);
    options.placed?.(id, placement, box);
  }
  return placements;
}

/** The step the placement is re-made at: the zoom, floored to a power of this. */
export const PLACEMENT_STEP = 1.5;
