import type { Company, KeyedRoute, RouteDb, StopEntry } from "./types";
import type { LatLng } from "~/lib/geo";
import { boundingBox, distanceM } from "~/lib/geo";
import { operatorRank } from "~/lib/operators";
import { stopCode, stripStopCode } from "~/lib/i18n";
import { deleteDB, openDB, type IDBPDatabase } from "idb";

const DB_URL = "https://data.hkbus.app/routeFareList.min.json";
const STORE_KEY = "routeDb";
const IDB_NAME = "probus";
const IDB_VERSION = 1;
/*
 * The app's old name. A rider who installed it then has 1.7 MB of route data
 * cached under it; on the first run under the new name that copy is moved
 * across rather than fetched again, and the old database is dropped.
 */
const LEGACY_IDB_NAME = "motherbus";

export interface CachedDb {
  db: RouteDb;
  /** Server ETag, used to skip re-downloading ~1.7 MB on every launch. */
  etag: string | null;
  fetchedAt: number;
}

/**
 * One store, one key, holding the whole route database.
 *
 * `idb` is a promise wrapper over the native API and nothing more - the same
 * transactions and the same structured clone, without the event plumbing that
 * a hand-rolled `openIdb`/`get`/`put` had to spell out here. The connection is
 * also opened once and shared, where every call used to open its own.
 */
type Schema = { kv: { key: string; value: CachedDb } };

let connection: Promise<IDBPDatabase<Schema>> | undefined;

function idb(): Promise<IDBPDatabase<Schema>> {
  connection ??= openDB<Schema>(IDB_NAME, IDB_VERSION, {
    upgrade: (database) => {
      if (!database.objectStoreNames.contains("kv")) database.createObjectStore("kv");
    },
    // A connection the browser has closed under us - another tab upgrading, or
    // storage being cleared - must not be handed out again.
    terminated: () => {
      connection = undefined;
    },
  }).catch((error: unknown) => {
    // Nor may a refusal be remembered: a private window can decline the first
    // open of a session and allow a later one.
    connection = undefined;
    throw error;
  });
  return connection;
}

/**
 * Loads the route database, preferring the IndexedDB copy so the app opens
 * offline. A conditional request revalidates in the background; a 304 costs
 * nothing, and a failure leaves the cached copy in place.
 */
/**
 * The database could not be got: nothing cached and the download refused.
 *
 * Its own class so the boundary above the app can tell "the data is not
 * answering" - a network problem, worth waiting out and retrying on its own -
 * from a bug in the app, which no amount of retrying will fix.
 */
export class RouteDbError extends Error {
  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause), { cause });
    this.name = "RouteDbError";
  }
}

export async function loadRouteDb(): Promise<CachedDb> {
  const cached = await idb()
    .then(async (store) => (await store.get("kv", STORE_KEY)) ?? adoptLegacy(store))
    .catch(() => undefined);

  if (cached) {
    void revalidate(cached).catch(() => {});
    return cached;
  }
  return download(null).catch((error: unknown) => {
    throw new RouteDbError(error);
  });
}

/**
 * The cached database under the old name, carried into the new one.
 *
 * Only when the browser can say the old database exists: opening a name
 * that does not creates it, and this must not leave an empty one behind.
 * The copy is put under the new name first and the old one deleted after,
 * so a failure part-way loses nothing.
 */
async function adoptLegacy(store: IDBPDatabase<Schema>): Promise<CachedDb | undefined> {
  try {
    const known = await indexedDB.databases?.();
    if (!known?.some((entry) => entry.name === LEGACY_IDB_NAME)) return undefined;
    const legacy = await openDB<Schema>(LEGACY_IDB_NAME, IDB_VERSION);
    const cached = legacy.objectStoreNames.contains("kv")
      ? await legacy.get("kv", STORE_KEY)
      : undefined;
    legacy.close();
    if (!cached) return undefined;
    await store.put("kv", cached, STORE_KEY);
    await deleteDB(LEGACY_IDB_NAME);
    return cached;
  } catch {
    // Anything wrong with the old copy is a reason to download, not to fail.
    return undefined;
  }
}

async function revalidate(cached: CachedDb): Promise<void> {
  // Only worth a round trip once a day; the upstream crawler runs daily.
  if (Date.now() - cached.fetchedAt < 24 * 60 * 60 * 1000) return;
  const fresh = await download(cached.etag);
  if (fresh.fetchedAt !== cached.fetchedAt) window.dispatchEvent(new Event("probus:db-updated"));
}

async function download(etag: string | null): Promise<CachedDb> {
  const res = await fetch(DB_URL, {
    headers: etag ? { "If-None-Match": etag } : {},
  });

  if (res.status === 304) {
    const cached = await (await idb()).get("kv", STORE_KEY);
    if (cached) return cached;
    // Cache vanished between the request and now; refetch unconditionally.
    return download(null);
  }
  if (!res.ok) throw new Error(`route database ${res.status}`);

  const db = (await res.json()) as RouteDb;
  const next: CachedDb = { db, etag: res.headers.get("etag"), fetchedAt: Date.now() };
  await idb()
    .then((store) => store.put("kv", next, STORE_KEY))
    .catch(() => {
      // Storage full or blocked (private mode): run from memory this session.
    });
  return next;
}

/* ---- queries ---------------------------------------------------------- */

export function routeAt(db: RouteDb, key: string): KeyedRoute | undefined {
  const entry = db.routeList[key];
  return entry ? { ...entry, key } : undefined;
}

export interface NearbyStop {
  stopId: string;
  stop: StopEntry;
  metres: number;
}

/** Stops within `radiusM`, nearest first. */
export function nearbyStops(db: RouteDb, centre: LatLng, radiusM: number): NearbyStop[] {
  const box = boundingBox(centre, radiusM);
  const out: NearbyStop[] = [];

  for (const stopId in db.stopList) {
    const stop = db.stopList[stopId];
    if (!stop) continue;
    const { lat, lng } = stop.location;
    if (lat < box.minLat || lat > box.maxLat || lng < box.minLng || lng > box.maxLng) continue;

    const metres = distanceM(centre, stop.location);
    if (metres <= radiusM) out.push({ stopId, stop, metres });
  }
  return out.sort((a, b) => a.metres - b.metres);
}

export interface RouteAtStop {
  route: KeyedRoute;
  /** 1-based position of this stop along the route, as the ETA APIs expect. */
  seq: number;
  /**
   * The stop's id for each operator running this route. A 聯營 joint route is
   * one line to a passenger but two feeds to query, and each operator uses its
   * own id for the same kerb - so they are collected here rather than producing
   * a duplicate row per operator.
   */
  stopIdByCo: Partial<Record<Company, string>>;
  /** First operator that matched, used where a single one must be named. */
  co: Company;
  stopId: string;
}

/**
 * stopId -> the routes calling there. Built once per database and reused: the
 * nearby screen asks about a dozen stops at a time, and scanning all ~3,800
 * routes for each of them would cost tens of thousands of iterations per
 * position update.
 */
const stopIndexes = new WeakMap<RouteDb, Map<string, RouteAtStop[]>>();

export function stopIndex(db: RouteDb): Map<string, RouteAtStop[]> {
  const existing = stopIndexes.get(db);
  if (existing) return existing;

  const index = new Map<string, RouteAtStop[]>();
  for (const key in db.routeList) {
    const entry = db.routeList[key];
    if (!entry) continue;
    const route: KeyedRoute = { ...entry, key };

    for (const co of entry.co) {
      const stops = entry.stops[co];
      if (!stops) continue;
      for (let i = 0; i < stops.length; i++) {
        const id = stops[i];
        if (!id) continue;
        const at: RouteAtStop = { route, seq: i + 1, co, stopId: id, stopIdByCo: { [co]: id } };
        const bucket = index.get(id);
        if (bucket) bucket.push(at);
        else index.set(id, [at]);
      }
    }
  }

  stopIndexes.set(db, index);
  return index;
}

/**
 * Every route calling at `stopId`. Operators publish their own ids for the same
 * kerb, so `stopMap` aliases are followed as well as the id itself - otherwise
 * a joint route would appear only under whichever operator you happened to
 * arrive from.
 */
export function routesAtStop(db: RouteDb, stopId: string): RouteAtStop[] {
  const index = stopIndex(db);
  const aliases = new Set<string>([stopId]);
  for (const [, aliasId] of db.stopMap[stopId] ?? []) aliases.add(aliasId);

  // Keyed by route, so a joint route reached through both operators' ids
  // becomes one entry that knows both ids rather than two identical rows.
  const merged = new Map<string, RouteAtStop>();

  for (const alias of aliases) {
    for (const at of index.get(alias) ?? []) {
      const existing = merged.get(at.route.key);
      if (existing) {
        existing.stopIdByCo[at.co] ??= at.stopId;
      } else {
        merged.set(at.route.key, { ...at, stopIdByCo: { ...at.stopIdByCo } });
      }
    }
  }

  /*
   * A joint route may only have matched one operator's id here. The other
   * operator uses the same index into its own stop list, so fill it in - it is
   * what lets both feeds be queried for the same kerb.
   */
  for (const at of merged.values()) {
    for (const co of at.route.co) {
      if (at.stopIdByCo[co]) continue;
      const id = at.route.stops[co]?.[at.seq - 1];
      if (id) at.stopIdByCo[co] = id;
    }
  }

  return [...merged.values()];
}

/**
 * The order a list of routes reads in: by number as a rider counts them (2
 * before 10), a shared number by how likely each operator is meant, and the
 * same route's two directions by where they start.
 */
export function compareRoutes(a: KeyedRoute, b: KeyedRoute): number {
  return (
    a.route.localeCompare(b.route, "en", { numeric: true }) ||
    operatorRank(a.co[0] as Company) - operatorRank(b.co[0] as Company) ||
    a.orig.en.localeCompare(b.orig.en)
  );
}

/** Every route there is, in reading order. The list a search narrows. */
export function allRoutes(db: RouteDb): KeyedRoute[] {
  const out: KeyedRoute[] = [];
  for (const key in db.routeList) {
    const entry = db.routeList[key];
    if (entry) out.push({ ...entry, key });
  }
  return out.sort(compareRoutes);
}

/** Case-insensitive route-number search, exact matches first. */
export function searchRoutes(db: RouteDb, query: string, limit = 60): KeyedRoute[] {
  const q = query.trim().toUpperCase();
  if (!q) return [];

  const exact: KeyedRoute[] = [];
  const prefix: KeyedRoute[] = [];
  for (const key in db.routeList) {
    const entry = db.routeList[key];
    if (!entry) continue;
    const route = entry.route.toUpperCase();
    if (route === q) exact.push({ ...entry, key });
    else if (route.startsWith(q)) prefix.push({ ...entry, key });
  }

  return [...exact.sort(compareRoutes), ...prefix.sort(compareRoutes)].slice(0, limit);
}

/**
 * Whether an entry is a special pattern of its route rather than the main
 * service - service type "1" is the timetable's backbone, everything else is
 * an extra the operator runs at certain hours, often calling at a few stops
 * the main pattern skips. The database keys each pattern separately, so a
 * list that shows them all needs this to stop a variant with the same two
 * ends reading as an exact double of the main row.
 */
export function isSpecialService(route: KeyedRoute): boolean {
  return String(route.serviceType) !== "1";
}

/** Which characters could still extend `query` into a real route number. */
export function nextRouteChars(db: RouteDb, query: string): Set<string> {
  const q = query.trim().toUpperCase();
  const out = new Set<string>();
  for (const key in db.routeList) {
    const route = db.routeList[key]?.route.toUpperCase();
    if (route && route.length > q.length && route.startsWith(q)) out.add(route[q.length]!);
  }
  return out;
}

/**
 * Forces a fresh download, ignoring the cached ETag. Used by the manual
 * "update now" control in settings.
 */
export async function refreshRouteDb(): Promise<CachedDb> {
  return download(null);
}

/**
 * Drops the cached copy, so the next start downloads the database again.
 *
 * The store rather than the whole IndexedDB: the connection is shared and
 * long-lived, and deleting the database under it would block on this tab's own
 * open handle. The caller is expected to reload - the app read the database
 * once at start-up, and every screen is still holding the copy this just
 * deleted from disk.
 */
export async function clearRouteDb(): Promise<void> {
  const store = await idb();
  await store.delete("kv", STORE_KEY);
}

/** Rough size of the cached payload, for display in settings. */
export function describeDb(db: RouteDb): { routes: number; stops: number } {
  return {
    routes: Object.keys(db.routeList).length,
    stops: Object.keys(db.stopList).length,
  };
}

/**
 * The same route number running the other way. Matched on operator, route
 * number and service type with the origin and destination swapped, which is how
 * the database expresses a direction pair.
 */
export function reverseRoute(db: RouteDb, route: KeyedRoute): KeyedRoute | undefined {
  for (const key in db.routeList) {
    const entry = db.routeList[key];
    if (!entry || key === route.key) continue;
    if (entry.route !== route.route) continue;
    if (String(entry.serviceType) !== String(route.serviceType)) continue;
    if (entry.co[0] !== route.co[0]) continue;
    if (entry.orig.en === route.dest.en && entry.dest.en === route.orig.en) {
      return { ...entry, key };
    }
  }
  return undefined;
}

/** The stop entries along a route, in order, for the operator that runs it. */
export function routeStops(db: RouteDb, route: KeyedRoute): { id: string; stop: StopEntry }[] {
  const co = route.co[0];
  const ids = co ? (route.stops[co] ?? []) : [];
  return ids.flatMap((id) => {
    const stop = db.stopList[id];
    return stop ? [{ id, stop }] : [];
  });
}

export interface StopMatch {
  stopId: string;
  stop: StopEntry;
  /** How many routes call there, used to rank the busier interchanges first. */
  routeCount: number;
}

/**
 * Stops whose name contains the query, in either language - or whose pole code
 * is what was typed.
 *
 * Ranked by how well the name matches and then by how many routes call there:
 * typing "彌敦道" should surface the major interchange before a quiet kerb of
 * the same name.
 */
/**
 * Whether a query is long enough to search names with.
 *
 * Two characters of Latin script: one letter is in half the stops in Hong Kong
 * and answers nothing. One character of Chinese, because one Chinese character
 * is a word - 白 is 白田, 白石角, 白沙灣, and a rider who has typed it has
 * already said something specific. A flat minimum of two returned nothing at
 * all for the single character, which is most of what anyone types on the way
 * to a Chinese place name.
 */
function longEnough(q: string): boolean {
  return q.length >= (/[\u3400-\u9fff]/.test(q) ? 1 : 2);
}

export function searchStops(db: RouteDb, query: string, limit = 12): StopMatch[] {
  const q = query.trim().toLowerCase();
  if (!longEnough(q)) return [];

  const index = stopIndex(db);
  const out: (StopMatch & { rank: number })[] = [];

  for (const stopId in db.stopList) {
    const stop = db.stopList[stopId];
    if (!stop) continue;

    /*
     * The pole code - the "(WT916)" on the end of a KMB name - comes off the
     * name and is matched on its own. It is the only thing on a stop flag that
     * belongs to that pole and no other, so a rider who types it means exactly
     * one stop; left inside the name it also spoiled the exact and prefix
     * tests below, because no displayed name ever ends in a bracketed code.
     */
    const zh = stripStopCode(stop.name.zh).toLowerCase();
    const en = stripStopCode(stop.name.en).toLowerCase();
    const code = (stopCode(stop.name.en) ?? stopCode(stop.name.zh) ?? "").toLowerCase();

    if (!zh.includes(q) && !en.includes(q) && !(code !== "" && code.includes(q))) continue;

    const routeCount = index.get(stopId)?.length ?? 0;
    if (routeCount === 0) continue;

    /*
     * How well the name matches comes first, and only then how busy the stop
     * is. Ranking by route count alone buried every railway station: searching
     * 金鐘 returned six bus stops whose names contain it - 28 to 66 routes each
     * - and dropped Admiralty station itself, which is called exactly that and
     * is served by four lines.
     */
    const rank =
      code === q || zh === q || en === q
        ? 0
        : code.startsWith(q) || zh.startsWith(q) || en.startsWith(q)
          ? 1
          : 2;

    out.push({ stopId, stop, routeCount, rank });
  }

  // Scored in the pass above rather than inside the comparator, which would
  // have stripped and lowercased every name again on every comparison.
  return out
    .sort((a, b) => a.rank - b.rank || b.routeCount - a.routeCount)
    .slice(0, limit)
    .map(({ stopId, stop, routeCount }) => ({ stopId, stop, routeCount }));
}

/** Routes whose origin or destination contains the query, in either language. */
export function searchDestinations(db: RouteDb, query: string, limit = 20): KeyedRoute[] {
  const q = query.trim().toLowerCase();
  if (!longEnough(q)) return [];

  const seen = new Set<string>();
  const out: KeyedRoute[] = [];

  for (const key in db.routeList) {
    const entry = db.routeList[key];
    if (!entry) continue;
    const hit =
      entry.dest.zh.toLowerCase().includes(q) ||
      entry.dest.en.toLowerCase().includes(q) ||
      entry.orig.zh.toLowerCase().includes(q) ||
      entry.orig.en.toLowerCase().includes(q);
    if (!hit) continue;

    const identity = `${entry.route}/${entry.dest.en}/${entry.co[0]}`;
    if (seen.has(identity)) continue;
    seen.add(identity);
    out.push({ ...entry, key });
    if (out.length >= limit) break;
  }

  return out.sort((a, b) => a.route.localeCompare(b.route, "en", { numeric: true }));
}

export interface StopCluster {
  /** The nearest member, whose name and position represent the cluster. */
  stopId: string;
  stop: StopEntry;
  metres: number;
  /** Every id for this kerb, across operators. */
  memberIds: string[];
}

/**
 * Nearby stops, with the same physical kerb collapsed into one entry.
 *
 * Operators each publish their own stop for a shared kerb - Citybus calls it
 * 眾坊街, 彌敦道 and KMB calls it 油麻地眾坊街 (YT137), metres apart - and the
 * database records that they are the same place in `stopMap`. Listing them
 * separately shows the rider the same routes twice under two names, which is
 * exactly the kind of raw-data leakage that makes an app feel unfinished.
 */
export function nearbyStopClusters(db: RouteDb, centre: LatLng, radiusM: number): StopCluster[] {
  const found = nearbyStops(db, centre, radiusM);
  const claimed = new Set<string>();
  const clusters: StopCluster[] = [];

  for (const entry of found) {
    if (claimed.has(entry.stopId)) continue;

    // Nearest first, so the first unclaimed stop names the cluster.
    const members = new Set<string>([entry.stopId]);
    for (const [, alias] of db.stopMap[entry.stopId] ?? []) members.add(alias);

    for (const id of members) claimed.add(id);
    clusters.push({ ...entry, memberIds: [...members] });
  }

  return clusters;
}

/** Routes across every id of a clustered kerb, de-duplicated by route. */
export function routesAtCluster(db: RouteDb, memberIds: string[]): RouteAtStop[] {
  const merged = new Map<string, RouteAtStop>();

  for (const id of memberIds) {
    for (const at of routesAtStop(db, id)) {
      const existing = merged.get(at.route.key);
      if (existing) {
        for (const [co, stopId] of Object.entries(at.stopIdByCo)) {
          existing.stopIdByCo[co as Company] ??= stopId;
        }
      } else {
        merged.set(at.route.key, { ...at, stopIdByCo: { ...at.stopIdByCo } });
      }
    }
  }
  return [...merged.values()];
}
