import { afterEach, describe, expect, it, vi } from "vitest";
import { awsUriEncode, s3Authorization, s3ObjectUrl } from "~/lib/s3";
import { REMOTE_BACKUP_NAME, type SyncConfig } from "~/lib/remoteSync";

const target: SyncConfig = {
  kind: "s3",
  webdavUrl: "",
  webdavFolder: "",
  webdavUser: "",
  webdavPassword: "",
  s3Endpoint: "https://s3.amazonaws.com",
  s3Region: "us-east-1",
  s3Bucket: "rides",
  s3Key: "",
  s3AccessKey: "AKIAIOSFODNN7EXAMPLE",
  s3SecretKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
  s3PathStyle: true,
};

describe("awsUriEncode", () => {
  it("leaves unreserved characters and encodes the rest as uppercase hex", () => {
    expect(awsUriEncode("probus-backup.json")).toBe("probus-backup.json");
    expect(awsUriEncode("a b")).toBe("a%20b");
    expect(awsUriEncode("folder/file.json", false)).toBe("folder/file.json");
    expect(awsUriEncode("folder/file.json", true)).toBe("folder%2Ffile.json");
  });
});

describe("s3ObjectUrl", () => {
  it("builds a path-style URL with the default object name", () => {
    expect(s3ObjectUrl(target).href).toBe(`https://s3.amazonaws.com/rides/${REMOTE_BACKUP_NAME}`);
  });

  it("hosts the bucket on the endpoint when path-style is off", () => {
    expect(s3ObjectUrl({ ...target, s3PathStyle: false }).href).toBe(
      `https://rides.s3.amazonaws.com/${REMOTE_BACKUP_NAME}`,
    );
  });

  it("keeps slashes in a nested object key", () => {
    expect(s3ObjectUrl({ ...target, s3Key: "backups/probus.json" }).pathname).toBe(
      "/rides/backups/probus.json",
    );
  });

  it("percent-encodes a space in the object key on the wire", () => {
    expect(s3ObjectUrl({ ...target, s3Key: "a b.json" }).href).toBe(
      "https://s3.amazonaws.com/rides/a%20b.json",
    );
  });
});

describe("s3Authorization", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("signs the same payload the same way twice", async () => {
    const now = new Date("2024-01-02T03:04:05Z");
    const first = await s3Authorization(target, "PUT", '{"ok":true}', now);
    const second = await s3Authorization(target, "PUT", '{"ok":true}', now);
    expect(first.authorization).toBe(second.authorization);
    expect(first.authorization).toMatch(
      /^AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE\/20240102\/us-east-1\/s3\/aws4_request,/,
    );
    expect(first.amzDate).toBe("20240102T030405Z");
    expect(first.payloadHash).toHaveLength(64);
    expect(first.canonicalUri).toBe(`/${target.s3Bucket}/${REMOTE_BACKUP_NAME}`);
  });

  it("signs the encoded URI when the key has a space", async () => {
    const now = new Date("2024-01-02T03:04:05Z");
    const signed = await s3Authorization({ ...target, s3Key: "a b.json" }, "GET", "", now);
    expect(signed.canonicalUri).toBe("/rides/a%20b.json");
    expect(signed.url).toBe("https://s3.amazonaws.com/rides/a%20b.json");
    expect(signed.payloadHash).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });

  it("PUTs the backup body to the object URL", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const { putS3 } = await import("~/lib/s3");
    await putS3(target, '{"version":1}');
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(String(url)).toBe(`https://s3.amazonaws.com/rides/${REMOTE_BACKUP_NAME}`);
    expect(init.method).toBe("PUT");
    expect(init.body).toBe('{"version":1}');
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toMatch(/^AWS4-HMAC-SHA256 /);
    expect(headers["Content-Type"]).toBe("application/json");
    expect(headers.host ?? headers.Host).toBeUndefined();
  });

  it("treats a missing object as nothing rather than a failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 404 })),
    );
    const { getS3 } = await import("~/lib/s3");
    expect(await getS3(target)).toBeNull();
  });

  it("reads back the body it just wrote", async () => {
    let stored: string | undefined;
    vi.stubGlobal("fetch", async (_url: URL, init?: RequestInit) => {
      if (init?.method === "PUT") {
        stored = String(init.body);
        return new Response(null, { status: 200 });
      }
      if (stored === undefined) return new Response("", { status: 404 });
      return new Response(stored, { status: 200 });
    });
    const { getS3, putS3 } = await import("~/lib/s3");
    await putS3(target, '{"version":1}');
    expect(await getS3(target)).toBe('{"version":1}');
  });
});
