import { exportBackup, importBackup, type AppBackup, type BackupImportMode } from "./backup";

/**
 * Why a remote copy could not be read or written.
 *
 * The UI maps each of these to a sentence; the codes themselves stay out of
 * the rider's way. `cors` is the one a self-hosted endpoint most often hits
 * from a page: the request never left, or the browser hid the answer.
 */
export type RemoteSyncCode = "cors" | "auth" | "missing" | "invalid" | "http" | "incomplete";

export class RemoteSyncError extends Error {
  constructor(
    readonly code: RemoteSyncCode,
    cause?: unknown,
  ) {
    super(code, { cause });
    this.name = "RemoteSyncError";
  }
}

export function classifyHttp(status: number): RemoteSyncError {
  if (status === 401 || status === 403) return new RemoteSyncError("auth");
  if (status === 404) return new RemoteSyncError("missing");
  return new RemoteSyncError("http");
}

export function classifyFetchFailure(error: unknown): RemoteSyncError {
  if (error instanceof RemoteSyncError) return error;
  if (error instanceof TypeError) return new RemoteSyncError("cors", error);
  return new RemoteSyncError("http", error);
}

export const REMOTE_BACKUP_NAME = "probus-backup.json";

export type SyncKind = "none" | "webdav" | "s3";

export interface SyncConfig {
  kind: SyncKind;
  /** WebDAV folder URL. The backup filename is never taken from this path. */
  webdavUrl: string;
  /** Optional path under `webdavUrl`. Empty means the folder URL itself. */
  webdavFolder: string;
  webdavUser: string;
  webdavPassword: string;
  s3Endpoint: string;
  s3Region: string;
  s3Bucket: string;
  s3Key: string;
  s3AccessKey: string;
  s3SecretKey: string;
  s3PathStyle: boolean;
}

export function syncReady(config: SyncConfig): boolean {
  if (config.kind === "webdav") return config.webdavUrl.trim() !== "";
  if (config.kind === "s3") {
    return (
      config.s3Endpoint.trim() !== "" &&
      config.s3Bucket.trim() !== "" &&
      config.s3AccessKey.trim() !== "" &&
      config.s3SecretKey.trim() !== ""
    );
  }
  return false;
}

/**
 * Puts the current backup on the configured endpoint, replacing whatever
 * file is already there. Credentials never travel with it.
 */
export async function pushRemote(config: SyncConfig): Promise<void> {
  if (!syncReady(config)) throw new RemoteSyncError("incomplete");
  const body = JSON.stringify(exportBackup());
  if (config.kind === "webdav") {
    const { putWebdav } = await import("./webdav");
    await putWebdav(config, body);
    return;
  }
  const { putS3 } = await import("./s3");
  await putS3(config, body);
}

/**
 * Asks whether the endpoint will talk to this origin with these credentials.
 *
 * A missing file is still a connection: the folder is there, nothing has
 * been written yet. A body that is not JSON is the same - we reached it.
 * Does not merge or upload.
 */
export async function probeRemote(config: SyncConfig): Promise<void> {
  if (!syncReady(config)) throw new RemoteSyncError("incomplete");
  try {
    await pullRemote(config);
  } catch (error) {
    if (error instanceof RemoteSyncError && error.code === "invalid") return;
    throw error;
  }
}

/**
 * Reads the remote backup, or `null` when there is not one yet.
 */
export async function pullRemote(config: SyncConfig): Promise<AppBackup | null> {
  if (!syncReady(config)) throw new RemoteSyncError("incomplete");
  const text =
    config.kind === "webdav"
      ? await (await import("./webdav")).getWebdav(config)
      : await (await import("./s3")).getS3(config);
  if (text === null) return null;
  try {
    return JSON.parse(text) as AppBackup;
  } catch (error) {
    throw new RemoteSyncError("invalid", error);
  }
}

export function applyRemoteBackup(raw: unknown, mode: BackupImportMode) {
  try {
    return importBackup(raw, mode);
  } catch (error) {
    throw new RemoteSyncError("invalid", error);
  }
}

/**
 * The backup as a string that ignores `exportedAt`. Every export stamps the
 * clock, so comparing the files themselves would say they differ when nothing
 * a rider stored has.
 */
export function backupFingerprint(backup: AppBackup): string {
  return JSON.stringify({
    version: backup.version,
    settings: backup.settings,
    starred: backup.starred,
    alerts: backup.alerts,
    searches: backup.searches,
    trips: backup.trips,
    frequent: backup.frequent,
    dismissed: backup.dismissed,
  });
}

/*
 * Push and pull share one gate so a manual upload and an automatic cycle
 * cannot interleave: the second waits, then sees the file the first wrote.
 */
let lock: Promise<unknown> = Promise.resolve();

export function withRemoteLock<T>(work: () => Promise<T>): Promise<T> {
  const run = lock.then(work, work);
  lock = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/**
 * Brings the remote copy in (merge), then writes the union back if the two
 * still differ. A missing remote file is the first upload, not an error.
 */
export async function cycleRemote(
  config: SyncConfig,
): Promise<"unchanged" | "pushed" | "pulled" | "both"> {
  if (!syncReady(config)) throw new RemoteSyncError("incomplete");
  const remote = await pullRemote(config);
  if (remote) applyRemoteBackup(remote, "merge");
  const local = backupFingerprint(exportBackup());
  const remoteFp = remote ? backupFingerprint(remote) : null;
  if (remoteFp === local) return remote ? "pulled" : "unchanged";
  await pushRemote(config);
  return remote ? "both" : "pushed";
}
