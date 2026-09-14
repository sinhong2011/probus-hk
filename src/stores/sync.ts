import { createMemo, createRoot } from "solid-js";
import { persistedCollection } from "./collection";
import type { SyncConfig, SyncKind } from "~/lib/remoteSync";

export type { SyncConfig, SyncKind };

interface Persisted extends SyncConfig {
  lastSyncedAt: number | null;
  /** Merge-then-push after local changes and when the app comes back. */
  auto: boolean;
}

const DEFAULTS: Persisted = {
  kind: "none",
  webdavUrl: "",
  webdavUser: "",
  webdavPassword: "",
  s3Endpoint: "",
  s3Region: "",
  s3Bucket: "",
  s3Key: "",
  s3AccessKey: "",
  s3SecretKey: "",
  s3PathStyle: true,
  lastSyncedAt: null,
  auto: false,
};

type Row = { id: "sync" } & Partial<Persisted>;
const ROW = "sync";

const store = persistedCollection<Row>({
  id: "sync",
  storageKey: "probus:db:sync",
  getKey: (row) => row.id,
});

function field<K extends keyof Persisted>(key: K) {
  const read = createRoot(() =>
    createMemo(() => (store.rows()[0]?.[key] ?? DEFAULTS[key]) as Persisted[K]),
  );
  const write = (value: Persisted[K]) => {
    if (store.collection.has(ROW)) {
      store.collection.update(ROW, (draft) => {
        (draft as Partial<Persisted>)[key] = value;
      });
    } else {
      store.collection.insert({ id: ROW, [key]: value } as Row);
    }
  };
  return [read, write] as const;
}

const [kind, setKind] = field("kind");
const [webdavUrl, setWebdavUrl] = field("webdavUrl");
const [webdavUser, setWebdavUser] = field("webdavUser");
const [webdavPassword, setWebdavPassword] = field("webdavPassword");
const [s3Endpoint, setS3Endpoint] = field("s3Endpoint");
const [s3Region, setS3Region] = field("s3Region");
const [s3Bucket, setS3Bucket] = field("s3Bucket");
const [s3Key, setS3Key] = field("s3Key");
const [s3AccessKey, setS3AccessKey] = field("s3AccessKey");
const [s3SecretKey, setS3SecretKey] = field("s3SecretKey");
const [s3PathStyle, setS3PathStyle] = field("s3PathStyle");
const [lastSyncedAt, setLastSyncedAt] = field("lastSyncedAt");
const [auto, setAuto] = field("auto");

export function snapshotSync(): SyncConfig {
  return {
    kind: kind(),
    webdavUrl: webdavUrl(),
    webdavUser: webdavUser(),
    webdavPassword: webdavPassword(),
    s3Endpoint: s3Endpoint(),
    s3Region: s3Region(),
    s3Bucket: s3Bucket(),
    s3Key: s3Key(),
    s3AccessKey: s3AccessKey(),
    s3SecretKey: s3SecretKey(),
    s3PathStyle: s3PathStyle(),
  };
}

export const sync = {
  kind,
  setKind,
  webdavUrl,
  setWebdavUrl,
  webdavUser,
  setWebdavUser,
  webdavPassword,
  setWebdavPassword,
  s3Endpoint,
  setS3Endpoint,
  s3Region,
  setS3Region,
  s3Bucket,
  setS3Bucket,
  s3Key,
  setS3Key,
  s3AccessKey,
  setS3AccessKey,
  s3SecretKey,
  setS3SecretKey,
  s3PathStyle,
  setS3PathStyle,
  lastSyncedAt,
  markSynced: () => setLastSyncedAt(Date.now()),
  auto,
  setAuto,
  snapshot: snapshotSync,
};

export function installSyncEffects() {
  store.install();
}
