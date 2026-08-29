import { For, Show, createEffect, createMemo } from "solid-js";
import { useDb } from "~/data/context";
import { routeAt } from "~/data/db";
import { stopIdsFor, useEta } from "~/data/useEta";
import { countdown } from "~/lib/format";
import { distanceM } from "~/lib/geo";
import { buzz, systemNotify } from "~/lib/notify";
import { pick, stripStopCode, t, type Lang } from "~/lib/i18n";
import { alerts, type AlertItem } from "~/stores/alerts";
import { etaTick, now } from "~/stores/clock";
import { geo, useGeolocation } from "~/stores/geolocation";
import { toast } from "~/stores/toast";

/**
 * The part of a reminder that is not a screen.
 *
 * Nothing here renders. Each armed alert gets a runner that watches the one
 * thing it is about - the feed, or where the rider is - and when the moment
 * comes it fires through every channel at once and disarms itself. An alert
 * that fired twice would be worse than one that never fired at all.
 */
export function AlertWatcher(props: { lang: Lang }) {
  const armed = createMemo(() => alerts.items());
  /* The GPS is expensive, so it is only held while something needs it. */
  const needsPosition = createMemo(() => armed().some((a) => a.kind === "destination"));

  return (
    <>
      <Show when={needsPosition()}>
        <GeoHold />
      </Show>
      <For each={armed()}>
        {(alert) => (
          <Show
            when={alert.kind === "arrival"}
            fallback={<DestinationRunner alert={alert} lang={props.lang} />}
          >
            <ArrivalRunner alert={alert} lang={props.lang} />
          </Show>
        )}
      </For>
    </>
  );
}

/** Holds a geolocation watch open for as long as it is mounted. */
function GeoHold() {
  useGeolocation();
  return null;
}

/** The names an alert needs to speak for itself: the route and the stop. */
function alertContext(alert: AlertItem, lang: Lang) {
  const db = useDb();
  const route = createMemo(() => routeAt(db(), alert.routeKey));
  const stopName = () => {
    const stop = db().stopList[alert.stopId];
    return stop ? stripStopCode(pick(stop.name, lang)) : "";
  };
  const title = () => {
    const r = route();
    return r ? `${r.route} · ${stopName()}` : stopName();
  };
  return { db, route, stopName, title };
}

/**
 * Delivers one alert and takes it off the list.
 *
 * Both channels are used every time: the banner is the only one that works
 * with no permission, and the system notification is the only one that works
 * with the phone in a pocket. Whichever the rider is in a position to see, one
 * of them reaches them.
 */
function fire(alert: AlertItem, title: string, body: string) {
  toast.show(title, body, "alert");
  buzz();
  void systemNotify(title, body, alert.id);
  alerts.remove(alert.id);
}

/** Watches the feed: fires once the next bus is inside the lead time. */
function ArrivalRunner(props: { alert: AlertItem; lang: Lang }) {
  const { route, title } = alertContext(props.alert, props.lang);

  const etas = useEta(() => {
    const r = route();
    if (!r) return null;
    return { route: r, seq: props.alert.seq, stopIdByCo: stopIdsFor(r, props.alert.seq) };
  });

  /** Minutes to the soonest arrival that has not already gone. */
  const minutes = createMemo(() => {
    const list = etas();
    /*
     * Both clocks are read only to subscribe to them, and the real value comes
     * from `Date.now()`. The one-second tick stops while the tab is hidden -
     * which is exactly when a reminder matters most - and reading its frozen
     * value would make every arrival look further away than it is. The poll
     * keeps running in the background, so this recomputes against the true
     * clock each time it fires.
     */
    now();
    etaTick();
    if (!list || list.length === 0) return null;
    const at = Date.now();
    for (const eta of list) {
      const state = countdown(eta, at);
      if (state.kind === "gone") continue;
      return state.kind === "arriving" ? 0 : state.minutes;
    }
    return null;
  });

  createEffect(
    () => minutes(),
    (mins) => {
      if (mins === null || mins > props.alert.leadMinutes) return;
      const body =
        mins > 0
          ? `${t("alertFiredArrival", props.lang)} · ${mins} ${t("minute", props.lang)}`
          : t("alertFiredArrival", props.lang);
      fire(props.alert, title(), body);
    },
  );

  return null;
}

/**
 * Watches where the rider is: fires once the stop they are riding to comes
 * within range.
 *
 * It waits until they have been outside that range at least once. Arming a
 * reminder for a stop you are standing at is either a mistake or a plan for
 * later; firing it in the same second is neither useful nor believable.
 */
function DestinationRunner(props: { alert: AlertItem; lang: Lang }) {
  const { db, title } = alertContext(props.alert, props.lang);
  let departed = false;

  const metres = createMemo(() => {
    const here = geo.position();
    const stop = db().stopList[props.alert.stopId];
    return here && stop ? distanceM(here, stop.location) : null;
  });

  createEffect(
    () => metres(),
    (distance) => {
      if (distance === null) return;
      if (distance > props.alert.radiusM) {
        departed = true;
        return;
      }
      if (!departed) return;
      fire(props.alert, title(), t("alertFiredDest", props.lang));
    },
  );

  return null;
}
