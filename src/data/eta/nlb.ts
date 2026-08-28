import type { Eta } from "~/data/types";
import { cachedJson, parseHkTime } from "./http";
import type { EtaQuery } from "./types";

const URL_ETA = "https://rt.data.gov.hk/v2/transport/nlb/stop.php?action=estimatedArrivals";

interface NlbArrival {
  estimatedArrivalTime?: string;
  departed?: string;
  noGPS?: string;
  routeVariantName?: string;
}

/**
 * NLB needs a POST body, sent as text/plain deliberately: the endpoint parses
 * the JSON either way, and text/plain keeps this a CORS "simple request". A
 * JSON content-type would trigger a preflight that NLB does not answer with the
 * `Access-Control-Allow-Headers` a browser requires, so the call would be
 * blocked before it left the page.
 *
 * `routeId` and `stopId` are NLB's own ids, which the route database already
 * stores as `nlbId` and in `stops.nlb`. An empty `{}` is NLB's ordinary way of
 * saying nothing is running right now.
 */
export async function fetchNlbEta(q: EtaQuery): Promise<Eta[]> {
  const routeId = q.route.nlbId;
  if (!routeId) return [];

  const res = await cachedJson<{ estimatedArrivals?: NlbArrival[] }>(URL_ETA, {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body: JSON.stringify({ routeId, stopId: q.stopId, language: "zh" }),
  });

  return (res.estimatedArrivals ?? []).flatMap((row) => {
    const at = row.estimatedArrivalTime ? parseHkTime(row.estimatedArrivalTime) : null;
    if (!at || row.departed === "1") return [];
    const remark = row.noGPS === "1" ? { zh: "非實時定位", en: "No GPS" } : undefined;
    return [{ at, source: "live" as const, co: q.co, remark }];
  });
}
