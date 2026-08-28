import type { Company, Eta, RouteDb } from "~/data/types";
import type { RouteAtStop } from "~/data/db";
import { scheduledEta } from "~/data/schedule";
import { cachedJson, kmbSource, parseHkTime } from "./http";
import { fetchGmbStopEta } from "./gmb";
import { fetchEtaAllOperators } from "./index";

/**
 * A stop screen shows every route calling at one kerb. Asking each route
 * separately would be a dozen or more requests; KMB and the minibus feed both
 * answer "everything at this stop" in a single call, so those are batched and
 * only the remaining operators are queried per route.
 */

const KMB_STOP_ETA = "https://data.etabus.gov.hk/v1/transport/kmb/stop-eta";

interface KmbStopRow {
  route: string;
  dir: string;
  service_type: number;
  seq: number;
  eta: string | null;
  eta_seq: number;
  rmk_tc: string;
  rmk_en: string;
}

/** Groups KMB arrivals by `route/dir/serviceType`, which identifies a variant. */
async function kmbByVariant(stopId: string): Promise<Map<string, Eta[]>> {
  const body = await cachedJson<{ data: KmbStopRow[] }>(
    `${KMB_STOP_ETA}/${encodeURIComponent(stopId)}`,
  );

  const out = new Map<string, Eta[]>();
  // A bus that has already gone is worse than no information at all.
  const floor = Date.now() - 60_000;

  for (const row of body.data) {
    if (!row.eta) continue;
    const at = parseHkTime(row.eta);
    if (!at || at.getTime() < floor) continue;

    const key = `${row.route}/${row.dir}/${row.service_type}`;
    const remark = row.rmk_tc || row.rmk_en ? { zh: row.rmk_tc, en: row.rmk_en } : undefined;
    const list = out.get(key) ?? [];
    list.push({ at, source: kmbSource(row.rmk_en, row.rmk_tc), co: "kmb", remark });
    out.set(key, list);
  }

  for (const list of out.values()) list.sort((a, b) => a.at.getTime() - b.at.getTime());
  return out;
}

/** Arrivals are keyed by route, since a joint route is one row on screen. */
export type StopEtaMap = Map<string, Eta[]>;

export function etaKey(routeKey: string): string {
  return routeKey;
}

async function batchFor<T>(
  ids: Set<string>,
  load: (id: string) => Promise<Map<string, T>>,
): Promise<Map<string, T>> {
  const merged = new Map<string, T>();
  const results = await Promise.all(
    [...ids].map((id) => load(id).catch(() => new Map<string, T>())),
  );
  for (const result of results) for (const [k, v] of result) merged.set(k, v);
  return merged;
}

function idsFor(routes: RouteAtStop[], co: Company): Set<string> {
  const ids = new Set<string>();
  for (const at of routes) {
    const id = at.stopIdByCo[co];
    if (id) ids.add(id);
  }
  return ids;
}

/**
 * Arrivals for every route at one stop.
 *
 * A failure in one operator's feed degrades that operator's rows to the
 * timetable rather than emptying the screen.
 */
export async function fetchStopEtas(
  db: RouteDb,
  _stopId: string,
  routes: RouteAtStop[],
  limit = 3,
): Promise<StopEtaMap> {
  const result: StopEtaMap = new Map();

  const [kmb, gmb] = await Promise.all([
    batchFor(idsFor(routes, "kmb"), kmbByVariant),
    batchFor(idsFor(routes, "gmb"), fetchGmbStopEta),
  ]);

  const unbatched: RouteAtStop[] = [];

  for (const at of routes) {
    const operators = at.route.co;
    const collected: Eta[] = [];

    if (operators.includes("kmb") && at.stopIdByCo.kmb) {
      const variant = `${at.route.route}/${at.route.bound.kmb ?? ""}/${at.route.serviceType}`;
      collected.push(...(kmb.get(variant) ?? []));
    }
    if (operators.includes("gmb") && at.stopIdByCo.gmb) {
      const seq = at.route.bound.gmb === "I" ? 2 : 1;
      collected.push(...(gmb.get(`${at.route.gtfsId}/${seq}`) ?? []));
    }

    // Any operator on this route that the batch could not cover.
    const remaining = operators.filter((co) => co !== "kmb" && co !== "gmb");
    if (remaining.length > 0) {
      unbatched.push(at);
    }

    if (collected.length > 0) {
      result.set(
        etaKey(at.route.key),
        collected.sort((a, b) => a.at.getTime() - b.at.getTime()).slice(0, limit),
      );
    }
  }

  await Promise.all(
    unbatched.map(async (at) => {
      const etas = await fetchEtaAllOperators(
        db,
        { route: at.route, seq: at.seq },
        at.stopIdByCo,
        limit,
      ).catch(() => [] as Eta[]);

      const key = etaKey(at.route.key);
      const existing = result.get(key) ?? [];
      // Both operators of a joint route report the same physical bus, so merge
      // and drop anything landing within a minute of an arrival we already have.
      const merged = [...existing, ...etas].sort((a, b) => a.at.getTime() - b.at.getTime());
      const deduped: Eta[] = [];
      for (const eta of merged) {
        const last = deduped[deduped.length - 1];
        if (last && Math.abs(last.at.getTime() - eta.at.getTime()) < 60_000) continue;
        deduped.push(eta);
      }
      result.set(key, deduped.slice(0, limit));
    }),
  );

  // Anything still empty falls back to the published timetable.
  for (const at of routes) {
    const key = etaKey(at.route.key);
    if ((result.get(key) ?? []).length === 0) {
      result.set(key, scheduledEta(db, at.route, at.seq, limit));
    }
  }

  return result;
}
