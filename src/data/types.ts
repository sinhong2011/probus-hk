/**
 * Shapes of https://data.hkbus.app/routeFareList.min.json, transcribed from the
 * live payload rather than from documentation — the file ships no schema.
 */

export type Company =
  | "kmb"
  | "ctb"
  | "nlb"
  | "gmb"
  | "mtr"
  | "lightRail"
  | "lrtfeeder"
  | "sunferry"
  | "hkkf"
  | "fortuneferry";

export interface Bilingual {
  en: string;
  zh: string;
}

export interface StopEntry {
  location: { lat: number; lng: number };
  name: Bilingual;
}

/**
 * `[endTime, headwaySeconds]`, keyed by start time ("0535"). A null value means
 * a fixed departure at that time rather than a headway band (ferries, some GMB).
 */
export type FreqBand = [string, string] | null;

export interface RouteEntry {
  route: string;
  /** Usually one company; two for a 聯營 joint route (e.g. `["kmb","ctb"]`). */
  co: Company[];
  bound: Partial<Record<Company, string>>;
  orig: Bilingual;
  dest: Bilingual;
  /**
   * Fare from stop *i* to the terminus, so this array is one shorter than
   * `stops` — the last stop has no onward fare. Values are decimal strings.
   */
  fares: string[] | null;
  /** Present only where a holiday tariff exists (notably NLB). */
  faresHoliday: string[] | null;
  /** serviceId -> startTime -> band. Keys index into `serviceDayMap`. */
  freq: Record<string, Record<string, FreqBand>> | null;
  gtfsId: string | null;
  /** Whole-journey time in minutes, as a string. */
  jt: string | null;
  nlbId: string | null;
  seq: number;
  serviceType: number | string;
  /** Stop ids per company; a joint route lists both operators' ids. */
  stops: Partial<Record<Company, string[]>>;
}

export interface RouteDb {
  /** "YYYYMMDD" public holidays, used to pick `faresHoliday` and service days. */
  holidays: string[];
  /** Key is `route+serviceType+origEn+destEn`. */
  routeList: Record<string, RouteEntry>;
  stopList: Record<string, StopEntry>;
  /** Cross-company stop aliases: stopId -> [[company, thatCompanysStopId]]. */
  stopMap: Record<string, [Company, string][]>;
  /** serviceId -> 7 flags, Sunday-first, "1" when the service runs. */
  serviceDayMap: Record<string, string[]>;
}

/** A route paired with the key it is stored under, for passing around. */
export interface KeyedRoute extends RouteEntry {
  key: string;
}

export type EtaSource = "live" | "scheduled";

export interface Eta {
  /** Absolute arrival instant; the UI derives the countdown from it. */
  at: Date;
  /** Whether the operator reported this or we inferred it from a timetable. */
  source: EtaSource;
  /** Operator remark, e.g. 原定班次 / 尾班車. */
  remark?: Bilingual;
  /** Company that reported it — matters on joint routes. */
  co: Company;
  /**
   * Platform to stand on, where the operator reports one. Rail only: a bus
   * stops where it stops, but on a railway this is the difference between
   * catching the train and watching it leave from the other side.
   */
  platform?: string;
  /** Light rail runs one- and two-car trains; the short ones fill up. */
  cars?: number;
}
