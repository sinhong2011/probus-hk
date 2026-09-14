// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot, flush } from "solid-js";

/**
 * Auto sync used to PUT on every keystroke of the remote folder. Alist (and
 * similar hosts) create the parent of a PUT, so typing Probus grew P, Pr, Pro
 * on the disk. These tests are that path, not the backup JSON itself.
 */
const memory = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => memory.get(k) ?? null,
  setItem: (k: string, v: string) => void memory.set(k, v),
  removeItem: (k: string) => void memory.delete(k),
  clear: () => memory.clear(),
  key: () => null,
  length: 0,
});

const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

let dispose: (() => void) | undefined;

beforeEach(() => {
  dispose?.();
  dispose = undefined;
  memory.clear();
  vi.resetModules();
});

afterEach(() => {
  dispose?.();
  dispose = undefined;
  vi.unstubAllGlobals();
});

async function boot() {
  const { installSettingsEffects } = await import("~/stores/settings");
  const { installSyncEffects } = await import("~/stores/sync");
  const { installAutoSyncEffects } = await import("~/stores/autoSync");
  dispose = createRoot((stop) => {
    installSettingsEffects();
    installSyncEffects();
    installAutoSyncEffects();
    return stop;
  });
  flush();
  await settled();
}

function stubDav() {
  const puts: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if ((init?.method ?? "GET") === "PUT") {
        puts.push(url);
        return new Response(null, { status: 201 });
      }
      return new Response("", { status: 404 });
    }),
  );
  return puts;
}

describe("auto sync", () => {
  it("uploads as soon as auto is turned on with a ready endpoint", async () => {
    const puts = stubDav();
    await boot();
    const { sync } = await import("~/stores/sync");
    sync.setKind("webdav");
    sync.setWebdavUrl("https://dav.test/files/");
    sync.setAuto(true);
    flush();
    await vi.waitFor(() => expect(puts).toEqual(["https://dav.test/files/probus-backup.json"]));
  });

  it("waits until the remote folder has settled instead of writing P, Pr, Pro", async () => {
    const puts = stubDav();
    await boot();
    const { sync } = await import("~/stores/sync");
    const { AUTO_SYNC_TARGET_DEBOUNCE_MS } = await import("~/stores/autoSync");
    sync.setKind("webdav");
    sync.setWebdavUrl("https://dav.test/files/");
    sync.setAuto(true);
    flush();
    await vi.waitFor(() => expect(puts).toHaveLength(1));

    for (const prefix of ["P", "Pr", "Pro", "Prob", "Probu", "Probus"]) {
      sync.setWebdavFolder(prefix);
      flush();
      await settled();
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(puts).toEqual(["https://dav.test/files/probus-backup.json"]);

    await vi.waitFor(
      () => expect(puts.at(-1)).toBe("https://dav.test/files/Probus/probus-backup.json"),
      { timeout: AUTO_SYNC_TARGET_DEBOUNCE_MS + 1_500 },
    );
    expect(puts.some((url) => /\/files\/P(?:r(?:o(?:b(?:u)?)?)?)?\//.test(url))).toBe(false);
  });
});
