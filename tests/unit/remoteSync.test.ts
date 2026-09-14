import { afterEach, describe, expect, it, vi } from "vitest";
import { RemoteSyncError, classifyHttp, syncReady, type SyncConfig } from "~/lib/remoteSync";

const empty: SyncConfig = {
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
