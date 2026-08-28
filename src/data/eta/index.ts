import type { Company, Eta, RouteDb } from "~/data/types";
import { scheduledEta } from "~/data/schedule";
import { fetchKmbEta } from "./kmb";
import { fetchCtbEta } from "./ctb";
import { fetchNlbEta } from "./nlb";
import { fetchGmbEta } from "./gmb";
import { fetchLightRailEta, fetchLrtFeederEta, fetchMtrRailEta } from "./mtr";
import type { EtaFetcher, EtaQuery } from "./types";

export type { EtaQuery, EtaFetcher } from "./types";
export { clearEtaCache } from "./http";

/**
 * The three ferry operators publish no arrival feed that a browser can reach,
 * so they are deliberately absent here and fall through to the timetable.
 */
const LIVE_FETCHERS: Partial<Record<Company, EtaFetcher>> = {
  kmb: fetchKmbEta,
  ctb: fetchCtbEta,
  nlb: fetchNlbEta,
  gmb: fetchGmbEta,
  mtr: fetchMtrRailEta,
  lightRail: fetchLightRailEta,
  lrtfeeder: fetchLrtFeederEta,
};

export function hasLiveFeed(co: Company): boolean {
  return co in LIVE_FETCHERS;
}

/**
 * Arrivals for one stop on one route, newest information first.
 *
 * A joint route is served by two operators from the same kerb, so every
 * operator that runs it is asked and the answers are merged - querying only the
 * first would silently hide half the buses.
 */
export async function fetchEta(db: RouteDb, q: EtaQuery, limit = 3): Promise<Eta[]> {
  const fetcher = LIVE_FETCHERS[q.co];

  const live = fetcher ? await fetcher(q).catch(() => [] as Eta[]) : [];
  const usable = live.filter((e) => e.at.getTime() > Date.now() - 60_000);
  if (usable.length > 0) {
    return usable.sort((a, b) => a.at.getTime() - b.at.getTime()).slice(0, limit);
  }

  // Nothing live: fall back to the published timetable, clearly marked.
  return scheduledEta(db, q.route, q.seq, limit);
}

/**
 * Asks every operator on a joint route and merges the results, de-duplicating
 * arrivals that land within a minute of each other - both operators report the
 * same physical bus.
 */
export async function fetchEtaAllOperators(
  db: RouteDb,
  base: Omit<EtaQuery, "co" | "stopId">,
  stopIdByCo: Partial<Record<Company, string>>,
  limit = 3,
): Promise<Eta[]> {
  const queries = base.route.co.flatMap((co) => {
    const stopId = stopIdByCo[co];
    return stopId ? [{ ...base, co, stopId }] : [];
  });

  const results = await Promise.all(queries.map((q) => fetchEta(db, q, limit)));
  const merged = results.flat().sort((a, b) => a.at.getTime() - b.at.getTime());

  const out: Eta[] = [];
  for (const eta of merged) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.at.getTime() - eta.at.getTime()) < 60_000) continue;
    out.push(eta);
  }
  return out.slice(0, limit);
}
