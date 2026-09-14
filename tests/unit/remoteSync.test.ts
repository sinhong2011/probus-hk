import { afterEach, describe, expect, it, vi } from "vitest";
import {
  RemoteSyncError,
  backupFingerprint,
  classifyHttp,
  syncReady,
  type SyncConfig,
} from "~/lib/remoteSync";
import type { AppBackup } from "~/lib/backup";

const empty: SyncConfig = {
  kind: "none",
  webdavUrl: "",
  webdavFolder: "",
  webdavUser: "",
  webdavPassword: "",
  s3Endpoint: "",
  s3Region: "",
  s3Bucket: "",
  s3Key: "",
  s3AccessKey: "",
  s3SecretKey: "",
  s3PathStyle: true,
};

describe("syncReady", () => {
  it("needs a URL for WebDAV and the four S3 fields for S3", () => {
    expect(syncReady(empty)).toBe(false);
    expect(syncReady({ ...empty, kind: "webdav", webdavUrl: "https://cloud.example/dav/" })).toBe(
      true,
    );
    expect(
      syncReady({
        ...empty,
        kind: "s3",
        s3Endpoint: "https://s3.amazonaws.com",
        s3Bucket: "rides",
        s3AccessKey: "AKIA",
        s3SecretKey: "secret",
      }),
    ).toBe(true);
    expect(
      syncReady({
        ...empty,
        kind: "s3",
        s3Endpoint: "https://s3.amazonaws.com",
        s3Bucket: "rides",
        s3AccessKey: "AKIA",
        s3SecretKey: "",
      }),
    ).toBe(false);
  });
});

describe("classifyHttp", () => {
  it("names auth and a missing file apart from a generic failure", () => {
    expect(classifyHttp(401)).toEqual(expect.any(RemoteSyncError));
    expect(classifyHttp(401).code).toBe("auth");
    expect(classifyHttp(404).code).toBe("missing");
    expect(classifyHttp(500).code).toBe("http");
  });
});

describe("backupFingerprint", () => {
  it("ignores the export clock so two copies of the same data match", () => {
    const base: AppBackup = {
      version: 1,
      exportedAt: "2026-01-01T00:00:00.000Z",
      settings: { lang: "zh" },
      starred: [],
      alerts: [],
      searches: [],
      trips: [],
      frequent: [],
      dismissed: [],
    };
    expect(backupFingerprint({ ...base, exportedAt: "2026-09-14T00:00:00.000Z" })).toBe(
      backupFingerprint(base),
    );
    expect(backupFingerprint({ ...base, settings: { lang: "en" } })).not.toBe(
      backupFingerprint(base),
    );
  });
});

describe("cycleRemote", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  const dav: SyncConfig = {
    ...empty,
    kind: "webdav",
    webdavUrl: "https://cloud.example/dav/",
  };

  it("uploads when the remote file is not there yet", async () => {
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if ((init?.method ?? "GET") === "PUT") return new Response(null, { status: 201 });
      return new Response(null, { status: 404 });
    });
    vi.stubGlobal("fetch", fetch);
    const { cycleRemote } = await import("~/lib/remoteSync");
    await expect(cycleRemote(dav)).resolves.toBe("pushed");
    expect(fetch.mock.calls.some(([, init]) => init?.method === "PUT")).toBe(true);
  });

  it("skips the upload when the remote file already matches", async () => {
    const { exportBackup } = await import("~/lib/backup");
    const body = JSON.stringify(exportBackup());
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if ((init?.method ?? "GET") === "PUT") return new Response(null, { status: 201 });
      return new Response(body, { status: 200, headers: { "Content-Type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetch);
    const { cycleRemote } = await import("~/lib/remoteSync");
    await expect(cycleRemote(dav)).resolves.toBe("pulled");
    expect(fetch.mock.calls.some(([, init]) => init?.method === "PUT")).toBe(false);
  });
});

describe("pullRemote", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("treats a remote file that is not JSON as invalid", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("not json", { status: 200 })),
    );
    const { pullRemote } = await import("~/lib/remoteSync");
    await expect(
      pullRemote({ ...empty, kind: "webdav", webdavUrl: "https://cloud.example/dav/file.json" }),
    ).rejects.toMatchObject({ code: "invalid" });
  });
});
