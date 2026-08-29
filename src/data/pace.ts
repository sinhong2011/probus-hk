import { distanceM, type LatLng } from "~/lib/geo";
import { rideSeconds } from "./schedule";
import type { KeyedRoute } from "./types";
import type { EtaTable } from "./vehicles";

/**
 * How long a bus takes between two stops of a route.
 *
 * Passed in rather than looked up, so the inference in `./vehicles` can answer
 * "which bus, heading where" without knowing anything about the road, and the
 * quality of the answer can be improved here without touching it.
 */
export type RideTime = (fromSeq: number, toSeq: number) => number;

/**
 * What the route database gives us: one journey time for the whole route,
 * shared out evenly over the stops.
 *
 * Kept as the fallback, and only as the fallback. Spreading by stop count says
 * a bus takes as long over eighty metres of Tsing Yi as over the mile of
 * highway before Mei Foo - on route 42 that is 3 km/h on one segment and 52 on
 * another, which is not a bus, it is an artefact.
 */
export function pacedBySchedule(route: KeyedRoute): RideTime {
  return (from, to) => rideSeconds(route, from, to);
}

/** A stop is not a point a bus flies through; it is a door opening. */
const DWELL_SECONDS = 15;

/**
 * The same journey time, shared out by how far apart the stops actually are.
 *
 * Two things happen on a segment: the bus drives it, and the bus stops at the
 * end of it. The driving is proportional to distance; the stopping is not, and
 * on a route whose stops are eighty metres apart it is most of the time spent.
 * So the journey time is split - a flat allowance per stop, and the rest shared
 * out by metres - which is the standard way of modelling a bus route and the
 * cheapest thing that stops the marker crawling and racing by turns.
 *
 * Straight lines between stops rather than distance along the road: the road
 * geometry lives with the map, arrives later than this does, and is sometimes
 * not trusted at all. The chord is shorter than the road by a fairly steady
 * factor, and what matters here is the ratio between segments, which survives
 * it. Getting the ratio right is the whole of the improvement; the last ten
 * per cent of the length is not.
 */
export function pacedByDistance(route: KeyedRoute, stops: LatLng[]): RideTime {
  const count = stops.length;
  if (count < 2) return pacedBySchedule(route);

  /** Metres from the first stop to each stop, in stop order. */
  const along: number[] = [0];
  for (let i = 1; i < count; i += 1) {
    const previous = stops[i - 1];
    const stop = stops[i];
    const step = previous && stop ? distanceM(previous, stop) : 0;
    along.push((along[i - 1] as number) + step);
  }

  const total = along[count - 1] as number;
  // Stops all in one place, or no geometry worth the name: nothing to weight by.
  if (total <= 0) return pacedBySchedule(route);

  const journey = rideSeconds(route, 1, count);
  if (journey <= 0) return pacedBySchedule(route);

  /*
   * Dwell is capped at half the journey. A frequent route with forty closely
   * spaced stops can otherwise spend its whole published time standing still,
   * leaving nothing to drive with and every bus pinned between doors.
   */
  const dwell = Math.min(DWELL_SECONDS, (journey * 0.5) / Math.max(1, count - 1));
  const driving = journey - dwell * (count - 1);

  return (from, to) => {
    const start = along[Math.max(0, Math.min(count - 1, from - 1))];
    const end = along[Math.max(0, Math.min(count - 1, to - 1))];
    if (start === undefined || end === undefined) return 0;

    const metres = Math.max(0, end - start);
    const stopsPassed = Math.max(0, to - from);
    return (metres / total) * driving + dwell * stopsPassed;
  };
}

/**
 * How far from the timetable a stretch of road is allowed to be found to be.
 *
 * Outside this the arithmetic has gone wrong rather than the traffic: two
 * arrivals that are not the same bus, a terminus layover counted as running
 * time, a feed repeating itself.
 */
const SLOWEST = 3;
const FASTEST = 0.4;

/** A run of consecutive stops one bus is due at, and when. */
interface Run {
  from: number;
  to: number;
  seconds: number;
}

/**
 * The runs the feed describes: for each arrival position, the longest stretch
 * of consecutive stops it appears at, and the time it claims to take over it.
 *
 * Pairing by position rather than by chaining the trips properly is deliberate:
 * the first arrival at every stop is the same bus for as long as it has not
 * passed any of them, which is exactly the stretch this is measuring, and the
 * plausibility check below throws out the stretch where that stops being true.
 */
function runsFrom(table: EtaTable, stopCount: number): Run[] {
  const runs: Run[] = [];

  for (let index = 0; index < 3; index += 1) {
    let start: { seq: number; at: number } | null = null;
    let last: { seq: number; at: number } | null = null;

    for (let seq = 1; seq <= stopCount + 1; seq += 1) {
      const eta = table.get(seq)?.filter((e) => e.source === "live")[index];
      const here = eta ? { seq, at: eta.at.getTime() } : null;

      // A gap, the end of the route, or an arrival earlier than the one before
      // it - which is a different bus, not a bus going backwards.
      const breaks = !here || !last || here.seq !== last.seq + 1 || here.at < last.at;
      if (breaks) {
        if (start && last && last.seq > start.seq) {
          runs.push({ from: start.seq, to: last.seq, seconds: (last.at - start.at) / 1_000 });
        }
        start = here;
      }
      last = here;
    }
  }

  return runs;
}

/**
 * The timetable, corrected by what the operator is saying right now.
 *
 * A published journey time is an average over a year. The arrivals in front of
 * us are this afternoon: the gap between one bus's time at stop 20 and its time
 * at stop 30 *is* the running time over those ten stops, as the operator
 * currently believes it, traffic and all. So the shape of the route comes from
 * the distances and the scale comes from the feed - each stretch stretched or
 * squeezed by how far off the timetable it is actually running.
 *
 * Measuring a whole stretch rather than one segment at a time is what makes
 * this survive the data: arrivals are published to the minute, so a single
 * hop between two stops eighty metres apart reads as either zero or sixty
 * seconds and neither is a speed. Ten stops of it is minutes long, and the
 * rounding stops mattering.
 *
 * Nothing is stored. It was tempting to learn these over days and key them by
 * hour, but a poll already carries the whole picture and does it without a
 * cache that can go stale, disagree with the feed, or have to be invalidated.
 */
export function pacedByFeed(base: RideTime, table: EtaTable, stopCount: number): RideTime {
  /** Timetable seconds for the segment ending at each stop. */
  const modelled: number[] = [0, 0];
  for (let seq = 2; seq <= stopCount; seq += 1) modelled.push(base(seq - 1, seq));

  const factors: number[][] = [];
  let observedTotal = 0;
  let modelledTotal = 0;

  for (const run of runsFrom(table, stopCount)) {
    let span = 0;
    for (let seq = run.from + 1; seq <= run.to; seq += 1) span += modelled[seq] ?? 0;
    if (span <= 0 || run.seconds <= 0) continue;

    const factor = run.seconds / span;
    if (factor < FASTEST || factor > SLOWEST) continue;

    observedTotal += run.seconds;
    modelledTotal += span;
    for (let seq = run.from + 1; seq <= run.to; seq += 1) (factors[seq] ??= []).push(factor);
  }

  /** What the route as a whole is running at, for the stretches nobody covers. */
  const overall = modelledTotal > 0 ? observedTotal / modelledTotal : 1;

  const scale = (seq: number) => {
    const seen = factors[seq];
    if (!seen || seen.length === 0) return overall;
    return seen.reduce((sum, f) => sum + f, 0) / seen.length;
  };

  return (from, to) => {
    let seconds = 0;
    for (let seq = from + 1; seq <= to; seq += 1) seconds += (modelled[seq] ?? 0) * scale(seq);
    return seconds;
  };
}
