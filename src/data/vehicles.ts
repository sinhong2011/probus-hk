import { pacedBySchedule, type RideTime } from "./pace";
import type { Company, Eta, KeyedRoute } from "./types";

/**
 * Where the buses are, worked backwards out of the arrival times.
 *
 * No operator here publishes a vehicle feed a browser can reach, so nothing in
 * this file is a position report. What it has instead is the other half of the
 * same fact: an ETA is a position statement told backwards. A bus due at stop
 * 12 in three minutes is three minutes of road behind stop 12, and three
 * minutes of road is a distance once you know how fast the route runs there.
 *
 * Everything here is geometry-free on purpose. A vehicle is placed in stop
 * space - "on the way to stop 12, four fifths of the way there" - and only the
 * map turns that into a coordinate. That keeps the inference testable without
 * a map, and keeps the two kinds of error apart: a wrong ETA is this file's
 * fault, a bus in the harbour is the line's.
 */

export interface Vehicle {
  /** Kept stable between polls so the marker moves instead of jumping. */
  id: string;
  co: Company;
  /** 1-based stop this bus reaches next. */
  nextSeq: number;
  /** When it is due there. Absolute, so the position is a function of the clock. */
  at: Date;
  /** How long this bus takes over the segment it is on. Never zero. */
  segSeconds: number;
  /** How wrong the placement could be, in seconds of running. */
  spreadSeconds: number;
}

/** Arrivals for one route, keyed by 1-based stop position. */
export type EtaTable = Map<number, Eta[]>;

/** A segment nobody could cross in less than this is a data error, not a bus. */
const MIN_SEGMENT_SECONDS = 20;

/**
 * How far off the timetable's pace a real bus is allowed to be while still
 * being recognised as the same bus at the next stop. Traffic makes buses slow
 * far more often than fast, which is why the window is lopsided.
 */
const PACE_FLOOR = 0.35;
const PACE_CEILING = 2.5;
/** Plus a flat allowance, because a short hop's percentage is worth seconds. */
const PACE_SLACK_SECONDS = 90;

/**
 * Every operator here publishes arrival times rounded to the minute, so one bus
 * forty-five seconds from one stop and fifteen from the next prints the same
 * time at both. Requiring the next stop to be later by some share of the
 * running time is therefore wrong by up to a whole minute, and that minute is
 * the difference between recognising a bus and inventing a second one: the
 * chain breaks, the leftovers start a chain of their own, and the same vehicle
 * is drawn twice, a stop apart.
 *
 * Two stops may report the same minute. What they may never do is go backwards
 * - a bus cannot reach the next stop before this one - so equality is allowed
 * and nothing earlier is.
 */
const ROUNDING_SECONDS = 60;

/** Nobody is reading a map with more buses than this on one route. */
const MAX_VEHICLES = 12;

/** An arrival that has just gone is worse than no arrival at all. */
const STALE_SECONDS = 60;

function segmentSeconds(ride: RideTime, toSeq: number): number {
  return Math.max(MIN_SEGMENT_SECONDS, ride(toSeq - 1, toSeq));
}

interface Slot {
  seq: number;
  at: number;
  co: Company;
  used: boolean;
}

/**
 * The arrivals grouped into buses.
 *
 * One bus shows up once at every stop ahead of it, at times that climb as the
 * stops do; a route with three buses on it publishes three such climbing runs,
 * interleaved. Chaining them apart is what turns a column of numbers into
 * vehicles.
 *
 * The earliest unclaimed arrival always starts the next chain, so the bus
 * nearest to arriving somewhere is resolved first and takes its own arrivals
 * with it. Stops that do not report simply get stepped over - most routes have
 * gaps, and Citybus is only ever sampled.
 */
function chainTrips(ride: RideTime, slots: Slot[]): Slot[][] {
  const seqs = [...new Set(slots.map((s) => s.seq))].sort((a, b) => a - b);
  const bySeq = new Map<number, Slot[]>();
  for (const seq of seqs) {
    bySeq.set(
      seq,
      slots.filter((s) => s.seq === seq).sort((a, b) => a.at - b.at),
    );
  }

  const trips: Slot[][] = [];

  while (trips.length < MAX_VEHICLES) {
    let head: Slot | undefined;
    for (const slot of slots) {
      if (!slot.used && (!head || slot.at < head.at)) head = slot;
    }
    if (!head) break;

    head.used = true;
    const trip = [head];
    let previous = head;

    for (const seq of seqs) {
      if (seq <= previous.seq) continue;

      const expected = ride(previous.seq, seq);
      const earliest =
        previous.at + Math.max(0, expected * PACE_FLOOR * 1_000 - ROUNDING_SECONDS * 1_000);
      const latest = previous.at + expected * PACE_CEILING * 1_000 + PACE_SLACK_SECONDS * 1_000;

      const match = (bySeq.get(seq) ?? []).find(
        (slot) => !slot.used && slot.at >= earliest && slot.at <= latest,
      );
      // No plausible arrival here: this bus was not reported at this stop,
      // which says nothing about whether it will pass it.
      if (!match) continue;

      match.used = true;
      trip.push(match);
      previous = match;
    }

    trips.push(trip);
  }

  return trips;
}

/**
 * A chain's head turned into a place on the route.
 *
 * The head arrival names the next stop the bus reaches and when. Walking that
 * time backwards a segment at a time is what lets a sampled route work: if the
 * only stop reporting is eight stops ahead, the bus is placed eight stops back,
 * not squashed against the one stop we happen to know about.
 *
 * A bus whose next stop is the terminus it starts from is not placed at all.
 * That arrival is a departure time - the bus is in the depot or on the stand,
 * and there is no stretch of route to put it on.
 */
function place(ride: RideTime, head: Slot, stopCount: number, now: number): Vehicle | null {
  if (head.seq < 2 || head.seq > stopCount) return null;

  const total = Math.max(0, (head.at - now) / 1_000);
  let seq = head.seq;
  let remain = total;
  let segment = segmentSeconds(ride, seq);

  while (seq > 2 && remain > segment) {
    remain -= segment;
    seq -= 1;
    segment = segmentSeconds(ride, seq);
  }

  return {
    // Replaced by `trackVehicles`, which is the only thing that can know
    // whether this bus is one it has seen before.
    id: "",
    co: head.co,
    nextSeq: seq,
    // Synthetic once the walk has stepped back past the reported stop: it is
    // when this bus would reach *this* stop at the route's own pace.
    at: new Date(now + remain * 1_000),
    segSeconds: segment,
    /*
     * Confidence decays with how much of the estimate is inference. Right
     * behind a reporting stop the operator has all but drawn the bus for us;
     * ten minutes back, the pace between here and there is a guess about
     * traffic, so the band grows to say so.
     */
    spreadSeconds: Math.min(240, 15 + total * 0.2),
  };
}

/**
 * The buses on a route, from its arrival table.
 *
 * Only live arrivals count. A timetable-derived ETA is a statement about a
 * schedule, not about a bus, and drawing one on a map would invent a vehicle
 * that may not have left the depot.
 */
export function inferVehicles(
  route: KeyedRoute,
  table: EtaTable,
  stopCount: number,
  now = Date.now(),
  /**
   * How long the bus takes between two stops. Injected because the good answer
   * needs to know how far apart they are, which is not something this file is
   * allowed to know - see `./pace`.
   */
  ride: RideTime = pacedBySchedule(route),
): Vehicle[] {
  const slots: Slot[] = [];
  const floor = now - STALE_SECONDS * 1_000;

  for (const [seq, etas] of table) {
    if (seq < 1 || seq > stopCount) continue;
    for (const eta of etas) {
      if (eta.source !== "live") continue;
      const at = eta.at.getTime();
      if (at < floor) continue;
      slots.push({ seq, at, co: eta.co, used: false });
    }
  }

  return chainTrips(ride, slots)
    .flatMap((trip) => {
      const head = trip[0];
      const placed = head ? place(ride, head, stopCount, now) : null;
      return placed ? [placed] : [];
    })
    .sort((a, b) => progressOf(a, now) - progressOf(b, now));
}

/**
 * How far along the route a bus is, in stops - 11.8 is four fifths of the way
 * from stop 11 to stop 12. One number, so two placements can be compared.
 */
export function progressOf(vehicle: Vehicle, now: number): number {
  const remain = (vehicle.at.getTime() - now) / 1_000;
  const fraction = 1 - remain / vehicle.segSeconds;
  return vehicle.nextSeq - 1 + Math.max(0, Math.min(1, fraction));
}

/** How near two placements must be to be believed the same bus, in stops. */
const SAME_BUS_STOPS = 2.5;

let minted = 0;

/**
 * Carries identity across a poll.
 *
 * Nothing in the feed names a vehicle, so identity has to be recovered from
 * position: a bus that was four fifths of the way to stop 12 twenty seconds
 * ago is the bus that is now just past it. Matching nearest-first is wrong the
 * moment one bus overtakes another inside a single poll, which on a bus route
 * is rare enough to be worth the trade - and the cost of being wrong is a
 * marker that slides instead of one that fades, not a wrong bus.
 *
 * Identity is what makes the marker move at all. Without it every poll is a
 * fresh set of buses, and a fresh set of buses can only appear, never travel.
 */
export function trackVehicles(previous: Vehicle[], next: Vehicle[], now = Date.now()): Vehicle[] {
  const free = previous.map((vehicle) => ({ vehicle, taken: false }));

  return next.map((vehicle) => {
    const here = progressOf(vehicle, now);
    let best: (typeof free)[number] | undefined;
    let bestGap = SAME_BUS_STOPS;

    for (const candidate of free) {
      if (candidate.taken || candidate.vehicle.co !== vehicle.co) continue;
      const gap = Math.abs(progressOf(candidate.vehicle, now) - here);
      if (gap <= bestGap) {
        bestGap = gap;
        best = candidate;
      }
    }

    if (best) {
      best.taken = true;
      return { ...vehicle, id: best.vehicle.id };
    }

    minted += 1;
    return { ...vehicle, id: `bus-${minted}` };
  });
}
