import type { Eta } from "~/data/types";
import { cachedJson, inMinutes, parseHkTime } from "./http";
import type { EtaQuery } from "./types";

const URL_RAIL = "https://rt.data.gov.hk/v1/transport/mtr/getSchedule.php";
const URL_LRT = "https://rt.data.gov.hk/v1/transport/mtr/lrt/getSchedule";
const URL_BUS = "https://rt.data.gov.hk/v1/transport/mtr/bus/getSchedule";

/* ---- heavy rail -------------------------------------------------------- */

interface RailTrain {
  seq: string;
  dest: string;
  plat: string;
  /** Hong Kong wall-clock, no offset. */
  time: string;
  /** Time to next train, in minutes. */
  ttnt: string;
  valid: string;
}

interface RailResponse {
  status: number;
  data: Record<string, { UP?: RailTrain[]; DOWN?: RailTrain[] }>;
}

/**
 * `route` is the line code (AEL, TWL, ...) and the stop id is the station code
 * (HOK, KOW, ...). The database records direction as "UT"/"DT", which maps onto
 * the feed's UP/DOWN arrays.
 */
export async function fetchMtrRailEta(q: EtaQuery): Promise<Eta[]> {
  const line = q.route.route;
  const sta = q.stopId;
  const body = await cachedJson<RailResponse>(
    `${URL_RAIL}?line=${encodeURIComponent(line)}&sta=${encodeURIComponent(sta)}`,
  );
  if (body.status !== 1) return [];

  const node = body.data[`${line}-${sta}`];
  if (!node) return [];

  const trains = q.route.bound.mtr === "UT" ? node.UP : node.DOWN;
  return (trains ?? [])
    .filter((t) => t.valid !== "N")
    .flatMap((t) => {
      const at = parseHkTime(t.time);
      if (!at) return [];
      return [
        {
          at,
          source: "live" as const,
          co: q.co,
          platform: t.plat || undefined,
          dest: t.dest || undefined,
        },
      ];
    });
}

/* ---- light rail -------------------------------------------------------- */

interface LrtRoute {
  route_no: string;
  dest_en: string;
  dest_ch: string;
  time_en: string;
  time_ch: string;
  train_length: number;
}

interface LrtResponse {
  platform_list?: { platform_id: number; route_list?: LrtRoute[] }[];
}

/**
 * The light rail feed reports words rather than clock times - "Departing",
 * "Arriving", or "3 min" - so a countdown has to be reconstructed. Anything
 * already at the platform counts as now.
 */
function parseLrtMinutes(text: string): number | null {
  const t = text.trim().toLowerCase();
  if (!t || t === "-") return null;
  if (t.startsWith("depart") || t.startsWith("arriv")) return 0;
  const m = /^(\d+)\s*min/.exec(t);
  return m?.[1] ? Number(m[1]) : null;
}

/** Database stop ids look like "LR920"; the feed wants the bare number. */
export async function fetchLightRailEta(q: EtaQuery): Promise<Eta[]> {
  const stationId = q.stopId.replace(/^LR/i, "");
  const body = await cachedJson<LrtResponse>(
    `${URL_LRT}?station_id=${encodeURIComponent(stationId)}`,
  );

  const wantRoute = q.route.route;
  const wantDest = q.route.dest;
  const out: Eta[] = [];

  for (const platform of body.platform_list ?? []) {
    for (const row of platform.route_list ?? []) {
      if (row.route_no !== wantRoute) continue;
      // One route number can serve several termini from the same platform.
      if (row.dest_ch !== wantDest.zh && row.dest_en !== wantDest.en) continue;

      const mins = parseLrtMinutes(row.time_en) ?? parseLrtMinutes(row.time_ch);
      if (mins === null) continue;
      out.push({
        at: inMinutes(mins),
        source: "live",
        co: q.co,
        platform: String(platform.platform_id),
        cars: row.train_length || undefined,
      });
    }
  }
  return out.sort((a, b) => a.at.getTime() - b.at.getTime());
}

/* ---- MTR feeder bus ---------------------------------------------------- */

interface FeederBus {
  arrivalTimeInSecond: string;
  departureTimeInSecond: string;
  isScheduled: string;
  isDelayed: string;
}

interface FeederResponse {
  busStop?: { busStopId: string; bus?: FeederBus[] }[];
}

/** The feed uses 108000 (30 hours) as its "not applicable" sentinel. */
const FEEDER_NA = 108_000;

/**
 * Unlike NLB, this endpoint answers preflight properly, so a JSON content-type
 * is fine here.
 */
export async function fetchLrtFeederEta(q: EtaQuery): Promise<Eta[]> {
  const body = await cachedJson<FeederResponse>(URL_BUS, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ language: "en", routeName: q.route.route }),
  });

  const stop = body.busStop?.find((s) => s.busStopId === q.stopId);
  if (!stop) return [];

  return (stop.bus ?? [])
    .flatMap((bus) => {
      const arrival = Number(bus.arrivalTimeInSecond);
      const departure = Number(bus.departureTimeInSecond);
      // At a terminus only the departure is meaningful.
      const seconds = Number.isFinite(arrival) && arrival < FEEDER_NA ? arrival : departure;
      if (!Number.isFinite(seconds) || seconds >= FEEDER_NA) return [];
      return [
        {
          at: new Date(Date.now() + seconds * 1000),
          source: bus.isScheduled === "1" ? ("scheduled" as const) : ("live" as const),
          co: q.co,
          remark: bus.isDelayed === "1" ? { zh: "延誤", en: "Delayed" } : undefined,
        },
      ];
    })
    .sort((a, b) => a.at.getTime() - b.at.getTime());
}
