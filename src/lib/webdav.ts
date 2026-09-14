import {
  classifyFetchFailure,
  classifyHttp,
  REMOTE_BACKUP_NAME,
  RemoteSyncError,
  type SyncConfig,
} from "./remoteSync";

/**
 * The file URL a WebDAV endpoint is asked about.
 *
 * The rider's URL is a folder, never a file: the backup is always
 * `probus-backup.json` under that folder (and an optional subfolder). A
 * trailing `.json` on an older stored URL is treated as a leftover filename
 * and dropped, so a custom name cannot sneak back in.
 */
export function webdavFileUrl(url: string, folder = ""): string {
  const trimmed = url.trim();
  if (!trimmed) throw new RemoteSyncError("incomplete");
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const parsed = new URL(withProtocol);
    parsed.pathname = `${asFolderPath(parsed.pathname, folder)}${REMOTE_BACKUP_NAME}`;
    return parsed.href;
  } catch (error) {
    throw new RemoteSyncError("invalid", error);
  }
}

function asFolderPath(pathname: string, folder: string): string {
  let dir = pathname || "/";
  if (!dir.endsWith("/")) {
    const last = dir.slice(dir.lastIndexOf("/") + 1);
    if (last === REMOTE_BACKUP_NAME || /\.json$/i.test(last)) {
      dir = dir.slice(0, -last.length);
    } else {
      dir = `${dir}/`;
    }
  }
  if (!dir.endsWith("/")) dir = `${dir}/`;
  const extra = folder
    .trim()
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean)
    .join("/");
  return extra ? `${dir}${extra}/` : dir;
}

export function webdavAuthHeader(user: string, password: string): string {
  const bytes = new TextEncoder().encode(`${user}:${password}`);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `Basic ${btoa(binary)}`;
}

function headers(config: SyncConfig): HeadersInit {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (config.webdavUser || config.webdavPassword) {
    headers.Authorization = webdavAuthHeader(config.webdavUser, config.webdavPassword);
  }
  return headers;
}

async function send(config: SyncConfig, init: RequestInit): Promise<Response> {
  const url = webdavFileUrl(config.webdavUrl, config.webdavFolder);
  try {
    return await fetch(url, {
      ...init,
      headers: { ...headers(config), ...asHeaders(init.headers) },
    });
  } catch (error) {
    throw classifyFetchFailure(error);
  }
}

function asHeaders(value: HeadersInit | undefined): Record<string, string> {
  if (!value) return {};
  if (value instanceof Headers) return Object.fromEntries(value.entries());
  if (Array.isArray(value)) return Object.fromEntries(value);
  return value;
}

export async function getWebdav(config: SyncConfig): Promise<string | null> {
  const response = await send(config, { method: "GET" });
  if (response.status === 404) return null;
  if (!response.ok) throw classifyHttp(response.status);
  return response.text();
}

export async function putWebdav(config: SyncConfig, body: string): Promise<void> {
  const response = await send(config, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body,
  });
  if (!response.ok) throw classifyHttp(response.status);
}
