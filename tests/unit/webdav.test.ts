import { afterEach, describe, expect, it, vi } from "vitest";
import { REMOTE_BACKUP_NAME } from "~/lib/remoteSync";
import { getWebdav, putWebdav, webdavAuthHeader, webdavFileUrl } from "~/lib/webdav";
import type { SyncConfig } from "~/lib/remoteSync";

const dav: SyncConfig = {
  kind: "webdav",
  webdavUrl: "https://cloud.example/remote.php/dav/files/you/",
  webdavUser: "you",
  webdavPassword: "secret",
  s3Endpoint: "",
  s3Region: "",
  s3Bucket: "",
  s3Key: "",
  s3AccessKey: "",
  s3SecretKey: "",
  s3PathStyle: true,
};

describe("webdavFileUrl", () => {
  it("appends the backup name to a directory and leaves a file alone", () => {
    expect(webdavFileUrl("https://cloud.example/dav/files/you/")).toBe(
      `https://cloud.example/dav/files/you/${REMOTE_BACKUP_NAME}`,
    );
    expect(webdavFileUrl("https://cloud.example/dav/files/you/mine.json")).toBe(
      "https://cloud.example/dav/files/you/mine.json",
    );
  });

  it("fills in https when the rider omits a scheme", () => {
    expect(webdavFileUrl("cloud.example/dav/")).toBe(
      `https://cloud.example/dav/${REMOTE_BACKUP_NAME}`,
    );
  });
});

describe("webdavAuthHeader", () => {
  it("is Basic auth of utf-8 user:password", () => {
    expect(webdavAuthHeader("you", "secret")).toBe(`Basic ${btoa("you:secret")}`);
  });
});

describe("webdav fetch", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("PUTs with Basic auth to the file URL", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);
    await putWebdav(dav, '{"version":1}');
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`https://cloud.example/remote.php/dav/files/you/${REMOTE_BACKUP_NAME}`);
    expect(init.method).toBe("PUT");
    expect(init.body).toBe('{"version":1}');
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(webdavAuthHeader("you", "secret"));
    expect(headers["Content-Type"]).toBe("application/json");
  });

  it("returns null when the file is not there yet", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 404 })),
    );
    expect(await getWebdav(dav)).toBeNull();
  });
});
