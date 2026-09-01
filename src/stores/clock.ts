import { createMemo, createRoot, createSignal, onCleanup } from "solid-js";
import { alerts } from "./alerts";

/*
 * These are app-wide stores, written from event handlers, effects and component
 * setup alike. Solid 2 flags a write from inside an owned scope unless the
 * signal says that is intentional - which for a store it is.
 */
const [now, setNow] = createSignal(Date.now(), { ownedWrite: true });

/**
 * One shared ticker drives every countdown on screen. It runs once a second so
 * a number changes the moment it should, and Solid's fine-grained updates mean
 * only the digits that actually differ touch the DOM.
 *
 * It pauses while the tab is hidden - a backgrounded app has no reason to burn
 * a wake-up every second - and resyncs the instant it comes back. Unless a
 * reminder is armed: an alert has to be able to count down with the phone in a
 * pocket, so while one is set the clock keeps going. The polling of the
 * operators themselves is the queries' business - see `~/data/live`.
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
    if (document.hidden && !watching()) pause();
    else resume();
  };

  document.addEventListener("visibilitychange", onVisibility);
  resume();

  onCleanup(() => {
    pause();
    document.removeEventListener("visibilitychange", onVisibility);
  });
}

/**
 * The same clock, but only as often as the minute changes.
 *
 * Some of what the app reads the clock for does not turn over on the second:
 * whether the last bus of the day has gone, when the service span ends, which
 * minute a notice was published in. Reading `now` for those re-ran a timetable
 * lookup - twice a day's worth of spans, per route row - sixty times a minute
 * to get the same answer fifty-nine times. This is the same tick with the
 * seconds thrown away, so a reader of it hears from the clock once a minute.
 *
 * A memo of its own root: it is made once, and lives as long as the app.
 */
export const minute = createRoot(() => createMemo(() => Math.floor(now() / 60_000)));

/** Milliseconds, updated every second. */
export { now };
