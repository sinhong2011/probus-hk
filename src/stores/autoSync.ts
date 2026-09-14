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

/**
 * Keeps the remote file in step without a tap, when the rider has asked.
 *
 * Off until they turn it on: the copy stays on this device otherwise. On, a
 * cycle is merge-then-push - the same two verbs as the buttons - so another
 * phone's stars come in before this one writes. It runs when auto becomes
 * ready, when the tab is seen again, when the network returns, and a short
 * wait after the last local change. Success is silent; a failure is a toast,
 * then a pause so a dead endpoint is not hammered.
 */
export function installAutoSyncEffects() {
  let timer: number | undefined;
  let backoffUntil = 0;

  const clearTimer = () => {
    if (timer === undefined) return;
    window.clearTimeout(timer);
    timer = undefined;
  };

  const run = async () => {
    const config = sync.snapshot();
    if (!sync.auto() || !syncReady(config)) return;
    if (Date.now() < backoffUntil) return;
    try {
      await withRemoteLock(() => cycleRemote(config));
      sync.markSynced();
    } catch (error) {
      backoffUntil = Date.now() + AUTO_SYNC_BACKOFF_MS;
      toast.show(t("remoteSyncAutoFailed", settings.lang()), errorMessage(error));
    }
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
      const enabled = sync.auto() && syncReady(config);
      return {
        enabled,
        target: `${config.kind}\0${config.webdavUrl}\0${config.webdavFolder}\0${config.s3Endpoint}\0${config.s3Bucket}\0${config.s3Key}`,
        stamp: enabled ? backupFingerprint(exportBackup()) : "",
      };
    },
    (state, prev) => {
      if (!state.enabled) {
        clearTimer();
        return;
      }
      if (!prev?.enabled || state.target !== prev.target) {
        clearTimer();
        void run();
        return;
      }
      if (state.stamp !== prev.stamp) schedule();
    },
  );

  const onVisibility = () => {
    if (document.hidden) {
      if (timer === undefined) return;
      clearTimer();
      void run();
      return;
    }
    void run();
  };

  const onOnline = () => void run();

  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("online", onOnline);
  onCleanup(() => {
    clearTimer();
    document.removeEventListener("visibilitychange", onVisibility);
    window.removeEventListener("online", onOnline);
  });
}
