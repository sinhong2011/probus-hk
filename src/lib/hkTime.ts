/**
 * Hong Kong runs on UTC+8 year round with no daylight saving, but the phone
 * showing this app may not be. Timetable maths therefore has to be done in Hong
 * Kong wall-clock explicitly rather than in the device's local time.
 */

const HK_OFFSET_MS = 8 * 60 * 60 * 1000;

export interface HkDateParts {
  year: number;
  month: number;
  day: number;
  /** 0 = Sunday, matching the order of `serviceDayMap` flags. */
  weekday: number;
  minutesSinceMidnight: number;
}

export function hkNow(at: Date = new Date()): HkDateParts {
  // Shifting into UTC lets the plain UTC getters read as Hong Kong wall-clock.
  const shifted = new Date(at.getTime() + HK_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    weekday: shifted.getUTCDay(),
    minutesSinceMidnight: shifted.getUTCHours() * 60 + shifted.getUTCMinutes(),
  };
}

/** "YYYYMMDD", the format the holiday list uses. */
export function hkDateKey(parts: HkDateParts): string {
  const mm = String(parts.month).padStart(2, "0");
  const dd = String(parts.day).padStart(2, "0");
  return `${parts.year}${mm}${dd}`;
}

/**
 * Turns a Hong Kong wall-clock time on a given day into a real instant.
 * `minutes` may exceed 24 hours: timetables express after-midnight departures
 * as "2620", meaning 02:20 the following day.
 */
export function hkInstant(parts: HkDateParts, minutesSinceMidnight: number): Date {
  const midnightUtc = Date.UTC(parts.year, parts.month - 1, parts.day);
  return new Date(midnightUtc + minutesSinceMidnight * 60_000 - HK_OFFSET_MS);
}

/** Parses timetable "HHMM" into minutes since midnight, allowing HH >= 24. */
export function parseHhmm(value: string): number | null {
  if (!/^\d{4}$/.test(value)) return null;
  const hours = Number(value.slice(0, 2));
  const minutes = Number(value.slice(2, 4));
  if (minutes > 59) return null;
  return hours * 60 + minutes;
}
