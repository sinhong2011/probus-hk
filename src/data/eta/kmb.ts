import type { Company, Eta, KeyedRoute } from "~/data/types";
import type { EtaTable } from "~/data/vehicles";
import { cachedJson, kmbSource, parseHkTime } from "./http";
import type { EtaQuery } from "./types";

const BASE = "https://data.etabus.gov.hk/v1/transport/kmb";

interface KmbRow {
  dir: string;
  seq: number;
  eta: string | null;
  eta_seq: number;
  rmk_tc: string;
  rmk_en: string;
}

/**
 * One call returns every stop on the route, which is why the shared cache
 * matters here: a whole route page costs a single request.
 *
 * KMB also serves LWB (Long Win) routes from the same endpoint.
 */
async function fetchRows(route: KeyedRoute): Promise<KmbRow[]> {
  const url = `${BASE}/route-eta/${encodeURIComponent(route.route)}/${route.serviceType}`;
  const body = await cachedJson<{ data: KmbRow[] }>(url);
  const dir = route.bound.kmb;
  return body.data.filter((row) => (!dir || row.dir === dir) && row.eta);
}

function toEta(row: KmbRow, co: Company): Eta[] {
  const at = parseHkTime(row.eta as string);
  if (!at) return [];
  const remark = row.rmk_tc || row.rmk_en ? { zh: row.rmk_tc, en: row.rmk_en } : undefined;
  return [{ at, source: kmbSource(row.rmk_en, row.rmk_tc), co, remark }];
}

export async function fetchKmbEta(q: EtaQuery): Promise<Eta[]> {
  const rows = await fetchRows(q.route);
  return rows
    .filter((row) => row.seq === q.seq)
    .sort((a, b) => a.eta_seq - b.eta_seq)
    .flatMap((row) => toEta(row, q.co));
}

/**
 * The same response, kept whole instead of narrowed to one stop.
 *
 * Every stop's arrivals at once is what it takes to work out where the buses
 * are, and this costs nothing to ask for: the route page has already fetched
 * this exact URL for the row a rider is looking at, so the cache answers.
 */
export async function fetchKmbRouteEtaTable(route: KeyedRoute, co: Company): Promise<EtaTable> {
  const rows = await fetchRows(route);
  const table: EtaTable = new Map();

  for (const row of rows.sort((a, b) => a.eta_seq - b.eta_seq)) {
    const etas = toEta(row, co);
    if (etas.length === 0) continue;
    table.set(row.seq, [...(table.get(row.seq) ?? []), ...etas]);
  }
  return table;
}
