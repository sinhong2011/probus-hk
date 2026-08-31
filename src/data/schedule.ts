import type { Eta, KeyedRoute, RouteDb } from "./types";
import { hkDateKey, hkInstant, hkNow, parseHhmm, type HkDateParts } from "~/lib/hkTime";

/** How far ahead a timetable is worth projecting. */
const WINDOW_MINUTES = 120;
/** Used when a route carries no journey time of its own. */
const FALLBACK_MINUTES_PER_STOP = 2;

function activeServiceIds(db: RouteDb, parts: HkDateParts): Set<string> {
  // Public holidays run the Sunday timetable, which is index 0 of the flags.
  const isHoliday = db.holidays.includes(hkDateKey(parts));
  const index = isHoliday ? 0 : parts.weekday;

  const ids = new Set<string>();
  for (const id in db.serviceDayMap) {
    if (db.serviceDayMap[id]?.[index] === "1") ids.add(id);
  }
  return ids;
}

function shiftDay(parts: HkDateParts, days: number): HkDateParts {
  const d = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    weekday: d.getUTCDay(),
    minutesSinceMidnight: parts.minutesSinceMidnight,
  };
}

/**
 * Minutes from the first stop to stop `seq`. The database only records a
 * whole-journey time, so this spreads it evenly - good enough to order a list
 * and honest about being an estimate, which is why it is never labelled live.
 */
function travelMinutes(route: KeyedRoute, seq: number): number {
  const stops = route.stops[route.co[0] as keyof typeof route.stops];
  const count = stops?.length ?? 0;
  if (seq <= 1 || count <= 1) return 0;

  const total = route.jt ? Number(route.jt) : count * FALLBACK_MINUTES_PER_STOP;
  if (!Number.isFinite(total)) return 0;
  return (total * (seq - 1)) / (count - 1);
}

/**
 * End to end, in minutes - how long a bus that has just left is still running.
 *
 * The same estimate `travelMinutes` makes for any stop, asked for the last one,
 * so a route with no published journey time falls back the same way rather than
 * counting as arriving the instant it departs.
 */
function journeyMinutes(route: KeyedRoute): number {
  const stops = route.stops[route.co[0] as keyof typeof route.stops];
  return travelMinutes(route, stops?.length ?? 0);
}

/**
 * Minutes on the bus between two stops of a route.
 *
 * The database publishes one journey time for the whole route, so this is that
 * time shared out over the stops - an estimate, and labelled as one wherever it
 * is shown. It is still the number a rider wants when choosing where to get
 * off: nobody rides a route end to end and reads the total.
 */
export function rideMinutes(route: KeyedRoute, fromSeq: number, toSeq: number): number {
  return Math.round(rideSeconds(route, fromSeq, toSeq) / 60);
}

/**
 * The same estimate unrounded, in seconds.
 *
 * Placing a bus between two stops divides by this, and a single hop of a
 * frequent route rounds to zero minutes - which is a division by zero, not a
 * fast bus. Nothing is shown to a rider in seconds; this is arithmetic.
 */
export function rideSeconds(route: KeyedRoute, fromSeq: number, toSeq: number): number {
  return Math.max(0, (travelMinutes(route, toSeq) - travelMinutes(route, fromSeq)) * 60);
}

/** Departure times (minutes since that day's midnight) inside the window. */
function departuresInWindow(
  freq: NonNullable<KeyedRoute["freq"]>,
  serviceIds: Set<string>,
  from: number,
  to: number,
): number[] {
  const out: number[] = [];

  for (const serviceId in freq) {
    if (!serviceIds.has(serviceId)) continue;
    const bands = freq[serviceId];
    if (!bands) continue;

    for (const startText in bands) {
      const start = parseHhmm(startText);
      if (start === null) continue;

      const band = bands[startText];
      if (!band) {
        // A fixed departure rather than a headway band (ferries, some minibus).
        if (start >= from && start <= to) out.push(start);
        continue;
      }

      const end = parseHhmm(band[0]);
      const headwayMin = Number(band[1]) / 60;
      if (end === null || !Number.isFinite(headwayMin) || headwayMin <= 0) continue;

      // Jump straight to the first departure at or after the window opens.
      const skip = from > start ? Math.ceil((from - start) / headwayMin) : 0;
      for (let t = start + skip * headwayMin; t <= Math.min(end, to); t += headwayMin) {
        out.push(t);
      }
    }
  }
  return out;
}

/**
 * Timetable-derived arrivals, used where an operator publishes no live feed at
 * all (the ferries) and as a fallback when a live feed returns nothing.
 *
 * These are always tagged `scheduled` so the UI can present them differently -
 * conflating a timetable with a real prediction is the thing that makes transit
 * apps untrustworthy.
 */
export function scheduledEta(db: RouteDb, route: KeyedRoute, seq: number, limit = 3): Eta[] {
  if (!route.freq) return [];

  const now = hkNow();
  const offset = travelMinutes(route, seq);
  const nowAtStop = now.minutesSinceMidnight;

  const results: Eta[] = [];

  // Evaluate yesterday too: bands are written like "2310" -> "2620", so a
  // service that began last night can still be running after midnight.
  for (const days of [-1, 0] as const) {
    const day = shiftDay(now, days);
    const ids = activeServiceIds(db, day);
    // Window expressed in that day's own clock.
    const shift = days * -1440;
    const from = nowAtStop - offset + shift;
    const to = from + WINDOW_MINUTES;

    for (const departure of departuresInWindow(route.freq, ids, from, to)) {
      const at = hkInstant(day, departure + offset);
      if (at.getTime() > Date.now()) {
        results.push({ at, source: "scheduled", co: route.co[0] ?? "kmb" });
      }
    }
  }

  return results.sort((a, b) => a.at.getTime() - b.at.getTime()).slice(0, limit);
}

/**
 * Is this route running at this moment?
 *
 * Used to keep a planner from proposing an overnight route in the evening or a
 * racecourse special on a Tuesday. A route that publishes no timetable returns
 * true: absence of data is not evidence that it is not running, and hiding a
 * real route is worse than listing one that turns out to be finished.
 */
export function isRunningNow(db: RouteDb, route: KeyedRoute): boolean {
  if (!route.freq) return true;

  const now = hkNow();

  // Check today and yesterday: a band written 2310 -> 2620 is still running at
  // 01:00, but belongs to yesterday's service.
  for (const days of [-1, 0] as const) {
    const day = shiftDay(now, days);
    const ids = activeServiceIds(db, day);
    const minutes = now.minutesSinceMidnight + days * -1440;

    for (const serviceId in route.freq) {
      if (!ids.has(serviceId)) continue;
      const bands = route.freq[serviceId];
      if (!bands) continue;

      for (const startText in bands) {
        const start = parseHhmm(startText);
        if (start === null) continue;

        const band = bands[startText];
        // A fixed departure counts as "running" around its time.
        const end = band ? parseHhmm(band[0]) : start + 30;
        if (end === null) continue;
        if (minutes >= start && minutes <= end) return true;
      }
    }
  }
  return false;
}

/** One published frequency band, already in wall-clock text. */
export interface TimetableBand {
  from: string;
  to: string;
  /** Minutes between departures, or null for a single fixed departure. */
  headwayMin: number | null;
}

/** Bands that share a service pattern, keyed by that pattern's day flags. */
export interface TimetableGroup {
  /** Seven flags, Sunday first, "1" on days this group runs. */
  flags: string;
  bands: TimetableBand[];
}

function hhmm(minutes: number): string {
  // Bands run past midnight (2610 = 02:10 the next morning); wrap for display.
  const m = ((minutes % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/**
 * The route's published timetable, grouped by which days each pattern runs.
 *
 * The database keeps one entry per service id, and several ids routinely share
 * the same weekday pattern, so they are merged here - a rider wants "平日" once,
 * not the same hours listed three times under ids they cannot see.
 */
export function routeTimetable(db: RouteDb, route: KeyedRoute): TimetableGroup[] {
  if (!route.freq) return [];

  const byFlags = new Map<string, TimetableBand[]>();

  for (const serviceId in route.freq) {
    const flags = db.serviceDayMap[serviceId]?.join("") ?? "";
    if (!flags) continue;

    const bands = route.freq[serviceId];
    if (!bands) continue;

    const list = byFlags.get(flags) ?? [];
    for (const startText in bands) {
      const start = parseHhmm(startText);
      if (start === null) continue;

      const band = bands[startText];
      const end = band ? parseHhmm(band[0]) : null;
      const headwaySec = band ? Number(band[1]) : NaN;

      list.push({
        from: hhmm(start),
        to: end === null ? hhmm(start) : hhmm(end),
        headwayMin: Number.isFinite(headwaySec) && headwaySec > 0 ? headwaySec / 60 : null,
      });
    }
    byFlags.set(flags, list);
  }

  return (
    [...byFlags.entries()]
      .map(([flags, bands]) => ({
        flags,
        bands: bands.sort((a, b) => a.from.localeCompare(b.from)),
      }))
      .filter((group) => group.bands.length > 0)
      // Everyday patterns first, then the ones covering the most days.
      .sort((a, b) => b.flags.split("1").length - a.flags.split("1").length)
  );
}

/**
 * When the route starts and stops on the pattern running today, and how long
 * is left before the last one goes.
 *
 * A railway is read this way - "尾班車 00:48" is the fact a rider needs at
 * midnight - and the bands already carry it; nothing showed the two ends.
 * Returns `null` where the database publishes no timetable for the route.
 *
 * After midnight the operative day is yesterday's: a service written 23:10 ->
 * 02:20 is still the one running at one in the morning, and telling that rider
 * about tonight's last bus - twenty-two hours away - would be answering a
 * question nobody asked.
 *
 * And yesterday's day is not over at its last *departure*. A route whose last
 * one leaves at 23:40 and takes an hour is still carrying people at half past
 * midnight; asked then, this used to answer with today's span, which had the
 * screen saying "no service now, first at 05:35" over a bus that had not
 * reached its terminus yet. The day ends when the last one arrives.
 */
export function serviceSpan(
  db: RouteDb,
  route: KeyedRoute,
): { first: string; last: string; untilFirst: number; untilLast: number } | null {
  if (!route.freq) return null;

  const now = hkNow();
  const today = spanOfDay(db, route, now);
  // Expressed in today's clock, so yesterday's overnight tail is comparable.
  const yesterday = spanOfDay(db, route, shiftDay(now, -1));
  const overnight = yesterday
    ? { first: yesterday.first - 1440, last: yesterday.last - 1440 }
    : null;

  // How long the last one is still on the road after it leaves.
  const tail = journeyMinutes(route);
  const span = overnight && overnight.last + tail >= now.minutesSinceMidnight ? overnight : today;
  if (!span) return null;

  return {
    first: hhmm(span.first),
    last: hhmm(span.last),
    // Positive before the day's first departure - the small hours, when the
    // useful fact is when service resumes rather than when it stopped.
    untilFirst: span.first - now.minutesSinceMidnight,
    untilLast: span.last - now.minutesSinceMidnight,
  };
}

/**
 * Has the day's last one already left?
 *
 * "暫無班次" and "尾班車已過" are the same silence and different news: the
 * first is a wait, the second is a taxi. Nothing in an empty feed tells the
 * two apart - the timetable does.
 *
 * The line is drawn at the last *departure*, not at the moment that bus would
 * reach a particular stop. The evenly-spread estimate is not good enough to
 * promise anybody a ride on one specific vehicle: if it is genuinely still
 * coming, the operator's feed says so, and a stop with a live answer shows the
 * live answer whatever this returns. A stop with no answer after the last one
 * has set off is a stop where the honest reading of the silence is that
 * nothing is coming - and being wrong the other way strands somebody at a
 * kerb at one in the morning.
 *
 * Before the day's first departure the answer is yes as well: last night's run
 * has finished and nothing is coming until the morning.
 *
 * A route with no published timetable answers no - silence about a route is
 * not evidence that its day is over.
 */
export function lastRunGone(db: RouteDb, route: KeyedRoute): boolean {
  const span = serviceSpan(db, route);
  if (!span) return false;
  return span.untilFirst > 0 || span.untilLast < 0;
}

/** The ends of one service day, in that day's own clock. */
function spanOfDay(
  db: RouteDb,
  route: KeyedRoute,
  day: HkDateParts,
): { first: number; last: number } | null {
  if (!route.freq) return null;

  const isHoliday = db.holidays.includes(hkDateKey(day));
  const index = isHoliday ? 0 : day.weekday;

  let first: number | null = null;
  let last: number | null = null;

  for (const serviceId in route.freq) {
    if (db.serviceDayMap[serviceId]?.[index] !== "1") continue;
    const bands = route.freq[serviceId];
    if (!bands) continue;

    for (const startText in bands) {
      const start = parseHhmm(startText);
      if (start === null) continue;
      const band = bands[startText];
      const end = band ? parseHhmm(band[0]) : start;
      if (end === null) continue;

      if (first === null || start < first) first = start;
      if (last === null || end > last) last = end;
    }
  }

  if (first === null || last === null) return null;
  return { first, last };
}
