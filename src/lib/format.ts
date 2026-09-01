import type { Bilingual, Eta } from "~/data/types";

export type CountdownKind = "arriving" | "minutes" | "gone";

export interface Countdown {
  kind: CountdownKind;
  minutes: number;
  scheduled: boolean;
  /** What the operator said about this departure, where it adds something. */
  remark?: Bilingual;
}

/**
 * Remarks the countdown already makes in its own shape.
 *
 * "原定班次" is what the tilde and the scheduled note mean, so printing it too
 * is the same fact three times. Everything else an operator says - 最後班次,
 * 延誤, 非實時定位 - is news, and was being parsed and then dropped.
 */
const ALREADY_SAID = /scheduled|原定/i;

function newsworthy(remark: Bilingual | undefined): Bilingual | undefined {
  if (!remark) return undefined;
  const text = `${remark.zh} ${remark.en}`.trim();
  return text && !ALREADY_SAID.test(text) ? remark : undefined;
}

/** Whether a remark is the operator saying this is the last one of the day. */
export function isLastRun(remark: Bilingual): boolean {
  return /last/i.test(remark.en) || /最後|尾班/.test(remark.zh);
}

/**
 * Rounds down rather than to nearest: a bus shown as "3 min" that is really 3
 * minutes 50 seconds away is a bus you can still catch, whereas one shown as
 * "3" that leaves in 2:10 is a bus you miss. Erring early is the safe side.
 */
export function countdown(eta: Eta, now = Date.now()): Countdown {
  const deltaMs = eta.at.getTime() - now;
  const minutes = Math.floor(deltaMs / 60_000);
  const scheduled = eta.source === "scheduled";

  const remark = newsworthy(eta.remark);

  if (deltaMs < -30_000) return { kind: "gone", minutes, scheduled, remark };
  if (minutes < 1) return { kind: "arriving", minutes: 0, scheduled, remark };
  return { kind: "minutes", minutes, scheduled, remark };
}

/**
 * The one thing the operator said that is about the stop rather than about a
 * single departure.
 *
 * "尾班" is a mark on one numeral and belongs beside it, at a width that never
 * changes. A disruption - 「受阻於牛池灣」 - is a sentence, and beside a column
 * of numbers it was cut to six characters with no way to read the rest. It is
 * picked out here so a row can carry it next to the stop's own name, where
 * there is room for it and something to tap.
 */
export function serviceNotice(etas: Eta[] | undefined, now = Date.now()): Bilingual | undefined {
  for (const eta of etas ?? []) {
    const state = countdown(eta, now);
    if (state.kind === "gone" || !state.remark) continue;
    if (!isLastRun(state.remark)) return state.remark;
  }
  return undefined;
}

/** "11 · 24" - the two arrivals after the one being counted down. */
export function followingMinutes(etas: Eta[], now = Date.now()): string {
  return etas
    .slice(1)
    .map((e) => Math.max(0, Math.floor((e.at.getTime() - now) / 60_000)))
    .join(" · ");
}

/** "15:18", for a time this app worked out rather than one it was told. */
export function clockTime(at: Date): string {
  return at.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false });
}

export function formatFare(value: string | undefined | null): string | null {
  if (!value) return null;
  const n = Number(value);
  return Number.isFinite(n) ? `$${n.toFixed(1)}` : null;
}

/**
 * Fares are stored one per stop *except the last* - the terminus has no onward
 * fare - so an out-of-range lookup here is expected, not a bug.
 */
export function fareAt(fares: string[] | null, seq: number): string | null {
  if (!fares) return null;
  return formatFare(fares[seq - 1]);
}

/**
 * The government's 「兩蚊乘車優惠」 concession for elderly and eligible
 * passengers. Since the 「兩蚊兩折」 change, a rider pays a flat $2 on fares up
 * to $10, and 20% of the full fare above that.
 *
 * It is computed rather than stored: the route database carries only the full
 * fare, and every operator applies the same government formula.
 */
export function concessionFare(full: string | null | undefined): string | null {
  const n = Number(full);
  if (!full || !Number.isFinite(n) || n <= 0) return null;
  const value = n <= 10 ? 2 : Math.round(n * 2) / 10;
  return `$${value.toFixed(1)}`;
}

/** What the scheme is named after, and what most fares come to under it. */
const FLAT_CONCESSION = "$2.0";

/**
 * The concession worth printing beside a full fare.
 *
 * Above ten dollars it is a fifth of the fare, a different number on every
 * route and the only way to know what a long ride costs at the concession -
 * so it is printed. At or below ten it is the flat two dollars the scheme is
 * named for, the same on every route in Hong Kong, and printing it down a
 * forty-stop list was the same two characters forty times over. A rider
 * entitled to it knows the two-dollar fare; what they cannot know without
 * being told is when their ride costs more than that.
 */
export function notableConcession(full: string | null | undefined): string | null {
  const value = concessionFare(full);
  return value === FLAT_CONCESSION ? null : value;
}

/** "$21.8 · $4.4" - full fare beside the concession, where that is not the flat $2. */
export function fareLabel(full: string | null | undefined): string | null {
  const paid = formatFare(full);
  if (!paid) return null;
  const concession = notableConcession(full);
  return concession ? `${paid} · ${concession}` : paid;
}
