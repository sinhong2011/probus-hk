import type { Eta } from "~/data/types";
import { cachedJson, parseHkTime } from "./http";
import type { EtaQuery } from "./types";

const BASE = "https://data.etagmb.gov.hk";

interface GmbEtaRow {
  eta_seq: number;
  diff: number;
  timestamp: string;
  remarks_tc: string | null;
  remarks_en: string | null;
}

/**
 * The route database's `gtfsId` is the same number the GMB API calls
 * `route_id`, and GMB splits each route into two `route_seq` directions:
 * 1 is the outbound listed first by the operator, 2 the reverse. The database
 * records those as bound "O" and "I" respectively.
 */
function routeSeq(bound: string | undefined): 1 | 2 {
  return bound === "I" ? 2 : 1;
}

/**
 * Note the three path segments - `/eta/route-stop/{route_id}/{stop_seq}` (the
 * two-segment form) answers 500 for every route; the direction is required.
 */
export async function fetchGmbEta(q: EtaQuery): Promise<Eta[]> {
  const routeId = q.route.gtfsId;
  if (!routeId) return [];

  const seq = routeSeq(q.route.bound.gmb);
  const url = `${BASE}/eta/route-stop/${routeId}/${seq}/${q.seq}`;

  const body = await cachedJson<{ data?: { eta?: GmbEtaRow[] } }>(url).catch(() => null);
  if (!body?.data?.eta) return [];

  return body.data.eta
    .slice()
    .sort((a, b) => a.eta_seq - b.eta_seq)
    .flatMap((row) => {
      const at = parseHkTime(row.timestamp);
      if (!at) return [];
      const remark =
        row.remarks_tc || row.remarks_en
          ? { zh: row.remarks_tc ?? "", en: row.remarks_en ?? "" }
          : undefined;
      // GMB flags timetable-derived entries as "未開出" / "Scheduled".
      const scheduled = row.remarks_en === "Scheduled";
      return [{ at, source: scheduled ? ("scheduled" as const) : ("live" as const), co: q.co, remark }];
    });
}

interface GmbStopRow {
  route_id: number;
  route_seq: number;
  stop_seq: number;
  eta?: GmbEtaRow[];
}

/**
 * Every route calling at one minibus stop, in a single request - what the
 * nearby and stop screens want, instead of one call per route.
 */
export async function fetchGmbStopEta(
  stopId: string,
): Promise<Map<string, Eta[]>> {
  const body = await cachedJson<{ data?: GmbStopRow[] }>(
    `${BASE}/eta/stop/${encodeURIComponent(stopId)}`,
  ).catch(() => null);

  const out = new Map<string, Eta[]>();
  for (const row of body?.data ?? []) {
    const etas = (row.eta ?? []).flatMap((e) => {
      const at = parseHkTime(e.timestamp);
      if (!at) return [];
      const scheduled = e.remarks_en === "Scheduled";
      return [
        {
          at,
          source: scheduled ? ("scheduled" as const) : ("live" as const),
          co: "gmb" as const,
        },
      ];
    });
    out.set(`${row.route_id}/${row.route_seq}`, etas);
  }
  return out;
}
