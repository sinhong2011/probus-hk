import { AsyncQueuer } from "@tanstack/pacer";
import { queryClient } from "~/lib/query";
import { refreshLive } from "../live";

/**
 * Every operator's ETA endpoint is polled from many rows at once - a route page
 * with 25 stops would otherwise fire 25 identical requests. Responses are
 * therefore memoised for a few seconds and concurrent callers share one flight.
 *
 * The memo is the app's query cache, under a key of its own, so the raw
 * responses and the per-row answers built from them are one cache with two
 * tiers rather than two caches that have to be cleared in step. A failure is
 * never kept: a query with no data is stale by definition, so the next poll
 * asks again.
 */
const TTL_MS = 8_000;

/**
 * How many operator requests may be in the air at once.
 *
 * Every row on screen asks at the same moment, and a poll of the nearby
 * screen is forty stops across four operators. A browser lets six through
 * per host and queues the rest itself, but a phone on a poor connection
 * does better sending a handful, seeing them back, and sending the next -
 * the first rows fill while the rest are still queued, instead of all of
 * them waiting on the slowest. The cache above this dedupes; this paces.
 */
const IN_FLIGHT = 6;

interface Flight {
  run: () => Promise<unknown>;
  settle: (result: PromiseSettledResult<unknown>) => void;
}

const flights = new AsyncQueuer<Flight>(
  async (flight) => {
    try {
      flight.settle({ status: "fulfilled", value: await flight.run() });
    } catch (reason) {
      flight.settle({ status: "rejected", reason });
    }
  },
  { concurrency: IN_FLIGHT, started: true },
);

/** Run when a slot is free; the caller sees an ordinary promise. */
function paced<T>(run: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    flights.addItem({
      run,
      settle: (result) =>
        result.status === "fulfilled" ? resolve(result.value as T) : reject(result.reason),
    });
  });
}

export function cachedJson<T>(url: string, init?: RequestInit & { body?: string }): Promise<T> {
  return queryClient.fetchQuery({
    queryKey: ["http", url, init?.body ?? null],
    queryFn: () =>
      paced(async () => {
        const res = await fetch(url, init);
        if (!res.ok) throw new Error(`${url} -> ${res.status}`);
        return (await res.json()) as T;
      }),
    staleTime: TTL_MS,
    // Long enough to outlive one poll on the slowest cadence, and no longer.
    gcTime: 90_000,
  });
}

/** Drop everything so a pull-to-refresh really refetches. */
export function clearEtaCache() {
  refreshLive();
}

/**
 * Several feeds return Hong Kong wall-clock time with no offset
 * ("2026-08-27 19:20:00"). Treat those as UTC+8 rather than as local time, so
 * the app stays correct on a phone whose clock is set to another zone.
 */
export function parseHkTime(value: string): Date | null {
  if (!value) return null;
  const trimmed = value.trim();
  const hasOffset = /(?:Z|[+-]\d{2}:?\d{2})$/.test(trimmed);
  const iso = hasOffset ? trimmed.replace(" ", "T") : `${trimmed.replace(" ", "T")}+08:00`;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function inMinutes(minutes: number): Date {
  return new Date(Date.now() + minutes * 60_000);
}

export function inSeconds(seconds: number): Date {
  return new Date(Date.now() + seconds * 1_000);
}

/**
 * KMB marks timetable-derived departures with the remark "原定班次" /
 * "Scheduled Bus" - they are not GPS-tracked, so they must not be presented
 * with the same confidence as a real prediction.
 */
export function kmbSource(remarkEn: string, remarkZh: string): "live" | "scheduled" {
  return /scheduled/i.test(remarkEn) || remarkZh.includes("原定") ? "scheduled" : "live";
}
