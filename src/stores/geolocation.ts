import { createSignal, onCleanup } from "solid-js";
import { distanceM, type LatLng } from "~/lib/geo";

export type GeoStatus = "idle" | "locating" | "ready" | "denied" | "unavailable";

/**
 * Why there is no position, in the terms that decide what a rider can do about
 * it. "Blocked" is the browser refusing to ask again, which no amount of
 * tapping retry will change; "insecure" is the page being served over plain
 * HTTP, where the API is not offered at all.
 */
export type GeoReason = "blocked" | "insecure" | "unsupported" | "position" | "timeout";

/*
 * These are app-wide stores, written from event handlers, effects and component
 * setup alike. Solid 2 flags a write from inside an owned scope unless the
 * signal says that is intentional - which for a store it is.
 */
const [position, setPosition] = createSignal<LatLng | null>(null, { ownedWrite: true });
const [status, setStatus] = createSignal<GeoStatus>("idle", { ownedWrite: true });
const [accuracy, setAccuracy] = createSignal<number | null>(null, { ownedWrite: true });
const [reason, setReason] = createSignal<GeoReason | null>(null, { ownedWrite: true });

/** Movement below this is GPS jitter, not a rider walking. */
const MIN_MOVE_M = 15;

let watchId: number | null = null;
let watchers = 0;

/**
 * @param again Asked for by the rider rather than by a screen opening. The
 * existing watch is torn down first: after a refusal the old one is still
 * registered and silently keeps its answer, which is what made the retry
 * button do nothing at all.
 */
function start(again = false) {
  if (!("geolocation" in navigator)) {
    setStatus("unavailable");
    setReason("unsupported");
    return;
  }
  /*
   * Geolocation is a secure-context API. Opened from a phone over plain HTTP -
   * the usual way of testing on a device - it is not that the rider refused,
   * it is that the browser never offered, and saying "allow location" then is
   * advice they cannot act on.
   */
  if (!window.isSecureContext) {
    setStatus("unavailable");
    setReason("insecure");
    return;
  }
  if (watchId !== null) {
    if (!again) return;
    stop();
  }

  setStatus((s) => (s === "ready" && !again ? s : "locating"));
  setReason(null);

  watchId = navigator.geolocation.watchPosition(
    (pos) => {
      const next = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      /*
       * A phone held in a hand reports a slightly different position every
       * few seconds without anyone moving. Everything watching this signal -
       * the nearby clusters, the nearest stop on a route - recomputes per
       * write, so a wobble smaller than the width of a bus is not news. The
       * first fix always lands; after that, only actually going somewhere.
       */
      const previous = position();
      if (!previous || distanceM(previous, next) >= MIN_MOVE_M) setPosition(next);
      setAccuracy(pos.coords.accuracy);
      setStatus("ready");
      setReason(null);
    },
    (err) => {
      if (err.code === err.PERMISSION_DENIED) {
        setStatus("denied");
        setReason("blocked");
        return;
      }
      setStatus("unavailable");
      setReason(err.code === err.TIMEOUT ? "timeout" : "position");
    },
    {
      enableHighAccuracy: true,
      // A stop 80 m away does not move; a slightly stale fix beats a spinner.
      maximumAge: 15_000,
      timeout: 20_000,
    },
  );
}

function stop() {
  if (watchId !== null) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }
}

/**
 * Reference-counted so several screens can watch at once and the GPS is
 * released as soon as the last one goes away.
 */
export function useGeolocation() {
  watchers += 1;
  start();

  onCleanup(() => {
    watchers -= 1;
    if (watchers <= 0) stop();
  });

  return { position, status, accuracy, reason };
}

export const geo = { position, status, accuracy, reason, retry: () => start(true) };
