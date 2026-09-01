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

const pad2 = (n: number) => String(n).padStart(2, "0");

/** "2026-03-21", for a date field that is Hong Kong's calendar, not the phone's. */
export function formatHkYmd(at: Date = new Date()): string {
  const parts = hkNow(at);
  return `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}`;
}

/** "09:20", Hong Kong wall-clock. */
export function formatHkHm(at: Date = new Date()): string {
  const minutes = hkNow(at).minutesSinceMidnight % (24 * 60);
  return `${pad2(Math.floor(minutes / 60))}:${pad2(minutes % 60)}`;
}

/**
 * Reads a civil date and time as a Hong Kong instant. The phone may not be
 * in Hong Kong; the picker is still Hong Kong's clock.
 */
export function parseHkYmdHm(ymd: string, hm: string): Date | null {
  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  const time = /^(\d{1,2}):(\d{2})$/.exec(hm);
  if (!day || !time) return null;
  const year = Number(day[1]);
  const month = Number(day[2]);
  const date = Number(day[3]);
  const hours = Number(time[1]);
  const minutes = Number(time[2]);
  if (month < 1 || month > 12 || date < 1 || date > 31 || hours > 23 || minutes > 59) {
    return null;
  }
  return hkInstant(
    { year, month, day: date, weekday: 0, minutesSinceMidnight: 0 },
    hours * 60 + minutes,
  );
}

export function sameHkDay(a: Date, b: Date): boolean {
  const left = hkNow(a);
  const right = hkNow(b);
  return left.year === right.year && left.month === right.month && left.day === right.day;
}

/** Shift a Hong Kong civil datetime by whole days, keeping the same clock time. */
export function addHkDays(at: Date, days: number): Date {
  const parts = hkNow(at);
  return hkInstant(parts, parts.minutesSinceMidnight + days * 24 * 60);
}
