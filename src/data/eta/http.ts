/**
 * Every operator's ETA endpoint is polled from many rows at once - a route page
 * with 25 stops would otherwise fire 25 identical requests. Responses are
 * therefore memoised for a few seconds and concurrent callers share one flight.
 */

interface Entry {
  at: number;
  value: Promise<unknown>;
}

const cache = new Map<string, Entry>();
const TTL_MS = 8_000;

function key(url: string, body?: string) {
  return body ? `${url} ${body}` : url;
}

export function cachedJson<T>(url: string, init?: RequestInit & { body?: string }): Promise<T> {
  const k = key(url, init?.body);
  const hit = cache.get(k);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value as Promise<T>;

  const value = fetch(url, init)
    .then((res) => {
      if (!res.ok) throw new Error(`${url} -> ${res.status}`);
      return res.json() as Promise<T>;
    })
    .catch((err) => {
      // Never cache a failure: the next poll should retry immediately.
      cache.delete(k);
      throw err;
    });

  cache.set(k, { at: Date.now(), value });
  return value as Promise<T>;
}

/** Drop everything so a pull-to-refresh really refetches. */
export function clearEtaCache() {
  cache.clear();
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
