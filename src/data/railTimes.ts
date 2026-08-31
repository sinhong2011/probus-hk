/**
 * How long the railway takes, station to station.
 *
 * The route database knows the MTR as lines with stations and nothing about
 * time: every heavy-rail entry carries `jt: null`, so a planner working from
 * it alone would guess two minutes a station and get Tsuen Wan from Central
 * about right and Tung Chung from Hong Kong badly wrong. The MTR publishes no
 * open dataset of running times either - lines, stations and fares only - so
 * the numbers here are authored: running time between each pair of adjacent
 * stations, and the time a change costs at each interchange, both in whole
 * minutes as the MTR's own journey planner reports them. `tests/unit` checks
 * the table against the MTR's published end-to-end times.
 *
 * Stations are the MTR's own three-letter codes, which are also the stop ids
 * the route database uses for its rail entries - so a leg planned here can be
 * looked up in the database for its name, its place on the map and its
 * arrivals without a translation table in between.
 */

/** Every service the heavy rail runs, as the stations it calls at in order. */
export const RAIL_LINES: Record<string, string[]> = {
  AEL: ["HOK", "KOW", "TSY", "AIR", "AWE"],
  TCL: ["HOK", "KOW", "OLY", "NAC", "LAK", "TSY", "SUN", "TUC"],
  DRL: ["SUN", "DIS"],
  TWL: [
    "CEN",
    "ADM",
    "TST",
    "JOR",
    "YMT",
    "MOK",
    "PRE",
    "SSP",
    "CSW",
    "LCK",
    "MEF",
    "LAK",
    "KWF",
    "KWH",
    "TWH",
    "TSW",
  ],
  KTL: [
    "WHA",
    "HOM",
    "YMT",
    "MOK",
    "PRE",
    "SKM",
    "KOT",
    "LOF",
    "WTS",
    "DIH",
    "CHH",
    "KOB",
    "NTK",
    "KWT",
    "LAT",
    "YAT",
    "TIK",
  ],
  ISL: [
    "KET",
    "HKU",
    "SYP",
    "SHW",
    "CEN",
    "ADM",
    "WAC",
    "CAB",
    "TIH",
    "FOH",
    "NOP",
    "QUB",
    "TAK",
    "SWH",
    "SKW",
    "HFC",
    "CHW",
  ],
  TKL: ["NOP", "QUB", "YAT", "TIK", "TKO", "HAH", "POA"],
  /* The LOHAS Park service shares the line's code and its tracks north of
     Tseung Kwan O; it is its own sequence because a train on it does not go
     to Po Lam. */
  "TKL-LHP": ["NOP", "QUB", "YAT", "TIK", "TKO", "LHP"],
  EAL: [
    "ADM",
    "EXC",
    "HUH",
    "MKK",
    "KOT",
    "TAW",
    "SHT",
    "FOT",
    "UNI",
    "TAP",
    "TWO",
    "FAN",
    "SHS",
    "LOW",
  ],
  "EAL-LMC": [
    "ADM",
    "EXC",
    "HUH",
    "MKK",
    "KOT",
    "TAW",
    "SHT",
    "FOT",
    "UNI",
    "TAP",
    "TWO",
    "FAN",
    "SHS",
    "LMC",
  ],
  SIL: ["ADM", "OCP", "WCH", "LET", "SOH"],
  TML: [
    "TUM",
    "SIH",
    "TIS",
    "LOP",
    "YUL",
    "KSR",
    "TWW",
    "MEF",
    "NAC",
    "AUS",
    "ETS",
    "HUH",
    "HOM",
    "TKW",
    "SUW",
    "KAT",
    "DIH",
    "HIK",
    "TAW",
    "CKT",
    "STW",
    "CIO",
    "SHM",
    "TSH",
    "HEO",
    "MOS",
    "WKS",
  ],
};

/** The line a service belongs to: "TKL-LHP" is a Tseung Kwan O Line train. */
export function lineOf(service: string): string {
  return service.split("-")[0] as string;
}

/**
 * Minutes from one station to the next, in the order each line lists them.
 * One number per gap, so a line with sixteen stations has fifteen here.
 */
const RUNNING: Record<string, number[]> = {
  AEL: [3, 8, 13, 3],
  TCL: [4, 3, 3, 3, 4, 6, 5],
  DRL: [4],
  TWL: [2, 3, 2, 2, 2, 2, 2, 2, 2, 2, 3, 2, 2, 2, 2],
  KTL: [2, 3, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 3, 3],
  ISL: [2, 2, 2, 2, 2, 3, 3, 2, 2, 2, 2, 2, 2, 2, 3, 3],
  TKL: [2, 7, 3, 3, 3, 3],
  "TKL-LHP": [2, 7, 3, 3, 4],
  EAL: [2, 4, 3, 3, 4, 3, 3, 4, 5, 3, 4, 3, 5],
  "EAL-LMC": [2, 4, 3, 3, 4, 3, 3, 4, 5, 3, 4, 3, 7],
  SIL: [4, 3, 2, 2],
  TML: [3, 3, 3, 3, 4, 4, 4, 3, 3, 3, 3, 3, 3, 2, 2, 3, 3, 3, 3, 2, 2, 2, 2, 3, 2, 3],
};

/** Minutes between two adjacent stations on a service, either way round. */
const segments = new Map<string, number>();
for (const service in RAIL_LINES) {
  const stations = RAIL_LINES[service] as string[];
  const minutes = RUNNING[service] as number[];
  for (let i = 0; i + 1 < stations.length; i += 1) {
    const a = stations[i] as string;
    const b = stations[i + 1] as string;
    const gap = minutes[i];
    if (gap !== undefined) {
      segments.set(`${a}>${b}`, gap);
      segments.set(`${b}>${a}`, gap);
    }
  }
}

/** Running time between two adjacent stations, or `undefined` if not adjacent. */
export function segmentMinutes(from: string, to: string): number | undefined {
  return segments.get(`${from}>${to}`);
}

/**
 * Running time along one service from one of its stations to another,
 * whichever way round they are. `undefined` when either is not on it.
 */
export function rideMinutes(service: string, from: string, to: string): number | undefined {
  const stations = RAIL_LINES[service];
  if (!stations) return undefined;
  const a = stations.indexOf(from);
  const b = stations.indexOf(to);
  if (a < 0 || b < 0 || a === b) return undefined;
  const [lo, hi] = a < b ? [a, b] : [b, a];
  let total = 0;
  for (let i = lo; i < hi; i += 1) {
    total += segmentMinutes(stations[i] as string, stations[i + 1] as string) ?? 0;
  }
  return total;
}

/**
 * What a change costs at a station, in minutes on foot between the two
 * platforms - the number the MTR prints as 轉車步行.
 *
 * Keyed by station and then by the pair of lines, because the same station
 * can be a step across the platform for one pair and a walk through the
 * concourse for another: at Admiralty the Tsuen Wan and Island lines share a
 * platform, and the East Rail platform is three levels down. `*` is what any
 * pair not listed costs there.
 */
const INTERCHANGE: Record<string, Record<string, number>> = {
  CEN: { "ISL|TWL": 2 },
  ADM: { "ISL|TWL": 1, "EAL|SIL": 3, "*": 4 },
  TST: { "*": 1 },
  YMT: { "KTL|TWL": 1 },
  MOK: { "KTL|TWL": 1 },
  PRE: { "KTL|TWL": 1 },
  MEF: { "TML|TWL": 4 },
  LAK: { "TCL|TWL": 1 },
  NOP: { "ISL|TKL": 1 },
  QUB: { "ISL|TKL": 1 },
  YAT: { "KTL|TKL": 1 },
  TIK: { "KTL|TKL": 1 },
  TKO: { "TKL|TKL": 1 },
  KOT: { "EAL|KTL": 4 },
  TAW: { "EAL|TML": 2 },
  HUH: { "EAL|TML": 2 },
  HOM: { "KTL|TML": 3 },
  DIH: { "KTL|TML": 3 },
  NAC: { "TCL|TML": 1 },
  HOK: { "AEL|TCL": 1 },
  KOW: { "AEL|TCL": 1 },
  TSY: { "AEL|TCL": 1 },
  SUN: { "DRL|TCL": 2 },
  SHS: { "EAL|EAL": 1 },
  EXC: { "*": 4 },
};

/** A change between two lines that a station is not listed for. */
const INTERCHANGE_DEFAULT = 3;

/**
 * Minutes to change from one line to another at a station, or `undefined`
 * when neither line calls there. Same line, both ways - a branch train for
 * a main-line one - is a step across the platform.
 */
export function interchangeMinutes(
  station: string,
  fromService: string,
  toService: string,
): number | undefined {
  const a = RAIL_LINES[fromService];
  const b = RAIL_LINES[toService];
  if (!a?.includes(station) || !b?.includes(station)) return undefined;
  const pair = [lineOf(fromService), lineOf(toService)].sort().join("|");
  const at = INTERCHANGE[station];
  return at?.[pair] ?? at?.["*"] ?? INTERCHANGE_DEFAULT;
}

/**
 * Walking links between stations with different names - the paid or
 * unpaid corridors the MTR's own planner will route a journey through.
 * Minutes on foot, either way.
 */
export const WALK_LINKS: { from: string; to: string; minutes: number }[] = [
  { from: "CEN", to: "HOK", minutes: 10 },
  { from: "TST", to: "ETS", minutes: 8 },
  { from: "KOW", to: "AUS", minutes: 9 },
];

export function walkMinutes(from: string, to: string): number | undefined {
  const link = WALK_LINKS.find(
    (l) => (l.from === from && l.to === to) || (l.from === to && l.to === from),
  );
  return link?.minutes;
}

/** Every station any service calls at. */
export function railStations(): string[] {
  const out = new Set<string>();
  for (const service in RAIL_LINES)
    for (const code of RAIL_LINES[service] as string[]) out.add(code);
  return [...out];
}

/** The services calling at a station. */
export function servicesAt(station: string): string[] {
  return Object.keys(RAIL_LINES).filter((service) => RAIL_LINES[service]?.includes(station));
}

/** The lines the heavy rail runs, one per family of services, in table order. */
export function railLineCodes(): string[] {
  return [...new Set(Object.keys(RAIL_LINES).map(lineOf))];
}

/**
 * Every station on a line, in order, with its branches folded in: a branch's
 * own stations follow the last station it shares with the trunk, so LOHAS
 * Park comes after Tseung Kwan O and Lok Ma Chau after Sheung Shui. The line
 * as a rider lists it, rather than as the services that run on it.
 */
export function stationsOnLine(line: string): string[] {
  const services = Object.keys(RAIL_LINES)
    .filter((service) => lineOf(service) === line)
    .map((service) => RAIL_LINES[service] as string[])
    .sort((a, b) => b.length - a.length);
  const [trunk = [], ...branches] = services;
  const out = [...trunk];
  for (const branch of branches) {
    let after = -1;
    for (const code of branch) {
      const at = out.indexOf(code);
      if (at >= 0) {
        after = at;
        continue;
      }
      after += 1;
      out.splice(after, 0, code);
    }
  }
  return out;
}
