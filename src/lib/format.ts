import type { Eta } from "~/data/types";

export type CountdownKind = "arriving" | "minutes" | "gone";

export interface Countdown {
  kind: CountdownKind;
  minutes: number;
  scheduled: boolean;
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

  if (deltaMs < -30_000) return { kind: "gone", minutes, scheduled };
  if (minutes < 1) return { kind: "arriving", minutes: 0, scheduled };
  return { kind: "minutes", minutes, scheduled };
}

/** "11 · 24" - the two arrivals after the one being counted down. */
export function followingMinutes(etas: Eta[], now = Date.now()): string {
  return etas
    .slice(1)
    .map((e) => Math.max(0, Math.floor((e.at.getTime() - now) / 60_000)))
    .join(" · ");
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

/** "$9.3 · $2.0" - full fare beside the concession, as riders compare them. */
export function fareLabel(full: string | null | undefined): string | null {
  const paid = formatFare(full);
  if (!paid) return null;
  const concession = concessionFare(full);
  return concession ? `${paid} · ${concession}` : paid;
}
