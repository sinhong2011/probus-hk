import type { Position } from "~/data/waypoints";

/**
 * Distances along a route line.
 *
 * Everything here works in metres measured along the drawn line rather than in
 * straight-line distance, because that is the only measure a bus can be placed
 * with: a bus is never 400 metres from a stop, it is 400 metres of road from
 * it. Longitude and latitude are scaled to metres locally - Hong Kong is small
 * enough that one scale factor per point is exact to well under a metre, and a
 * projection library would be a dependency for no gain at this size.
 */

/** Metres per degree, near enough at Hong Kong's latitude. */
export function metresPerDegree(lat: number) {
  return { x: 111_320 * Math.cos((lat * Math.PI) / 180), y: 110_540 };
}

export interface Scale {
  x: number;
  y: number;
}

/** The point on segment `a`-`b` closest to `p`, and how far away it is. */
export function nearestOnSegment(p: Position, a: Position, b: Position, scale: Scale) {
  const ax = a[0] * scale.x;
  const ay = a[1] * scale.y;
  const bx = b[0] * scale.x;
  const by = b[1] * scale.y;
  const px = p[0] * scale.x;
  const py = p[1] * scale.y;

  const dx = bx - ax;
  const dy = by - ay;
  const length = dx * dx + dy * dy;
  // A zero-length segment is its own nearest point.
  const along =
    length === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / length));

  const x = ax + along * dx;
  const y = ay + along * dy;
  return {
    distance: Math.hypot(px - x, py - y),
    point: [x / scale.x, y / scale.y] as Position,
    along,
  };
}

/** One continuous path with a running distance at every point. */
export interface MeasuredLine {
  points: Position[];
  /** Metres from the start of the line at each point; ascending. */
  measures: number[];
  length: number;
}

function metresBetween(a: Position, b: Position): number {
  const scale = metresPerDegree((a[1] + b[1]) / 2);
  return Math.hypot((b[0] - a[0]) * scale.x, (b[1] - a[1]) * scale.y);
}

export function measureLine(points: Position[]): MeasuredLine {
  const measures: number[] = [];
  let total = 0;
  for (let i = 0; i < points.length; i += 1) {
    const previous = points[i - 1];
    const point = points[i];
    if (previous && point) total += metresBetween(previous, point);
    measures.push(total);
  }
  return { points, measures, length: total };
}

/**
 * The published geometry joined into one path, end to end.
 *
 * hkbus serves some routes as a single LineString and others as a handful of
 * pieces in no particular order, sometimes drawn back to front. A bus can only
 * be placed along one continuous path, so the pieces are chained by whichever
 * loose end is nearest, flipping each piece as needed. Where the pieces really
 * do not join - a route drawn in two disconnected halves - this still produces
 * a path, and the jump shows up as a gap the placement steps over rather than
 * as a bus in the harbour.
 */
/** Pieces that end and start this close to each other are already joined. */
const JOINED_METRES = 25;

function appendPoints(path: Position[], points: Position[], skipFirst = false) {
  const from = skipFirst ? 1 : 0;
  for (let i = from; i < points.length; i += 1) path.push(points[i] as Position);
}

function prependPoints(path: Position[], points: Position[], skipLast = false): Position[] {
  const end = skipLast ? points.length - 1 : points.length;
  if (end <= 0) return path;
  return points.slice(0, end).concat(path);
}

export function stitchLines(lines: Position[][]): Position[] {
  const usable = lines.filter((line) => line.length >= 2);
  if (usable.length === 0) return lines.flat();
  if (usable.length === 1) return usable[0] as Position[];

  /*
   * Almost always, the pieces are one per stop-to-stop segment and already in
   * the route's order - hkbus publishes them that way. Then the order is the
   * publisher's own and nothing guessed from endpoints can beat it: on a
   * circular route, where the line comes back past itself, nearest-endpoint
   * chaining will happily join the wrong halves of the loop.
   */
  const joined = usable.every((line, index) => {
    if (index === 0) return true;
    const previous = usable[index - 1] as Position[];
    return (
      metresBetween(previous[previous.length - 1] as Position, line[0] as Position) < JOINED_METRES
    );
  });
  if (joined) {
    const path = (usable[0] as Position[]).slice();
    for (const line of usable.slice(1)) appendPoints(path, line, true);
    return path;
  }

  // Start from the longest piece: it is the one most likely to be the trunk of
  // the route, and a wrong first choice propagates through the whole chain.
  const remaining = [...usable];
  remaining.sort((a, b) => b.length - a.length);
  let path = (remaining.shift() as Position[]).slice();

  while (remaining.length > 0) {
    const head = path[0] as Position;
    const tail = path[path.length - 1] as Position;

    let best = { index: 0, distance: Number.POSITIVE_INFINITY, atHead: false, flip: false };
    const offer = (index: number, distance: number, atHead: boolean, flip: boolean) => {
      if (distance < best.distance) best = { index, distance, atHead, flip };
    };

    /*
     * Both ends of the path are open, because the trunk is not always the
     * piece the route starts with: a line drawn from a mid-route interchange
     * outwards has to be grown backwards as well as forwards, and a chain that
     * can only be extended from its tail would double back on itself instead.
     */
    remaining.forEach((line, index) => {
      const first = line[0] as Position;
      const last = line[line.length - 1] as Position;
      offer(index, metresBetween(tail, first), false, false);
      offer(index, metresBetween(tail, last), false, true);
      offer(index, metresBetween(head, last), true, false);
      offer(index, metresBetween(head, first), true, true);
    });

    const next = remaining.splice(best.index, 1)[0] as Position[];
    const oriented = best.flip ? next.slice().reverse() : next;
    // Drop a duplicated joint so the path has no zero-length segment.
    const joined = best.distance < 1;

    if (best.atHead) {
      path = prependPoints(path, oriented, joined);
    } else {
      appendPoints(path, oriented, joined);
    }
  }

  return path;
}

export interface StopMeasures {
  /** Metres along the line for each stop, in stop order; non-decreasing. */
  measures: number[];
  /** How far each stop sits from the line, in metres, in stop order. */
  offsets: number[];
  /** The worst of those. */
  worstOffset: number;
  /** The line the measures refer to - reversed from the input if it was drawn backwards. */
  line: MeasuredLine;
}

/**
 * Two projections this far apart along the line are different passes of it,
 * not two guesses at the same one - and a route that passes its own path is
 * ordinary in Hong Kong, where a circular route ends where it began.
 */
const ANOTHER_PASS_METRES = 150;

/**
 * How much nearer a later pass has to be before it wins. Without this, the
 * first stop of a circular route binds to the *end* of the loop - the same
 * kerb, a metre or two closer in the data - and the forward-only rule then
 * drags every stop after it to the end of the line, which is how a whole route
 * came to have no buses on it at all.
 */
const ANOTHER_PASS_MARGIN = 25;

/**
 * How far a stop may sit from the line before that stop is not on it.
 *
 * Stop coordinates and route geometry come from different publishers and
 * disagree by tens of metres routinely; a quarter of a kilometre means they
 * are describing different roads.
 *
 * It is judged per stop, and the line as a whole is only thrown away when most
 * of its stops fail. Published geometry is sometimes short at one end - 91P is
 * drawn to the gates of the university and not the two stops inside it - and
 * refusing the whole route for that took eleven perfectly measured stops down
 * with the two bad ones.
 */
export const TRUST_METRES = 250;

function measureForward(line: MeasuredLine, stops: Position[]) {
  const measures: number[] = [];
  const offsets: number[] = [];
  const last = line.points[line.points.length - 1] as Position;
  let worstOffset = 0;
  let total = 0;
  let from = 0;
  /** No stop may be measured behind the one before it. */
  let floor = 0;

  for (const stop of stops) {
    const scale = metresPerDegree(stop[1]);
    let best: { distance: number; measure: number; index: number } | null = null;

    /*
     * The search only ever moves forward along the line, and never behind the
     * previous stop. That is what keeps the measures ascending, and it is also
     * the only way a circular route works: a terminus visited twice is two
     * different distances along the line, and an unconstrained search would
     * collapse them into one - putting the second half of the route back at
     * the start of it.
     *
     * It is also what tells the two orientations apart. Geometry drawn back to
     * front cannot satisfy this at all, so it piles up error, and the caller
     * reads that error as the answer to which way round the line is.
     */
    for (let i = Math.max(1, from); i < line.points.length; i += 1) {
      const a = line.points[i - 1];
      const b = line.points[i];
      if (!a || !b) continue;

      const hit = nearestOnSegment(stop, a, b, scale);
      const start = line.measures[i - 1] ?? 0;
      const end = line.measures[i] ?? start;
      const measure = start + (end - start) * hit.along;
      if (measure < floor - 1) continue;

      const candidate = { distance: hit.distance, measure, index: i - 1 };
      if (!best) {
        best = candidate;
      } else if (measure - best.measure < ANOTHER_PASS_METRES) {
        // The same stretch of line: simply the nearest point on it.
        if (candidate.distance < best.distance) best = candidate;
      } else if (candidate.distance < best.distance - ANOTHER_PASS_MARGIN) {
        // Another pass entirely, and clearly the better fit for this stop.
        best = candidate;
      }
    }

    // Nothing left ahead: the line has run out before the stops have.
    best ??= {
      distance: metresBetween(stop, last),
      measure: line.length,
      index: Math.max(0, line.points.length - 2),
    };

    measures.push(best.measure);
    offsets.push(best.distance);
    from = best.index;
    floor = best.measure;
    total += best.distance;
    worstOffset = Math.max(worstOffset, best.distance);
  }

  return { measures, offsets, worstOffset, total };
}

/**
 * Where each stop sits along the line, or `null` when the line cannot be
 * trusted to describe this route.
 *
 * Both directions are tried, because the published geometry is drawn back to
 * front often enough to matter and a reversed line puts every bus at the wrong
 * end of the route - the one error a rider would never forgive. Whichever
 * orientation the stops fit better is the one the route is drawn in.
 */
export function measureStops(line: MeasuredLine, stops: Position[]): StopMeasures | null {
  if (stops.length === 0 || line.points.length < 2) return null;

  const forward = measureForward(line, stops);
  const reversedLine = measureLine([...line.points].reverse());
  const backward = measureForward(reversedLine, stops);

  const flipped = backward.total < forward.total;
  const best = flipped ? backward : forward;

  /*
   * Most of the stops have to be on the line for the line to be this route's.
   * The median rather than the worst: one stop in a car park is a stop in a car
   * park, and half of them adrift is a different road.
   */
  const sorted = [...best.offsets].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
  if (median > TRUST_METRES) return null;

  return {
    measures: best.measures,
    offsets: best.offsets,
    worstOffset: best.worstOffset,
    line: flipped ? reversedLine : line,
  };
}

/** Compass bearing in degrees, clockwise from north - what `icon-rotate` wants. */
function bearingBetween(a: Position, b: Position): number {
  const scale = metresPerDegree((a[1] + b[1]) / 2);
  const east = (b[0] - a[0]) * scale.x;
  const north = (b[1] - a[1]) * scale.y;
  if (east === 0 && north === 0) return 0;
  return (Math.atan2(east, north) * 180) / Math.PI;
}

/** The index of the last point at or before `measure`. */
function segmentAt(line: MeasuredLine, measure: number): number {
  let low = 0;
  let high = line.measures.length - 1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if ((line.measures[mid] as number) <= measure) low = mid;
    else high = mid - 1;
  }
  return low;
}

export interface PointOnLine {
  position: Position;
  /** Which way the line is heading there, so a marker can face along it. */
  bearing: number;
}

/** The point `measure` metres along the line, clamped to its two ends. */
export function pointAt(line: MeasuredLine, measure: number): PointOnLine {
  const last = line.points.length - 1;
  if (last < 0) return { position: [0, 0], bearing: 0 };
  if (last === 0) return { position: line.points[0] as Position, bearing: 0 };

  const clamped = Math.max(0, Math.min(line.length, measure));
  const index = Math.min(segmentAt(line, clamped), last - 1);
  const a = line.points[index] as Position;
  const b = line.points[index + 1] as Position;
  const start = line.measures[index] as number;
  const end = line.measures[index + 1] as number;
  const span = end - start;
  const along = span === 0 ? 0 : (clamped - start) / span;

  return {
    position: [a[0] + (b[0] - a[0]) * along, a[1] + (b[1] - a[1]) * along],
    bearing: bearingBetween(a, b),
  };
}

/**
 * The stretch of line between two distances, as its own path - what an
 * uncertainty band is drawn along.
 */
export function sliceLine(line: MeasuredLine, from: number, to: number): Position[] {
  const start = Math.max(0, Math.min(line.length, Math.min(from, to)));
  const end = Math.max(0, Math.min(line.length, Math.max(from, to)));

  const points: Position[] = [pointAt(line, start).position];
  for (let i = segmentAt(line, start) + 1; i < line.points.length; i += 1) {
    if ((line.measures[i] as number) >= end) break;
    points.push(line.points[i] as Position);
  }
  points.push(pointAt(line, end).position);
  return points;
}
