import { createSignal, onCleanup } from "solid-js";
import type { LatLng } from "~/lib/geo";

export type GeoStatus = "idle" | "locating" | "ready" | "denied" | "unavailable";

/*
 * These are app-wide stores, written from event handlers, effects and component
 * setup alike. Solid 2 flags a write from inside an owned scope unless the
 * signal says that is intentional - which for a store it is.
 */
const [position, setPosition] = createSignal<LatLng | null>(null, { ownedWrite: true });
const [status, setStatus] = createSignal<GeoStatus>("idle", { ownedWrite: true });
const [accuracy, setAccuracy] = createSignal<number | null>(null, { ownedWrite: true });

let watchId: number | null = null;
let watchers = 0;

function start() {
  if (watchId !== null) return;
  if (!("geolocation" in navigator)) {
    setStatus("unavailable");
    return;
  }
  setStatus((s) => (s === "ready" ? s : "locating"));

  watchId = navigator.geolocation.watchPosition(
    (pos) => {
      setPosition({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      setAccuracy(pos.coords.accuracy);
      setStatus("ready");
    },
    (err) => {
      setStatus(err.code === err.PERMISSION_DENIED ? "denied" : "unavailable");
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

  return { position, status, accuracy };
}

export const geo = { position, status, accuracy, retry: start };
