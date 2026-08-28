import type { Eta } from "~/data/types";
import { cachedJson, parseHkTime } from "./http";
import type { EtaQuery } from "./types";

const BASE = "https://rt.data.gov.hk/v2/transport/citybus";

interface CtbRow {
  dir: string;
  seq: number;
  stop: string;
  eta: string | null;
  eta_seq: number;
  rmk_tc: string;
  rmk_en: string;
}

/**
 * Citybus is queried per stop rather than per route, so a route page costs one
 * request per visible stop - the shared cache keeps repeats off the wire.
 * NWFB was absorbed into Citybus, so "CTB" covers both former fleets.
 */
export async function fetchCtbEta(q: EtaQuery): Promise<Eta[]> {
  const url = `${BASE}/eta/CTB/${encodeURIComponent(q.stopId)}/${encodeURIComponent(q.route.route)}`;
  const body = await cachedJson<{ data: CtbRow[] }>(url);
  const dir = q.route.bound.ctb;

  return body.data
    .filter((row) => (!dir || row.dir === dir) && row.eta)
    .sort((a, b) => a.eta_seq - b.eta_seq)
    .flatMap((row) => {
      const at = parseHkTime(row.eta as string);
      if (!at) return [];
      const remark =
        row.rmk_tc || row.rmk_en ? { zh: row.rmk_tc, en: row.rmk_en } : undefined;
      return [{ at, source: "live" as const, co: q.co, remark }];
    });
}
