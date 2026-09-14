import {
  classifyFetchFailure,
  classifyHttp,
  REMOTE_BACKUP_NAME,
  RemoteSyncError,
  type SyncConfig,
} from "./remoteSync";

const encoder = new TextEncoder();

/**
 * AWS SigV4 percent-encoding: unreserved characters stay, everything else
 * becomes uppercase hex, and UTF-8 is encoded byte by byte. Slashes in an
 * object key stay slashes when `encodeSlash` is false.
 */
export function awsUriEncode(value: string, encodeSlash = true): string {
  const bytes = encoder.encode(value);
  let out = "";
  for (const byte of bytes) {
    const unreserved =
      (byte >= 0x41 && byte <= 0x5a) ||
      (byte >= 0x61 && byte <= 0x7a) ||
      (byte >= 0x30 && byte <= 0x39) ||
      byte === 0x2d ||
      byte === 0x2e ||
      byte === 0x5f ||
      byte === 0x7e ||
      (byte === 0x2f && !encodeSlash);
    out += unreserved
      ? String.fromCharCode(byte)
      : `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
  }
  return out;
}

function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256Hex(data: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", encoder.encode(data));
  return toHex(hash);
}

async function hmac(key: BufferSource, data: string): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(data));
}

async function signingKey(secret: string, date: string, region: string): Promise<ArrayBuffer> {
  const kDate = await hmac(encoder.encode(`AWS4${secret}`), date);
  const kRegion = await hmac(kDate, region);
  const kService = await hmac(kRegion, "s3");
  return hmac(kService, "aws4_request");
}

export function s3Region(config: SyncConfig): string {
  const region = config.s3Region.trim();
  return region === "" ? "us-east-1" : region;
}

export function s3ObjectKey(config: SyncConfig): string {
  const key = config.s3Key.trim();
  return key === "" ? REMOTE_BACKUP_NAME : key.replace(/^\/+/, "");
}

/**
 * Where the object lives: path-style `endpoint/bucket/key`, or virtual-hosted
 * `bucket.endpoint/key`. Path-style is the default because R2, MinIO and
 * most custom gateways expect it; Amazon's own hosts can do either.
 *
 * SigV4 signs the already-encoded URI. The URL parser's `.pathname` is the
 * decoded form, so a key with a space would sign `/a b.json` and then GET
 * `/a%20b.json` - a mismatch every compatible host rejects. The canonical
 * path is therefore kept beside the URL, not reread from it.
 */
export function s3ObjectTarget(config: SyncConfig): { url: URL; canonicalUri: string } {
  const endpoint = config.s3Endpoint.trim();
  if (!endpoint) throw new RemoteSyncError("incomplete");
  const withProtocol = /^https?:\/\//i.test(endpoint) ? endpoint : `https://${endpoint}`;
  let origin: URL;
  try {
    origin = new URL(withProtocol);
  } catch (error) {
    throw new RemoteSyncError("invalid", error);
  }
  const bucket = config.s3Bucket.trim();
  if (!bucket) throw new RemoteSyncError("incomplete");
  const encodedKey = awsUriEncode(s3ObjectKey(config), false);
  if (config.s3PathStyle) {
    const canonicalUri = `/${awsUriEncode(bucket, false)}/${encodedKey}`;
    origin.pathname = canonicalUri;
    return { url: origin, canonicalUri };
  }
  origin.host = `${bucket}.${origin.host}`;
  const canonicalUri = `/${encodedKey}`;
  origin.pathname = canonicalUri;
  return { url: origin, canonicalUri };
}

export function s3ObjectUrl(config: SyncConfig): URL {
  return s3ObjectTarget(config).url;
}

function amzDate(now: Date): { date: string; stamp: string } {
  const iso = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  return { date: iso, stamp: iso.slice(0, 8) };
}

async function signedHeaders(
  config: SyncConfig,
  method: "GET" | "PUT",
  body: string,
  now: Date,
): Promise<{ url: URL; headers: Record<string, string>; canonicalUri: string }> {
  if (!config.s3AccessKey.trim() || !config.s3SecretKey.trim()) {
    throw new RemoteSyncError("incomplete");
  }
  const { url, canonicalUri } = s3ObjectTarget(config);
  const region = s3Region(config);
  const { date, stamp } = amzDate(now);
  const payloadHash = await sha256Hex(body);
  const host = url.host;
  // Host is signed from the URL, never set on the request: browsers treat it
  // as a forbidden header and a fetch that tries to send it can fail outright.
  const put = method === "PUT";
  const canonicalHeaders =
    (put ? "content-type:application/json\n" : "") +
    `host:${host}\n` +
    `x-amz-content-sha256:${payloadHash}\n` +
    `x-amz-date:${date}\n`;
  const signed = put
    ? "content-type;host;x-amz-content-sha256;x-amz-date"
    : "host;x-amz-content-sha256;x-amz-date";
  const canonical = [method, canonicalUri, "", canonicalHeaders, signed, payloadHash].join("\n");
  const scope = `${stamp}/${region}/s3/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", date, scope, await sha256Hex(canonical)].join("\n");
  const signature = toHex(
    await hmac(await signingKey(config.s3SecretKey, stamp, region), stringToSign),
  );
  return {
    url,
    canonicalUri,
    headers: {
      ...(put ? { "Content-Type": "application/json" } : {}),
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": date,
      Authorization: `AWS4-HMAC-SHA256 Credential=${config.s3AccessKey}/${scope}, SignedHeaders=${signed}, Signature=${signature}`,
    },
  };
}

async function send(
  config: SyncConfig,
  method: "GET" | "PUT",
  body: string,
  now: Date,
): Promise<Response> {
  const signed = await signedHeaders(config, method, body, now);
  try {
    return await fetch(signed.url, {
      method,
      headers: signed.headers,
      ...(method === "PUT" ? { body } : {}),
    });
  } catch (error) {
    throw classifyFetchFailure(error);
  }
}

export async function getS3(config: SyncConfig, now = new Date()): Promise<string | null> {
  const response = await send(config, "GET", "", now);
  if (response.status === 404) return null;
  if (!response.ok) throw classifyHttp(response.status);
  return response.text();
}

export async function putS3(config: SyncConfig, body: string, now = new Date()): Promise<void> {
  const response = await send(config, "PUT", body, now);
  if (!response.ok) throw classifyHttp(response.status);
}

/** Exposed so a test can pin the clock and still see the Authorization header. */
export async function s3Authorization(
  config: SyncConfig,
  method: "GET" | "PUT",
  body: string,
  now: Date,
): Promise<{
  url: string;
  authorization: string;
  amzDate: string;
  payloadHash: string;
  canonicalUri: string;
}> {
  const signed = await signedHeaders(config, method, body, now);
  return {
    url: signed.url.href,
    authorization: signed.headers.Authorization ?? "",
    amzDate: signed.headers["x-amz-date"] ?? "",
    payloadHash: signed.headers["x-amz-content-sha256"] ?? "",
    canonicalUri: signed.canonicalUri,
  };
}
