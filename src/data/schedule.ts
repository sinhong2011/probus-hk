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

  return [...byFlags.entries()]
    .map(([flags, bands]) => ({ flags, bands: bands.sort((a, b) => a.from.localeCompare(b.from)) }))
    .filter((group) => group.bands.length > 0)
    // Everyday patterns first, then the ones covering the most days.
    .sort((a, b) => b.flags.split("1").length - a.flags.split("1").length);
}
