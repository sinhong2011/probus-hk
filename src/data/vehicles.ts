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
 * How many buses there are is not guessed either - the table's own shape says.
 * Each stop's soonest arrival is the nearest bus still behind it, so along the
 * route those times form one climbing curve per bus: the stops ahead of a bus
 * count up away from it, and the moment a stop reports *earlier* than the stop
 * before it, a nearer bus has passed the ones behind and a new curve has
 * begun. The number of climbing runs is the number of buses - the same count
 * the terminus's arrival list gives - and each bus stands just short of the
 * first stop of its run. This replaced chaining arrivals stop-by-stop against
 * a pace window: a pace estimated from straight-line chords is wrong exactly
 * where roads loop, and every window it broke minted a bus that did not exist.
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
 * A bus can run slower than the timetable without limit - traffic is traffic -
 * but faster only so far. Two neighbouring stops whose times climb by less
 * than this share of the running time describe a speed no bus has, which
 * means they describe two buses.
 */
const PACE_FLOOR = 0.35;

/**
 * Every operator here publishes arrival times rounded or jittered by up to a
 * minute: one bus forty-five seconds from one stop and fifteen from the next
 * prints the same time at both, and two adjacent stops computed independently
 * can even print a few seconds crossed. A bus cannot really reach the next
 * stop before this one, but its printed times can say so by seconds - so a
 * curve only "falls" when it falls by more than this window, and only then is
 * it a different bus.
 */
const ROUNDING_SECONDS = 60;

/** Nobody is reading a map with more buses than this on one route. */
const MAX_VEHICLES = 12;

/** An arrival that has just gone is worse than no arrival at all. */
const STALE_SECONDS = 60;

function segmentSeconds(ride: RideTime, toSeq: number): number {
  return Math.max(MIN_SEGMENT_SECONDS, ride(toSeq - 1, toSeq));
}

/** The soonest live arrival a stop reports: the bus nearest behind it. */
interface Soonest {
  seq: number;
  at: number;
  co: Company;
}

/**
 * The curve cut into buses.
 *
 * Walking the soonest-arrival times up the route, a new bus begins wherever
 * the curve stops describing the one before it: the time falls by more than
 * the rounding window (the stops behind now wait for a later bus), or it
 * climbs too little for the road between (a speed no bus has - see
 * `PACE_FLOOR`). Nothing else breaks a run: a stretch that climbs slowly is a
 * bus in traffic, however far off the timetable, and a stop that does not
 * report is simply stepped over - most routes have gaps, and Citybus is only
 * ever sampled.
 */
function runHeads(ride: RideTime, curve: Soonest[]): Soonest[] {
  const heads: Soonest[] = [];
  let previous: Soonest | null = null;

  for (const point of curve) {
    if (previous) {
      const expected = ride(previous.seq, point.seq);
      const fell = point.at < previous.at - ROUNDING_SECONDS * 1_000;
      const tooFast =
        point.at - previous.at < expected * PACE_FLOOR * 1_000 - ROUNDING_SECONDS * 1_000;
      if (fell || tooFast) heads.push(point);
    } else {
      heads.push(point);
    }
    previous = point;
  }

  return heads;
}

/**
 * A run's head turned into a place on the route.
 *
 * The head names the next stop the bus reaches and when. Walking that time
 * backwards a segment at a time is what lets a sampled route work: if the only
 * stop reporting is eight stops ahead, the bus is placed eight stops back, not
 * squashed against the one stop we happen to know about.
 *
 * The walk may only cross silence. A stop reporting live belongs to another
 * bus's curve, so this bus is past it; a stop whose only arrival - even a
 * timetabled one - is far later than this bus's own has no bus short of it
 * either, or it would say so. Blocked with more time in hand than the segment
 * holds, the bus is pinned at the stop it has just passed, which is the most
 * the table supports claiming. The A33 was the proof both ways round: chords
 * call the airport loop seventy seconds that the road takes five minutes, and
 * only what the table rules out keeps the arithmetic from walking a bus back
 * through a stop whose own row says fifty-three minutes.
 *
 * A bus whose next stop is the terminus it starts from is not placed at all.
 * That arrival is a departure time - the bus is in the depot or on the stand,
 * and there is no stretch of route to put it on. The same is true of a bus
 * walked all the way back to the start with time still in hand: the road back
 * to the terminus cannot hold its arrival, so it has not left yet, and
 * drawing it stacked buses on the first stop for every departure the feed
 * could see coming.
 */
function place(
  ride: RideTime,
  head: Soonest,
  stopCount: number,
  now: number,
  /** Stops that report live: another curve's territory, never crossed. */
  live: Set<number>,
  /** Earliest arrival the table holds per stop, any source. */
  reported: Map<number, number>,
): Vehicle | null {
  if (head.seq < 2 || head.seq > stopCount) return null;

  const total = Math.max(0, (head.at - now) / 1_000);
  let seq = head.seq;
  let remain = total;
  let segment = segmentSeconds(ride, seq);

  let blocked = false;
  while (seq > 2 && remain > segment) {
    if (live.has(seq - 1)) {
      blocked = true;
      break;
    }
    const earliest = reported.get(seq - 1);
    if (earliest !== undefined && earliest > head.at + ROUNDING_SECONDS * 1_000) {
      blocked = true;
      break;
    }
    remain -= segment;
    seq -= 1;
    segment = segmentSeconds(ride, seq);
  }

  // Off the start of the route with time to spare: a departure, not a bus.
  if (!blocked && seq === 2 && remain > segment + ROUNDING_SECONDS) return null;

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
  const floor = now - STALE_SECONDS * 1_000;
  /*
   * What the table says at all, not just what it says live - a stop whose only
   * arrival is a timetabled one an hour out is still a stop no tracked bus is
   * short of, and that is precisely the fact the placement walk needs. Only
   * live arrivals make buses; every arrival bounds where they can be.
   */
  const reported = new Map<number, number>();
  /** Per stop, its live arrivals soonest-first. */
  const liveAt = new Map<number, { at: number; co: Company }[]>();

  for (const [seq, etas] of table) {
    if (seq < 1 || seq > stopCount) continue;
    for (const eta of etas) {
      const at = eta.at.getTime();
      if (at < (reported.get(seq) ?? Infinity)) reported.set(seq, at);
      if (eta.source !== "live" || at < floor) continue;
      /*
       * The first stop's "arrival" is a departure time - the bus may still be
       * on the stand. Let into the curve it becomes the rearmost run's head,
       * and a head at the terminus is rightly dropped (see `place`) - but over
       * a short first segment the pace check cannot cut the run behind it, so
       * the drop took the whole run: the bus that stop 2's own imminent time
       * proved was already on the road vanished. The terminus still bounds
       * placements through `reported`; it just describes no bus.
       */
      if (seq === 1) continue;
      const list = liveAt.get(seq) ?? [];
      list.push({ at, co: eta.co });
      liveAt.set(seq, list);
    }
  }

  const curve: Soonest[] = [];
  for (const [seq, list] of liveAt) {
    list.sort((a, b) => a.at - b.at);
    const first = list[0];
    if (first) curve.push({ seq, at: first.at, co: first.co });
  }
  curve.sort((a, b) => a.seq - b.seq);

  const heads = runHeads(ride, curve);

  /*
   * Behind the rearmost curve the table is silent, so a further bus there can
   * only show as an extra arrival at the rearmost run's own head stop - which
   * is all a per-stop operator ever gives: one stop, three arrivals, three
   * buses strung back along the road at the pace between them. Anywhere else
   * a stop's later arrivals belong to buses that already own a curve of their
   * own, and reading them again drew every bus twice.
   */
  const rear = heads[0];
  if (rear) {
    for (const extra of (liveAt.get(rear.seq) ?? []).slice(1)) {
      heads.push({ seq: rear.seq, at: extra.at, co: extra.co });
    }
  }

  const liveStops = new Set(liveAt.keys());
  return heads
    .slice(0, MAX_VEHICLES)
    .flatMap((head) => {
      const placed = place(ride, head, stopCount, now, liveStops, reported);
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
