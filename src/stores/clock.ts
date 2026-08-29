import { createEffect, createSignal, onCleanup } from "solid-js";
import { alerts } from "./alerts";
import { settings } from "./settings";

/*
 * These are app-wide stores, written from event handlers, effects and component
 * setup alike. Solid 2 flags a write from inside an owned scope unless the
 * signal says that is intentional - which for a store it is.
 */
const [now, setNow] = createSignal(Date.now(), { ownedWrite: true });
const [etaTick, setEtaTick] = createSignal(0, { ownedWrite: true });
/*
 * When that poll last went out. A countdown with no reading age behind it asks
 * to be trusted without saying how old it is, which is the one thing a rider
 * standing at a kerb needs to know about it.
 */
const [etaTickAt, setEtaTickAt] = createSignal(Date.now(), { ownedWrite: true });

function poll() {
  setEtaTick((n) => n + 1);
  setEtaTickAt(Date.now());
}

/**
 * One shared ticker drives every countdown on screen. It runs once a second so
 * a number changes the moment it should, and Solid's fine-grained updates mean
 * only the digits that actually differ touch the DOM.
 *
 * It pauses while the tab is hidden - a backgrounded app has no reason to burn
 * a wake-up every second - and resyncs the instant it comes back, which also
 * forces a fresh ETA poll so a returning user never reads a stale number.
 *
 * Unless a reminder is armed. An arrival alert that only fires once the rider
 * looks at the screen is not a reminder at all, so while one is set the poll
 * keeps running in the background. Browsers clamp a hidden tab's timers to
 * about a minute, so the alert lands late by up to that - late but honest, and
 * far better than not at all. Nothing can reach a rider once the browser
 * itself is suspended: that needs a push server, which this app deliberately
 * does not have.
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

  const watching = () => alerts.items().length > 0;

  const onVisibility = () => {
    if (document.hidden && !watching()) {
      pause();
    } else {
      resume();
      poll();
    }
  };

  document.addEventListener("visibilitychange", onVisibility);
  resume();

  // Polling cadence is a setting, so the interval is rebuilt when it changes.
  createEffect(
    () => settings.refreshSeconds(),
    (every) => {
      const timer = window.setInterval(() => {
        if (!document.hidden || watching()) poll();
      }, every * 1_000);
      return () => clearInterval(timer);
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
/** The moment of that refetch, in milliseconds. */
export { etaTickAt };
