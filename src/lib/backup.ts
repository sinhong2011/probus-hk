import type { Company } from "~/data/types";
import type { Lang } from "~/lib/i18n";
import { alerts, type AlertItem, type AlertKind } from "~/stores/alerts";
import { dismissed } from "~/stores/dismissed";
import { frequent, type Visit } from "~/stores/frequent";
import { type Search, searches } from "~/stores/searches";
import {
  applySettings,
  snapshotSettings,
  type NearbyMode,
  type SettingsSnapshot,
  type StarredOrder,
  type ThemeChoice,
} from "~/stores/settings";
import { starred, type StarredImportResult } from "~/stores/starred";
import { trips, type SavedTrip, type TripEnd } from "~/stores/trips";

export const BACKUP_VERSION = 1;

export interface AppBackup {
  version: typeof BACKUP_VERSION;
  exportedAt: string;
  settings: SettingsSnapshot;
  starred: ReturnType<typeof starred.export>["items"];
  alerts: AlertItem[];
  searches: Search[];
  trips: SavedTrip[];
  frequent: Visit[];
  dismissed: string[];
}

export type BackupImportMode = "merge" | "replace";

export interface BackupImportResult {
  mode: BackupImportMode;
  starred: StarredImportResult;
  settings: boolean;
  alerts: number;
  searches: number;
  trips: number;
  frequent: number;
  dismissed: number;
}

const COMPANIES = new Set<Company>([
  "kmb",
  "ctb",
  "nlb",
  "gmb",
  "mtr",
  "lightRail",
  "lrtfeeder",
  "sunferry",
  "hkkf",
  "fortuneferry",
]);

function isCompany(value: unknown): value is Company {
  return typeof value === "string" && COMPANIES.has(value as Company);
}

function parseSettings(raw: unknown): SettingsSnapshot {
  if (!raw || typeof raw !== "object") return {};
  const input = raw as Record<string, unknown>;
  const out: SettingsSnapshot = {};

  if (input.lang === "zh" || input.lang === "en") out.lang = input.lang as Lang;
  if (input.theme === "auto" || input.theme === "light" || input.theme === "dark") {
    out.theme = input.theme as ThemeChoice;
  }
  if (typeof input.radiusM === "number" && Number.isFinite(input.radiusM))
    out.radiusM = input.radiusM;
  if (typeof input.refreshSeconds === "number" && Number.isFinite(input.refreshSeconds)) {
    out.refreshSeconds = input.refreshSeconds;
  }
  if (typeof input.showScheduled === "boolean") out.showScheduled = input.showScheduled;
  if (typeof input.clockTimes === "boolean") out.clockTimes = input.clockTimes;
  if (typeof input.vehiclesOnMap === "boolean") out.vehiclesOnMap = input.vehiclesOnMap;
  if (typeof input.vehiclesOnList === "boolean") out.vehiclesOnList = input.vehiclesOnList;
  if (typeof input.vehiclesAway === "boolean") out.vehiclesAway = input.vehiclesAway;
  if (input.nearbyMode === "stop" || input.nearbyMode === "routes") {
    out.nearbyMode = input.nearbyMode as NearbyMode;
  }
  if (
    input.starredOrder === "manual" ||
    input.starredOrder === "eta" ||
    input.starredOrder === "distance" ||
    input.starredOrder === "route"
  ) {
    out.starredOrder = input.starredOrder as StarredOrder;
  }
  if (typeof input.alertLeadMinutes === "number" && Number.isFinite(input.alertLeadMinutes)) {
    out.alertLeadMinutes = input.alertLeadMinutes;
  }
  if (typeof input.alertRadiusM === "number" && Number.isFinite(input.alertRadiusM)) {
    out.alertRadiusM = input.alertRadiusM;
  }
  if (typeof input.railOpen === "boolean") out.railOpen = input.railOpen;
  if (input.groupColors && typeof input.groupColors === "object") {
    const colors: Record<string, string> = {};
    for (const [name, color] of Object.entries(input.groupColors as Record<string, unknown>)) {
      if (typeof color === "string") colors[name] = color;
    }
    out.groupColors = colors;
  }

  return out;
}

function parseAlert(raw: unknown): AlertItem | null {
  if (!raw || typeof raw !== "object") return null;
  const item = raw as Partial<AlertItem>;
  if (item.kind !== "arrival" && item.kind !== "destination") return null;
  if (typeof item.routeKey !== "string" || typeof item.stopId !== "string" || !item.stopId) {
    return null;
  }
  if (typeof item.seq !== "number" || !Number.isFinite(item.seq)) return null;
  if (!isCompany(item.co)) return null;
  if (typeof item.leadMinutes !== "number" || !Number.isFinite(item.leadMinutes)) return null;
  if (typeof item.radiusM !== "number" || !Number.isFinite(item.radiusM)) return null;

  const id =
    typeof item.id === "string" && item.id
      ? item.id
      : `${item.kind}:${item.routeKey}@${item.stopId}`;
  const createdAt =
    typeof item.createdAt === "number" && Number.isFinite(item.createdAt)
      ? item.createdAt
      : Date.now();

  return {
    id,
    kind: item.kind as AlertKind,
    routeKey: item.routeKey,
    co: item.co,
    stopId: item.stopId,
    seq: item.seq,
    leadMinutes: item.leadMinutes,
    radiusM: item.radiusM,
    createdAt,
  };
}

function parseSearch(raw: unknown): Search | null {
  if (!raw || typeof raw !== "object") return null;
  const item = raw as Partial<Search>;
  if (typeof item.query !== "string" || !item.query) return null;
  if (typeof item.last !== "number" || !Number.isFinite(item.last)) return null;
  return { query: item.query, last: item.last };
}

function parseTripEnd(raw: unknown): TripEnd | null {
  if (!raw || typeof raw !== "object") return null;
  const end = raw as TripEnd;
  if (end.kind === "me") return { kind: "me" };
  if (end.kind === "stop" && typeof end.id === "string" && end.id) {
    return { kind: "stop", id: end.id };
  }
  return null;
}

function parseTrip(raw: unknown): SavedTrip | null {
  if (!raw || typeof raw !== "object") return null;
  const item = raw as Partial<SavedTrip>;
  const from = parseTripEnd(item.from);
  const to = parseTripEnd(item.to);
  if (!from || !to || typeof item.label !== "string") return null;
  const id =
    typeof item.id === "string" && item.id
      ? item.id
      : `${from.kind === "me" ? "me" : from.id}>${to.kind === "me" ? "me" : to.id}`;
  return { id, from, to, label: item.label };
}

function parseVisit(raw: unknown): Visit | null {
  if (!raw || typeof raw !== "object") return null;
  const item = raw as Partial<Visit>;
  if (typeof item.key !== "string" || !item.key) return null;
  if (typeof item.count !== "number" || !Number.isFinite(item.count)) return null;
  if (typeof item.last !== "number" || !Number.isFinite(item.last)) return null;
  return { key: item.key, count: item.count, last: item.last };
}

function parseDismissed(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((id): id is string => typeof id === "string" && id.length > 0);
}

function parseFullBackup(raw: Record<string, unknown>): AppBackup {
  const starredItems = Array.isArray(raw.starred) ? raw.starred : [];
  return {
    version: BACKUP_VERSION,
    exportedAt: typeof raw.exportedAt === "string" ? raw.exportedAt : new Date().toISOString(),
    settings: parseSettings(raw.settings),
    starred: starredItems as AppBackup["starred"],
    alerts: Array.isArray(raw.alerts)
      ? raw.alerts.map(parseAlert).filter((item): item is AlertItem => item !== null)
      : [],
    searches: Array.isArray(raw.searches)
      ? raw.searches.map(parseSearch).filter((item): item is Search => item !== null)
      : [],
    trips: Array.isArray(raw.trips)
      ? raw.trips.map(parseTrip).filter((item): item is SavedTrip => item !== null)
      : [],
    frequent: Array.isArray(raw.frequent)
      ? raw.frequent.map(parseVisit).filter((item): item is Visit => item !== null)
      : [],
    dismissed: parseDismissed(raw.dismissed),
  };
}

function isFullBackup(raw: Record<string, unknown>): boolean {
  return (
    "settings" in raw ||
    "starred" in raw ||
    "alerts" in raw ||
    "searches" in raw ||
    "trips" in raw ||
    "frequent" in raw ||
    "dismissed" in raw
  );
}

export function exportBackup(): AppBackup {
  return {
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    settings: snapshotSettings(),
    starred: starred.export().items,
    alerts: alerts.items(),
    searches: searches.entries(),
    trips: trips.items(),
    frequent: frequent.visits(),
    dismissed: dismissed.ids(),
  };
}

export function downloadBackup() {
  const payload = exportBackup();
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `probus-backup-${payload.exportedAt.slice(0, 10)}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function importFullBackup(data: AppBackup, mode: BackupImportMode): BackupImportResult {
  const starredResult = starred.import({ items: data.starred }, mode);
  applySettings(data.settings, mode);

  if (mode === "replace") {
    alerts.replaceAll(data.alerts);
    searches.replaceAll(data.searches);
    trips.replaceAll(data.trips);
    frequent.replaceAll(data.frequent);
    dismissed.replaceAll(data.dismissed);
  } else {
    alerts.mergeAll(data.alerts);
    searches.mergeAll(data.searches);
    trips.mergeAll(data.trips);
    frequent.mergeAll(data.frequent);
    dismissed.mergeAll(data.dismissed);
  }

  return {
    mode,
    starred: starredResult,
    settings: Object.keys(data.settings).length > 0,
    alerts: data.alerts.length,
    searches: data.searches.length,
    trips: data.trips.length,
    frequent: data.frequent.length,
    dismissed: data.dismissed.length,
  };
}

export function importBackup(raw: unknown, mode: BackupImportMode = "merge"): BackupImportResult {
  if (Array.isArray(raw)) {
    return {
      mode,
      starred: starred.import(raw, mode),
      settings: false,
      alerts: 0,
      searches: 0,
      trips: 0,
      frequent: 0,
      dismissed: 0,
    };
  }

  if (!raw || typeof raw !== "object") throw new Error("invalid backup");

  const record = raw as Record<string, unknown>;
  if (isFullBackup(record)) {
    return importFullBackup(parseFullBackup(record), mode);
  }

  if ("items" in record) {
    return {
      mode,
      starred: starred.import(raw, mode),
      settings: false,
      alerts: 0,
      searches: 0,
      trips: 0,
      frequent: 0,
      dismissed: 0,
    };
  }

  throw new Error("invalid backup");
}
