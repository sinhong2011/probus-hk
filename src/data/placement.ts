import { TRUST_METRES, type StopMeasures } from "~/lib/alongLine";
import type { Vehicle } from "./vehicles";

/**
 * A vehicle plus a measured line, turned into a distance along that line.
 *
 * The two halves are kept apart on purpose - the inference in `./vehicles`
 * knows nothing about geometry, and the geometry in `~/lib/alongLine` knows
 * nothing about buses - so this is the seam where they meet, and the only
 * place that has to hold both ideas at once.
 *
 * Everything here is a function of the clock. That is what lets a marker creep
 * between polls instead of standing still for twenty seconds and then jumping,
 * and it is why none of it keeps state.
 */

/**
 * The stretch of line the bus is currently on, or `null` when this particular
 * stretch cannot carry it.
 *
 * Trust is per stop rather than per route: geometry that runs out before the
 * last two stops of a campus route is still the right line for the other
 * forty, and the buses on those should be drawn. A bus approaching a stop the
 * line does not reach is not drawn at all - better a gap at the end of a route
 * than a bus in the wrong car park.
 */
function segmentOf(vehicle: Vehicle, track: StopMeasures) {
  const to = track.measures[vehicle.nextSeq - 1];
  const from = track.measures[vehicle.nextSeq - 2];
  if (to === undefined || from === undefined) return null;

  const near = (index: number) => (track.offsets[index] ?? 0) <= TRUST_METRES;
  if (!near(vehicle.nextSeq - 1) || !near(vehicle.nextSeq - 2)) return null;

  return { from, to };
}

/**
 * How far past its due time a bus is still carried forward.
 *
 * An arrival time that has gone by does not mean the bus stopped there: it
 * means the operator's last word about it has expired. Pinning the marker to
 * the stop until the next poll agrees froze it there for as long as the feed
 * kept repeating that stop - which, with times published to the minute, is up
 * to two minutes of a bus that has plainly gone. So it keeps rolling at the
 * pace it was doing, for about as long as a bus takes to pull in and pull out,
 * and no further than the next stop it has not been reported at.
 */
const OVERDUE_SECONDS = 75;

/**
 * Where the bus is, in metres along the line, or `null` when the line cannot
 * place it.
 */
export function measureOf(vehicle: Vehicle, track: StopMeasures, now: number): number | null {
  const segment = segmentOf(vehicle, track);
  if (!segment) return null;

  const remain = (vehicle.at.getTime() - now) / 1_000;
  const span = segment.to - segment.from;

  if (remain >= 0) {
    // Approaching: the share of the segment already covered.
    const fraction = Math.max(0, Math.min(1, 1 - remain / vehicle.segSeconds));
    return segment.from + span * fraction;
  }

  // Past due: keep going at the pace it was keeping, but not past the stop
  // beyond - it has told us nothing about reaching that one yet.
  const pace = span / vehicle.segSeconds;
  const beyond = Math.min(-remain, OVERDUE_SECONDS) * pace;
  const next = track.measures[vehicle.nextSeq];
  return next === undefined ? segment.to : Math.min(segment.to + beyond, next);
}

/** Never narrower than a bus, never so wide it stops meaning anything. */
const BAND_MIN = 30;
const BAND_MAX = 800;

/**
 * How long the uncertainty band is, in metres of road.
 *
 * The estimate is uncertain in seconds - how long this bus takes to cover
 * ground it has not covered yet - so the band is those seconds run through the
 * pace of the stretch it is on. It is longest where the guess is weakest, which
 * is the whole point: a rider learns in one glance that a fat smear means
 * roughly here and a tight one means about there.
 *
 * Once an arrival is overdue the band grows with every second of it, because
 * every one of those seconds is extrapolation rather than anything the
 * operator said.
 */
export function spreadMetres(vehicle: Vehicle, track: StopMeasures, now: number): number {
  const segment = segmentOf(vehicle, track);
  if (!segment) return BAND_MIN;

  const overdue = Math.max(0, (now - vehicle.at.getTime()) / 1_000);
  const pace = (segment.to - segment.from) / vehicle.segSeconds;
  const metres = (vehicle.spreadSeconds + Math.min(overdue, OVERDUE_SECONDS)) * pace;
  return Math.max(BAND_MIN, Math.min(BAND_MAX, metres));
}
