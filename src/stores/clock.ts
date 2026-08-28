import { createEffect, createSignal, onCleanup } from "solid-js";
import { settings } from "./settings";

/*
 * These are app-wide stores, written from event handlers, effects and component
 * setup alike. Solid 2 flags a write from inside an owned scope unless the
 * signal says that is intentional - which for a store it is.
 */
const [now, setNow] = createSignal(Date.now(), { ownedWrite: true });
const [etaTick, setEtaTick] = createSignal(0, { ownedWrite: true });

/**
 * One shared ticker drives every countdown on screen. It runs once a second so
 * a number changes the moment it should, and Solid's fine-grained updates mean
 * only the digits that actually differ touch the DOM.
 *
 * It pauses while the tab is hidden - a backgrounded app has no reason to burn
 * a wake-up every second - and resyncs the instant it comes back, which also
 * forces a fresh ETA poll so a returning user never reads a stale number.
 */
export function installClock() {
  let seconds: number | undefined;

  const tick = () => setNow(Date.now());

  const resume = () => {
    if (seconds !== undefined) return;
    tick();
    seconds = window.setInterval(tick, 1_000);
  };

  const pause = () => {
    if (seconds === undefined) return;
    clearInterval(seconds);
    seconds = undefined;
  };

  const onVisibility = () => {
    if (document.hidden) {
      pause();
    } else {
      resume();
      setEtaTick((n) => n + 1);
    }
  };

  document.addEventListener("visibilitychange", onVisibility);
  resume();

  // Polling cadence is a setting, so the interval is rebuilt when it changes.
  createEffect(
    () => settings.refreshSeconds(),
    (every) => {
      const poll = window.setInterval(() => {
        if (!document.hidden) setEtaTick((n) => n + 1);
      }, every * 1_000);
      return () => clearInterval(poll);
    },
  );

  onCleanup(() => {
    pause();
    document.removeEventListener("visibilitychange", onVisibility);
  });
}

/** Milliseconds, updated every second. */
export { now };
/** Increments whenever ETAs should be refetched. */
export { etaTick };
