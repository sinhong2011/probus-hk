import { createEffect, onCleanup } from "solid-js";
import { exportBackup } from "~/lib/backup";
import { t } from "~/lib/i18n";
import {
  RemoteSyncError,
  backupFingerprint,
  cycleRemote,
  syncReady,
  withRemoteLock,
} from "~/lib/remoteSync";
import { settings } from "./settings";
import { sync } from "./sync";
import { toast } from "./toast";

/** Wait after the last local change so a run of stars becomes one upload. */
export const AUTO_SYNC_DEBOUNCE_MS = 12_000;
/** After a failure, leave the endpoint alone until this has passed. */
export const AUTO_SYNC_BACKOFF_MS = 120_000;

function errorMessage(error: unknown): string {
  const code = error instanceof RemoteSyncError ? error.code : "http";
  const key =
    code === "cors"
      ? "remoteSyncCors"
      : code === "auth"
        ? "remoteSyncAuth"
        : code === "missing"
          ? "remoteSyncMissing"
          : code === "invalid"
            ? "remoteSyncInvalid"
            : code === "incomplete"
              ? "remoteSyncIncomplete"
              : "remoteSyncHttp";
  return t(key, settings.lang());
}

let runCycle: () => void = () => {};
let editingEndpoint = false;

/**
 * The endpoint fields are being typed. Hide/online must not flush a
 * half-written folder as P or Pr.
 */
export function pauseAutoSyncForEdit() {
  editingEndpoint = true;
}

/**
 * The rider left the field. The path is the one they meant; cycle now.
 */
export function finishAutoSyncEdit() {
  editingEndpoint = false;
  runCycle();
}

/** Close of the sheet, or anything else that means the path is finished. */
export function commitAutoSync() {
  runCycle();
}

/**
 * Keeps the remote file in step without a tap, when the rider has asked.
 *
 * Off until they turn it on: the copy stays on this device otherwise. On, a
 * cycle is merge-then-push - the same two verbs as the buttons - so another
 * phone's stars come in before this one writes. It runs when auto is turned
 * on, when the tab is seen again, when the network returns, when they leave
 * an endpoint field, and a short wait after the last local change. Typing
 * the folder does not upload: a host that creates the parent of a PUT
 * (Alist does) would otherwise grow P, Pr, Pro under the URL. Success is
 * silent; a failure is a toast, then a pause so a dead endpoint is not
 * hammered.
 */
export function installAutoSyncEffects() {
  let timer: number | undefined;
  let epoch = 0;
  let backoffUntil = 0;

  const clearTimer = () => {
    if (timer === undefined) return;
    window.clearTimeout(timer);
    timer = undefined;
  };

  const run = async () => {
    const mine = epoch;
    if (editingEndpoint) return;
    if (Date.now() < backoffUntil) return;
    try {
      await withRemoteLock(async () => {
        if (mine !== epoch || editingEndpoint) return;
        const config = sync.snapshot();
        if (!sync.auto() || !syncReady(config)) return;
        await cycleRemote(config);
        if (mine !== epoch) return;
        sync.markSynced();
      });
    } catch (error) {
      if (mine !== epoch) return;
      backoffUntil = Date.now() + AUTO_SYNC_BACKOFF_MS;
      toast.show(t("remoteSyncAutoFailed", settings.lang()), errorMessage(error));
    }
  };

  runCycle = () => {
    void run();
  };

  const schedule = () => {
    clearTimer();
    timer = window.setTimeout(() => {
      timer = undefined;
      void run();
    }, AUTO_SYNC_DEBOUNCE_MS);
  };

  createEffect(
    () => {
      const config = sync.snapshot();
      const auto = sync.auto();
      const ready = syncReady(config);
      return {
        auto,
        ready,
        target: `${config.kind}\0${config.webdavUrl}\0${config.webdavFolder}\0${config.s3Endpoint}\0${config.s3Bucket}\0${config.s3Key}`,
        stamp: auto && ready ? backupFingerprint(exportBackup()) : "",
      };
    },
    (state, prev) => {
      if (!state.auto || !state.ready) {
        if (!state.auto) {
          epoch += 1;
          clearTimer();
        }
        return;
      }
      if (!prev?.auto) {
        clearTimer();
        void run();
        return;
      }
      if (state.target !== prev.target) {
        epoch += 1;
        return;
      }
      if (state.stamp !== prev.stamp) schedule();
    },
  );

  const onVisibility = () => {
    if (editingEndpoint) return;
    if (document.hidden) {
      if (timer === undefined) return;
      clearTimer();
      void run();
      return;
    }
    void run();
  };

  const onOnline = () => {
    if (editingEndpoint) return;
    void run();
  };

  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("online", onOnline);
  onCleanup(() => {
    runCycle = () => {};
    editingEndpoint = false;
    clearTimer();
    document.removeEventListener("visibilitychange", onVisibility);
    window.removeEventListener("online", onOnline);
  });
}
