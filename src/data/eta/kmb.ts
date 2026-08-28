import type { Eta } from "~/data/types";
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
export async function fetchKmbEta(q: EtaQuery): Promise<Eta[]> {
  const { route } = q;
  const url = `${BASE}/route-eta/${encodeURIComponent(route.route)}/${route.serviceType}`;
  const body = await cachedJson<{ data: KmbRow[] }>(url);
  const dir = route.bound.kmb;

  return body.data
    .filter((row) => row.seq === q.seq && (!dir || row.dir === dir) && row.eta)
    .sort((a, b) => a.eta_seq - b.eta_seq)
    .flatMap((row) => {
      const at = parseHkTime(row.eta as string);
      if (!at) return [];
      const remark =
        row.rmk_tc || row.rmk_en ? { zh: row.rmk_tc, en: row.rmk_en } : undefined;
      return [{ at, source: kmbSource(row.rmk_en, row.rmk_tc), co: q.co, remark }];
    });
}
