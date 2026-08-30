import { createSignal } from "solid-js";
import { queryClient } from "~/lib/query";
import { alerts } from "~/stores/alerts";
import { settings } from "~/stores/settings";

/**
 * The first key of every query that asks an operator something live: arrivals
 * for a row, for a whole stop, for every stop nearby, and the buses worked
 * back out of them. Anything under one of these is refreshed on the shared
 * cadence and dropped together by "clear cache".
 */
export const LIVE_KEYS = new Set(["eta", "stop", "departures", "vehicles", "arrivals"]);

/**
 * How every live query behaves, in one place.
 *
 * The cadence is a setting, so this is a function read inside each query's
 * options rather than a constant: change the setting and every countdown on
 * screen picks up the new interval without being remounted.
 *
 * Polling stops while the tab is hidden - a backgrounded app has no reason to
 * burn a request every twenty seconds - unless a reminder is armed. An arrival
 * alert that only fires once the rider looks at the screen is not a reminder
 * at all, so while one is set the poll keeps going. Browsers clamp a hidden
 * tab's timers to about a minute, so the alert lands late by up to that: late
 * but honest, and far better than not at all.
 *
 * Coming back to the tab refetches only what has gone stale. A rider who
 * glanced away for five seconds gets the numbers they had; one who was gone
 * for a minute gets fresh ones before they have finished looking up.
 */
export function live() {
  const every = settings.refreshSeconds() * 1_000;
  return {
    refetchInterval: every,
    refetchIntervalInBackground: alerts.items().length > 0,
    staleTime: every,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  } as const;
}

/*
 * App-wide, written from a cache subscription rather than a component, so the
 * write has to be declared intentional.
 */
const [liveUpdatedAt, setLiveUpdatedAt] = createSignal(Date.now(), { ownedWrite: true });

/**
 * When any live answer last came back.
 *
 * A countdown with no reading age behind it asks to be trusted without saying
 * how old it is, which is the one thing a rider standing at a kerb needs to
 * know about it. This is that age, for the screen as a whole.
 */
export { liveUpdatedAt };

export function installLiveEffects() {
  return queryClient.getQueryCache().subscribe((event) => {
    if (event.type !== "updated" || event.action.type !== "success") return;
    if (!LIVE_KEYS.has(String(event.query.queryKey[0]))) return;
    setLiveUpdatedAt(Date.now());
  });
}

/**
 * Forget every answer and ask again.
 *
 * The raw responses go first, so the refetch that follows cannot be served
 * from them; then everything live is marked stale, which makes every query
 * with a row on screen go out immediately and the rest go when they are next
 * looked at.
 */
export function refreshLive() {
  queryClient.removeQueries({ queryKey: ["http"] });
  void queryClient.invalidateQueries({
    predicate: (query) => LIVE_KEYS.has(String(query.queryKey[0])),
  });
}
