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
/** Wait after the last keystroke on the endpoint so "Probus" is not P, Pr, Pro. */
export const AUTO_SYNC_TARGET_DEBOUNCE_MS = 2_000;
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
 *
 * Endpoint fields are typed one character at a time. A host that creates the
 * parent folder of a PUT (Alist does) would otherwise grow P, Pr, Pro, Prob
 * under the URL. Those edits wait until the path has settled, and a cycle
 * already in flight is dropped if the target moved.
 */
export function installAutoSyncEffects() {
  let timer: number | undefined;
  let pending: "target" | "stamp" | undefined;
  let epoch = 0;
  let backoffUntil = 0;

  const clearTimer = () => {
    if (timer === undefined) return;
    window.clearTimeout(timer);
    timer = undefined;
    pending = undefined;
  };

  const run = async () => {
    const mine = epoch;
    if (Date.now() < backoffUntil) return;
    try {
      await withRemoteLock(async () => {
        if (mine !== epoch) return;
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

  const schedule = (reason: "target" | "stamp") => {
    clearTimer();
    pending = reason;
    const wait = reason === "target" ? AUTO_SYNC_TARGET_DEBOUNCE_MS : AUTO_SYNC_DEBOUNCE_MS;
    timer = window.setTimeout(() => {
      timer = undefined;
      pending = undefined;
      void run();
    }, wait);
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
        epoch += 1;
        clearTimer();
        return;
      }
      if (!prev?.enabled) {
        clearTimer();
        void run();
        return;
      }
      if (state.target !== prev.target) {
        epoch += 1;
        schedule("target");
        return;
      }
      if (state.stamp !== prev.stamp) schedule("stamp");
    },
  );

  const onVisibility = () => {
    if (document.hidden) {
      if (timer === undefined) return;
      // A half-typed folder must not flush as P or Pr the moment the sheet
      // is covered. Local data waiting to upload still goes out on hide.
      if (pending === "target") return;
      clearTimer();
      void run();
      return;
    }
    if (pending === "target") return;
    void run();
  };

  const onOnline = () => {
    if (pending === "target") return;
    void run();
  };

  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("online", onOnline);
  onCleanup(() => {
    clearTimer();
    document.removeEventListener("visibilitychange", onVisibility);
    window.removeEventListener("online", onOnline);
  });
}
