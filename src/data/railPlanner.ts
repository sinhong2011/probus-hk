import {
  RAIL_LINES,
  WALK_LINKS,
  interchangeMinutes,
  lineOf,
  rideMinutes,
  servicesAt,
  walkMinutes,
} from "./railTimes";

/**
 * Journeys across the railway, from one station to another.
 *
 * Built on the time table rather than the route database, because the
 * database has no times and the railway is small enough to search outright:
 * a dozen services, a hundred stations, two dozen places to change. A rider
 * gets on, rides to somewhere they can change or to where they are going,
 * and does that at most three times - the MTR's own planner goes no further,
 * and nor does anyone.
 */

export interface RailLeg {
  /** The service ridden: "TWL", or "TKL-LHP" for a LOHAS Park train. */
  service: string;
  /** Its line: what the plate and the colour say. */
  line: string;
  from: string;
  to: string;
  /** The terminus the train is headed for - how a platform is signed. */
  towards: string;
  /** Stations travelled. */
  stations: number;
  minutes: number;
}

export interface RailChange {
  /** Where the rider leaves the first train. */
  at: string;
  /** Where they board the next - the same station, unless it is a walk. */
  to: string;
  /** Minutes on foot between the two platforms. */
  minutes: number;
}

export interface RailJourney {
  id: string;
  legs: RailLeg[];
  /** One fewer than the legs; the change after each leg but the last. */
  changes: RailChange[];
  /**
   * Riding and changing, as the MTR itself states a journey: no wait for the
   * first train, none at a change - which is why it is printed with a tilde.
   */
  totalMinutes: number;
  /** The walking part of the changes alone - the number a rider dreads. */
  changeMinutes: number;
}

/** Nobody plans a rail journey with more changes than this. */
const MAX_CHANGES = 2;
/** Past this the journey is not a suggestion, it is a warning. */
const MAX_MINUTES = 150;
/** How much slower than the best a journey may be and still be worth a row. */
const SLACK_MINUTES = 20;
const MAX_RESULTS = 5;

/**
 * Whether changing onto `next` at `at` is a change anyone would make.
 *
 * Not if the line has been ridden already - riding away from a line and back
 * onto it is a detour, not a route - and not if the train being left could
 * have been boarded at the new train's... or the other way round: if the
 * new service already called at the station the last leg started from, the
 * last leg was a ride to nowhere, and if the old service goes on to where
 * the new leg ends, the change was for nothing. A branch train for its own
 * line's main train is the one exception: same code, different train.
 */
function sensible(legs: RailLeg[], next: string, to: string): boolean {
  const last = legs[legs.length - 1];
  if (!last) return true;
  const sameLine = lineOf(next) === last.line;
  if (sameLine && next === last.service) return false;
  if (!sameLine && legs.some((leg) => leg.line === lineOf(next))) return false;
  const calls = (service: string, station: string) => RAIL_LINES[service]?.includes(station);
  if (!sameLine && calls(next, last.from)) return false;
  if (!sameLine && calls(last.service, to)) return false;
  return true;
}

/** Stations where a rider can leave one train for another, by any means. */
const interchanges = new Set<string>();
for (const code of Object.keys(RAIL_LINES).flatMap((service) => RAIL_LINES[service] as string[])) {
  if (new Set(servicesAt(code)).size > 1) interchanges.add(code);
}
for (const link of WALK_LINKS) {
  interchanges.add(link.from);
  interchanges.add(link.to);
}

/** The other ends of the walking links at a station. */
function walksFrom(station: string): string[] {
  return WALK_LINKS.filter((l) => l.from === station || l.to === station).map((l) =>
    l.from === station ? l.to : l.from,
  );
}

/**
 * The Airport Express is a premium train, and nobody asking the way from
 * Kowloon to Hong Kong means it - the Tung Chung Line runs the same stretch
 * a minute slower for a tenth of the fare. It is ridden only to the stations
 * it alone serves.
 */
function premiumDetour(service: string, from: string, to: string): boolean {
  if (service !== "AEL") return false;
  const ordinary = RAIL_LINES.TCL as string[];
  return ordinary.includes(from) && ordinary.includes(to);
}

function ride(service: string, from: string, to: string): RailLeg | null {
  const stations = RAIL_LINES[service] as string[];
  const a = stations.indexOf(from);
  const b = stations.indexOf(to);
  if (a < 0 || b < 0 || a === b || premiumDetour(service, from, to)) return null;
  const minutes = rideMinutes(service, from, to);
  if (minutes === undefined) return null;
  return {
    service,
    line: lineOf(service),
    from,
    to,
    towards: (b > a ? stations[stations.length - 1] : stations[0]) as string,
    stations: Math.abs(b - a),
    minutes,
  };
}

function finish(legs: RailLeg[], changes: RailChange[]): RailJourney {
  const riding = legs.reduce((sum, leg) => sum + leg.minutes, 0);
  const changing = changes.reduce((sum, change) => sum + change.minutes, 0);
  return {
    id: legs.map((leg) => `${leg.service}:${leg.from}>${leg.to}`).join("|"),
    legs,
    changes,
    totalMinutes: riding + changing,
    changeMinutes: changing,
  };
}

/**
 * Every way from one station to another with at most two changes, best
 * first: quickest, and among equals the one with fewer changes. The first
 * is the suggestion; the rest are the alternatives a rider might prefer for
 * reasons a timetable cannot see - a seat, a platform they know.
 */
export function planRail(from: string, to: string): RailJourney[] {
  if (from === to || (!interchanges.has(from) && servicesAt(from).length === 0)) return [];
  if (servicesAt(to).length === 0 && walksFrom(to).length === 0) return [];

  const found: RailJourney[] = [];

  const search = (
    at: string,
    legs: RailLeg[],
    changes: RailChange[],
    visited: Set<string>,
    minutes: number,
  ) => {
    for (const service of servicesAt(at)) {
      const stations = RAIL_LINES[service] as string[];
      const here = stations.indexOf(at);
      for (let step = -1; step <= 1; step += 2) {
        for (let i = here + step; i >= 0 && i < stations.length; i += step) {
          const stop = stations[i] as string;
          if (visited.has(stop)) continue;
          const leg = ride(service, at, stop);
          if (!leg || !sensible(legs, service, stop)) continue;
          const sofar = minutes + leg.minutes;
          if (sofar > MAX_MINUTES) break;

          if (stop === to) {
            found.push(finish([...legs, leg], changes));
            continue;
          }
          if (legs.length > MAX_CHANGES - 1 || !interchanges.has(stop)) continue;

          const seen = new Set(visited);
          for (let j = here; j !== i + step; j += step) seen.add(stations[j] as string);

          // Change here, onto another service...
          for (const next of servicesAt(stop)) {
            if (next === service) continue;
            const cost = interchangeMinutes(stop, service, next);
            if (cost === undefined) continue;
            search(
              stop,
              [...legs, leg],
              [...changes, { at: stop, to: stop, minutes: cost }],
              seen,
              sofar + cost,
            );
          }
          // ...or walk to the station next door and change there.
          for (const across of walksFrom(stop)) {
            if (visited.has(across)) continue;
            const cost = walkMinutes(stop, across) as number;
            if (across === to) {
              found.push(
                finish([...legs, leg], [...changes, { at: stop, to: across, minutes: cost }]),
              );
              continue;
            }
            search(
              across,
              [...legs, leg],
              [...changes, { at: stop, to: across, minutes: cost }],
              new Set([...seen, across]),
              sofar + cost,
            );
          }
        }
      }
    }
  };

  search(from, [], [], new Set([from]), 0);

  /*
   * The same legs can be found by more than one path; and a journey that
   * changes twice to save a minute over one that changes once is not a
   * suggestion anyone would make. One row per set of legs, quickest first,
   * and nothing slower than the best by more than a coffee.
   */
  const seen = new Set<string>();
  const unique = found
    .filter((j) => (seen.has(j.id) ? false : seen.add(j.id)))
    .sort((a, b) => a.totalMinutes - b.totalMinutes || a.legs.length - b.legs.length);
  const best = unique[0]?.totalMinutes ?? 0;
  return unique.filter((j) => j.totalMinutes <= best + SLACK_MINUTES).slice(0, MAX_RESULTS);
}
