import { useLinkProps, useNavigate, useSearch } from "@tanstack/solid-router";
import Sortable from "sortablejs";
import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  flush,
  onCleanup,
  untrack,
} from "solid-js";
import { EmptyState, ScreenTitle, SectionLabel, SpecialTag, StopCode } from "~/components/Chrome";
import { EtaCountdown } from "~/components/EtaCountdown";
import { GroupSheet } from "~/components/GroupSheet";
import { SortSheet, SortTrigger, type SortChoice } from "~/components/SortSheet";
import { StopSheet } from "~/components/StopSheet";
import { SwipeActions, SwipeDeed } from "~/components/SwipeActions";
import {
  AlarmIcon,
  PinIcon,
  StarIcon,
  ExchangeIcon,
  GripIcon,
  LayersIcon,
  TrashIcon,
  ThumbtackIcon,
} from "~/components/Icons";
import { RoutePlate } from "~/components/RoutePlate";
import { Page, RowCard, Section } from "~/components/Layout";
import { routeLink, stopLink } from "~/lib/links";
import { useDb } from "~/data/context";
import { isSpecialService, routeAt, routesAtCluster } from "~/data/db";
import { isRunningNow, lastRunGone } from "~/data/schedule";
import type { Eta, KeyedRoute, StopEntry } from "~/data/types";
import { arrivals, type Arrival } from "~/data/arrivals";
import { createLiveQuery } from "~/lib/tanstack/db";
import { countdown } from "~/lib/format";
import { distanceM, walkMinutes } from "~/lib/geo";
import { groupColor, groupColorVar } from "~/lib/groupColors";
import { pick, stripStopCode, t, type Lang } from "~/lib/i18n";
import { alerts } from "~/stores/alerts";
import { frequent } from "~/stores/frequent";
import { useGeolocation } from "~/stores/geolocation";
import { now } from "~/stores/clock";
import { isStopStar, starred, type StarredItem } from "~/stores/starred";
import { settings, type StarredOrder } from "~/stores/settings";

/** A question the group sheet is being opened to ask, and what to do with it. */
interface GroupAsk {
  current: string;
  /** Set when the answer makes a star rather than moves one. */
  confirm?: string;
  apply: (group: string) => void;
}

/** The value that sorts a star with no arrival to the end of the list. */
const NO_ARRIVAL = Number.POSITIVE_INFINITY;

interface Resolved {
  item: StarredItem;
  /** Absent on a stop star: the card is the kerb, not one line. */
  route?: KeyedRoute;
  stop: StopEntry | undefined;
  stopName: string;
  running: boolean;
}

/**
 * When to set off, rather than when the bus arrives.
 *
 * A star is somewhere you go regularly, so the useful number is not "the
 * bus is 8 minutes away" but "you have 5 minutes before you need to walk". That
 * needs the walk to the stop, which is why it only appears once location is
 * available.
 *
 * Being told only that the next bus is out of reach is a dead end, so the
 * search runs down the arrival list to the first one still catchable and gives
 * the leaving time for that.
 */
function leaveAdvice(etas: Eta[], metres: number | null, at: number) {
  if (metres === null || etas.length === 0) return null;

  const walk = walkMinutes(metres);
  const upcoming = etas.map((eta) => countdown(eta, at)).filter((state) => state.kind !== "gone");

  for (const [index, state] of upcoming.entries()) {
    // A minute of slack: nobody misses a bus by thirty seconds of rounding.
    const leaveIn = (state.kind === "arriving" ? 0 : state.minutes) - walk;
    if (leaveIn >= -1) {
      return { leaveIn: Math.max(0, leaveIn), walk, urgent: leaveIn <= 2, nth: index };
    }
  }
  return upcoming.length > 0 ? { leaveIn: null, walk, urgent: false, nth: -1 } : null;
}

function leaveLabel(
  advice: { leaveIn: number | null; urgent: boolean; nth: number },
  lang: Lang,
): string {
  if (advice.nth < 0) return t("tooLate", lang);
  if (advice.leaveIn === 0) return t("leaveNow", lang);
  if (advice.leaveIn !== null) return `${advice.leaveIn} ${t("leaveIn", lang)}`;
  return "";
}

/**
 * One star as a list row. The deeds (pin, stop, group, delete) live behind
 * a swipe, the way a mail message hides Delete: they used to hold a whole
 * strip open under every favourite, which is what made a list of stars a
 * list of cards, and on a phone that left four of them on screen.
 */
function StarredRow(props: {
  entry: Resolved;
  lang: Lang;
  metres: number | null;
  arrival: Arrival | undefined;
  draggable: boolean;
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  onEngage: () => void;
  onRemove: () => void;
  onRegroup: () => void;
  onRestop: () => void;
  onPin: () => void;
}) {
  const db = useDb();
  const stopStar = () => isStopStar(props.entry.item);

  const routeCount = createMemo(() => {
    if (!stopStar()) return 0;
    const ids = new Set<string>([props.entry.item.stopId]);
    for (const [, alias] of db().stopMap[props.entry.item.stopId] ?? []) ids.add(alias);
    return routesAtCluster(db(), [...ids]).length;
  });

  const etas = () => props.arrival?.etas;
  const advice = () => (stopStar() ? null : leaveAdvice(etas() ?? [], props.metres, now()));

  const unreachable = () => {
    const a = advice();
    if (!a) return 0;
    return a.nth < 0 ? Number.POSITIVE_INFINITY : a.nth;
  };

  const over = () => {
    now();
    const route = props.entry.route;
    return route ? lastRunGone(db(), route) : !props.entry.running;
  };

  const dim = () => !props.entry.running && etas()?.length === 0;
  const alerted = () => {
    const route = props.entry.route;
    if (!route) return false;
    return (
      alerts.has("arrival", route.key, props.entry.item.stopId) ||
      alerts.has("destination", route.key, props.entry.item.stopId)
    );
  };

  const paint = () =>
    props.entry.item.group ? groupColorVar(groupColor(props.entry.item.group)) : undefined;

  const closeThen = (fn: () => void) => () => {
    props.onClose();
    fn();
  };

  return (
    <div
      data-star-id={props.entry.item.id}
      data-held={props.entry.item.pinned ? "" : undefined}
      data-pinned={props.entry.item.pinned ? "" : undefined}
    >
      <SwipeActions
        class={dim() ? "opacity-60" : undefined}
        open={props.open}
        onOpen={props.onOpen}
        onClose={props.onClose}
        onEngage={props.onEngage}
        actions={
          <>
            <SwipeDeed
              label={t(props.entry.item.pinned ? "unpinTop" : "pinTop", props.lang)}
              kind="primary"
              pressed={Boolean(props.entry.item.pinned)}
              onPress={closeThen(props.onPin)}
            >
              <ThumbtackIcon size={16} />
            </SwipeDeed>
            <Show when={!stopStar()}>
              <SwipeDeed label={t("changeStop", props.lang)} onPress={closeThen(props.onRestop)}>
                <ExchangeIcon size={16} />
              </SwipeDeed>
            </Show>
            <SwipeDeed
              label={props.entry.item.group || t("noGroup", props.lang)}
              onPress={closeThen(props.onRegroup)}
            >
              <LayersIcon size={16} />
            </SwipeDeed>
            <SwipeDeed
              label={t("removeStar", props.lang)}
              kind="danger"
              onPress={closeThen(props.onRemove)}
            >
              <TrashIcon size={16} />
            </SwipeDeed>
          </>
        }
      >
        <div class="app-tap flex min-w-0 items-center gap-2 px-3 py-2.5">
          <Show when={paint()}>
            {(color) => (
              <span
                class="absolute inset-y-0 left-0 w-[3px]"
                style={{ background: color() }}
                aria-hidden="true"
              />
            )}
          </Show>

          <Show when={props.draggable}>
            <button
              type="button"
              aria-label="reorder"
              data-drag-handle
              class="-ml-1 cursor-grab touch-none text-faint-foreground"
            >
              <GripIcon size={14} />
            </button>
          </Show>

          <Show when={stopStar()}>
            <span
              class="flex h-[1.55rem] min-w-[2.8rem] shrink-0 items-center justify-center rounded-lg bg-secondary text-muted-foreground"
              aria-hidden="true"
            >
              <PinIcon size={14} />
            </span>
            <a
              {...useLinkProps(stopLink(props.entry.item.stopId))}
              class="flex min-w-0 grow flex-col gap-0.5"
            >
              <span class="flex min-w-0 items-center gap-1.5">
                <span class="truncate text-[0.88rem] font-bold tracking-[-0.01em] text-foreground">
                  {props.entry.stopName}
                </span>
                <StopCode name={props.entry.stop?.name} lang={props.lang} />
              </span>
              <span class="truncate text-[0.75rem] font-medium text-subtle-foreground">
                {[
                  `${routeCount()} ${t("routesCount", props.lang)}`,
                  props.metres !== null
                    ? `${t("walkMinutes", props.lang)} ${walkMinutes(props.metres)} ${t("minute", props.lang)}`
                    : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </a>
          </Show>

          <Show when={!stopStar() && props.entry.route}>
            {(route) => (
              <>
                <RoutePlate route={route().route} co={route().co} size="xs" muted={dim()} />
                <a
                  {...useLinkProps(routeLink(route().key))}
                  class="flex min-w-0 grow flex-col gap-0.5"
                >
                  <span class="flex min-w-0 items-center gap-1.5">
                    <span class="truncate text-[0.88rem] font-bold tracking-[-0.01em] text-foreground">
                      {t("towards", props.lang)} {pick(route().dest, props.lang)}
                    </span>
                    <Show when={isSpecialService(route())}>
                      <SpecialTag lang={props.lang} />
                    </Show>
                  </span>
                  <span class="truncate text-[0.75rem] font-medium text-subtle-foreground">
                    {props.entry.stopName}
                    <Show when={advice()}>
                      {(a) => {
                        const text = leaveLabel(a(), props.lang);
                        return (
                          <Show when={text}>
                            {" · "}
                            <span
                              class={[
                                "tnum",
                                {
                                  "text-faint-foreground": a().nth < 0,
                                  "font-bold text-primary": a().urgent && a().nth >= 0,
                                },
                              ]}
                            >
                              {text}
                            </span>
                          </Show>
                        );
                      }}
                    </Show>
                    <Show when={!advice() && props.metres !== null}>
                      {` · ${t("walkMinutes", props.lang)} ${walkMinutes(props.metres ?? 0)} ${t("minute", props.lang)}`}
                    </Show>
                  </span>
                </a>
              </>
            )}
          </Show>

          <Show when={alerted()}>
            <span class="shrink-0 text-primary" title={t("alertOn", props.lang)}>
              <AlarmIcon size={14} />
            </span>
          </Show>

          <Show when={!stopStar()}>
            <EtaCountdown
              etas={etas()}
              lang={props.lang}
              size="sm"
              limit={2}
              compact
              scheduledLabel={false}
              unreachable={unreachable()}
              over={over()}
            />
          </Show>

          <Show when={props.entry.item.pinned}>
            <span class="shrink-0 text-primary" title={t("pinnedTop", props.lang)}>
              <ThumbtackIcon size={12} />
            </span>
          </Show>
        </div>
      </SwipeActions>
    </div>
  );
}

export default function Starred() {
  const db = useDb();
  const lang = settings.lang;
  const { position } = useGeolocation();
  /*
   * The order a drag just produced, mirrored synchronously. The collection
   * commits on its own schedule - a task later - and a paint can land in
   * that gap, which showed the dropped card flashing back to its old slot.
   * The list renders from this mirror the moment the drop happens; the
   * store catches up underneath and agrees.
   */
  const [handOrder, setHandOrder] = createSignal<string[] | null>(null);

  /*
   * The group filter lives in the URL (`?group=`), not in a signal: a cut of
   * the list is a place worth reloading and worth sending. `null` is "every
   * group"; "" is the ungrouped bucket, which is a real one. Replace, not
   * push - re-cutting the list is looking, not travelling.
   */
  const searchParams = useSearch({ from: "/starred" });
  const navigate = useNavigate();
  const filter = () => searchParams().group ?? null;
  const setFilter = (group: string | null) =>
    void navigate({
      to: "/starred",
      search: group === null ? {} : { group },
      replace: true,
    });
  /*
   * One sheet, two questions: where an existing star should move to, and
   * where a new one should land. Both end in a group, so both are asked the
   * same way - the asker just says what the answer is for.
   */
  const [asking, setAsking] = createSignal<GroupAsk | null>(null);
  const [groupOpen, setGroupOpen] = createSignal(false);
  const [sortOpen, setSortOpen] = createSignal(false);
  /** The star whose stop is being changed, while the stop sheet is up. */
  const [restopping, setRestopping] = createSignal<Resolved | null>(null);
  const [stopOpen, setStopOpen] = createSignal(false);
  /** Which star has its swipe deeds showing; one at a time. */
  const [openStar, setOpenStar] = createSignal<string | null>(null, { ownedWrite: true });

  createEffect(
    () => openStar(),
    (id) => {
      if (!id) return;
      const close = (event: PointerEvent) => {
        const target = event.target as HTMLElement | null;
        if (target?.closest("[data-star-id]")) return;
        setOpenStar(null);
      };
      document.addEventListener("pointerdown", close);
      return () => document.removeEventListener("pointerdown", close);
    },
  );

  /*
   * The arrivals table, read two ways: every row, to hand each card its
   * buses, and the rows ranked by the next arrival, which is the order the
   * "soonest" sort shows. Both are live queries over the same collection, so
   * a bus that comes in on the next poll moves its card without anything
   * here being told. Read only once the table has answered; before that the
   * cards show their skeletons, the same as they did while each fetched its
   * own.
   */
  const table = createLiveQuery<Arrival>((q) => q.from({ a: arrivals }));
  const ranked = createLiveQuery<Arrival>((q) =>
    q.from({ a: arrivals }).orderBy(({ a }) => a.next, "asc"),
  );
  const arrivalOf = createMemo(() => {
    const byId = new Map<string, Arrival>();
    if (table.isReady) for (const row of table()) byId.set(row.id, row);
    return byId;
  });
  const rankOf = createMemo(() => {
    const rank = new Map<string, number>();
    if (ranked.isReady) ranked().forEach((row, index) => rank.set(row.id, index));
    return rank;
  });

  /*
   * Referentially stable: a card whose content has not changed gets the same
   * object back, so `For` moves its node instead of rebuilding it. This is
   * what makes a drag smooth - a reorder only changes each star's rank,
   * and rebuilding every card's DOM on every crossing dropped frames. The
   * comparison deliberately ignores `order`: rank is read from the list's
   * position, never off the card.
   */
  const resolved = createMemo<Resolved[]>((prev) => {
    const before = new Map((prev ?? []).map((r) => [r.item.id, r]));
    return starred.items().flatMap((item) => {
      if (isStopStar(item)) {
        const stop = db().stopList[item.stopId];
        const members = new Set<string>([item.stopId]);
        for (const [, alias] of db().stopMap[item.stopId] ?? []) members.add(alias);
        const calling = routesAtCluster(db(), [...members]);
        const next: Resolved = {
          item,
          stop,
          stopName: stop ? stripStopCode(pick(stop.name, lang())) : "",
          running: calling.some((at) => isRunningNow(db(), at.route)),
        };
        const old = before.get(item.id);
        const same =
          old &&
          !old.route &&
          old.stop === next.stop &&
          old.stopName === next.stopName &&
          old.running === next.running &&
          old.item.group === item.group &&
          old.item.pinned === item.pinned &&
          old.item.stopId === item.stopId;
        return [same ? old : next];
      }
      const route = routeAt(db(), item.routeKey);
      if (!route) return [];
      const stop = db().stopList[item.stopId];
      const next: Resolved = {
        item,
        route,
        stop,
        stopName: stop ? stripStopCode(pick(stop.name, lang())) : "",
        running: isRunningNow(db(), route),
      };
      const old = before.get(item.id);
      const same =
        old &&
        old.route === next.route &&
        old.stop === next.stop &&
        old.stopName === next.stopName &&
        old.running === next.running &&
        old.item.group === item.group &&
        old.item.pinned === item.pinned &&
        old.item.stopId === item.stopId &&
        old.item.co === item.co &&
        old.item.seq === item.seq;
      return [same ? old : next];
    });
  });

  const metresTo = (entry: Resolved) => {
    const here = position();
    return here && entry.stop ? distanceM(here, entry.stop.location) : null;
  };

  /*
   * Stars whose route has finished for the night are moved out of the way
   * rather than deleted - they are still yours, they are just not useful at
   * two in the morning.
   *
   * A card that turns out to have live arrivals reports back and stays put for
   * the rest of the session; the latch never clears, so a card can never
   * oscillate between the two sections as its feed refreshes.
   */
  const [live, setLive] = createSignal<Record<string, true>>({}, { ownedWrite: true });
  createEffect(
    () =>
      resolved()
        .filter((r) => (arrivalOf().get(r.item.id)?.etas.length ?? 0) > 0)
        .map((r) => r.item.id),
    (ids) => {
      setLive((prev) => {
        const missing = ids.filter((id) => !prev[id]);
        if (missing.length === 0) return prev;
        const next = { ...prev };
        for (const id of missing) next[id] = true;
        return next;
      });
    },
  );

  const isResting = (r: Resolved) => !r.running && !live()[r.item.id];

  /** Groups that exist, so the filter can only offer real ones. */
  const groups = createMemo(() => starred.groups());
  const hasUngrouped = createMemo(() => resolved().some((r) => r.item.group === ""));

  const matchesFilter = (r: Resolved) => filter() === null || r.item.group === filter();

  const order = () => settings.starredOrder();
  createEffect(
    () => settings.starredOrder(),
    () => {
      // Braced on purpose: the setter's return value must not become the
      // effect's cleanup - Solid 2's dev assertion halts the screen over it.
      setHandOrder(null);
      setOpenStar(null);
    },
  );
  /** The stored order: how the stars were made, or the last adopted ranking. */
  const manual = () => order() === "manual";

  const sort = (list: Resolved[]): Resolved[] => {
    switch (order()) {
      case "eta":
        // The table's own order; a star it has not answered for yet goes last.
        return [...list].sort(
          (a, b) =>
            (rankOf().get(a.item.id) ?? NO_ARRIVAL) - (rankOf().get(b.item.id) ?? NO_ARRIVAL),
        );
      case "distance":
        return [...list].sort((a, b) => (metresTo(a) ?? NO_ARRIVAL) - (metresTo(b) ?? NO_ARRIVAL));
      case "route":
        return [...list].sort(
          (a, b) =>
            (a.route?.route ?? a.stopName).localeCompare(b.route?.route ?? b.stopName, "en", {
              numeric: true,
            }) || a.stopName.localeCompare(b.stopName),
        );
      default: {
        // The stored order - unless a drag just made a newer one, which the
        // store has not caught up with yet.
        const hand = handOrder();
        if (!hand) return list;
        const rank = new Map(hand.map((id, at) => [id, at]));
        return [...list].sort(
          (a, b) => (rank.get(a.item.id) ?? NO_ARRIVAL) - (rank.get(b.item.id) ?? NO_ARRIVAL),
        );
      }
    }
  };

  /*
   * Pinned stars come out of the list entirely and sit in a band of their
   * own at the top, ranked among themselves by whatever order is in force.
   *
   * Pinning beats the dormant section too: a route that has finished for the
   * night is demoted because nothing asked for it, and a pin is exactly that
   * asking. The card still dims itself, so a pinned star with no buses
   * looks as quiet as it is without being moved out from under the thumb.
   */
  const pinned = createMemo(() =>
    sort(resolved().filter((r) => r.item.pinned && matchesFilter(r))),
  );
  const active = createMemo(() =>
    sort(resolved().filter((r) => !r.item.pinned && !isResting(r) && matchesFilter(r))),
  );
  const resting = createMemo(() =>
    sort(resolved().filter((r) => !r.item.pinned && isResting(r) && matchesFilter(r))),
  );

  /*
   * One flat list, pinned first, in every order: each card wears its group
   * as a coloured tag, so cutting the list into headed group sections said
   * the same thing twice and cost a band of chrome per group.
   */
  const listed = createMemo(() => [...pinned(), ...active()]);

  /** Reminders that are armed right now, so they can be seen and called off. */
  const armed = createMemo(() =>
    alerts.items().flatMap((alert) => {
      const route = routeAt(db(), alert.routeKey);
      if (!route) return [];
      const stop = db().stopList[alert.stopId];
      return [{ alert, route, stopName: stop ? stripStopCode(pick(stop.name, lang())) : "" }];
    }),
  );

  /** Routes opened often enough to be worth offering as a star. */
  const suggestions = createMemo(() =>
    frequent.top(3).flatMap((key) => {
      const route = routeAt(db(), key);
      return route && !starred.items().some((i) => i.routeKey === key) ? [route] : [];
    }),
  );

  const orders = (): SortChoice<StarredOrder>[] => [
    { value: "manual", label: t("sortManual", lang()), hint: t("sortManualHint", lang()) },
    { value: "eta", label: t("sortEta", lang()), hint: t("sortEtaHint", lang()) },
    { value: "distance", label: t("sortDistance", lang()), hint: t("sortDistanceHint", lang()) },
    { value: "route", label: t("sortRoute", lang()), hint: t("sortRouteHint", lang()) },
  ];

  const askGroup = (ask: GroupAsk) => {
    setAsking(ask);
    requestAnimationFrame(() => setGroupOpen(true));
  };

  /*
   * Reordering is SortableJS's job: the drag preview, the cards gliding out
   * of the way, touch, auto-scroll - a solved problem, taken off the shelf.
   * The split of duties is the standard one for a rendered list: Sortable
   * owns the DOM only while the finger is down; on drop its DOM move is
   * reverted, and the new order is written to the store for Solid to render
   * - one authority over the list at a time.
   */
  const sorters = new Set<Sortable>();
  createEffect(
    () => manual(),
    (hand) => {
      for (const sorter of sorters) sorter.option("disabled", !hand);
    },
  );

  const sortableGrid = (el: HTMLDivElement) => {
    /*
     * Where inside the card the finger picked it up. The preview keeps
     * this grip point, so release point minus grip is where the rider
     * last saw the card - the place the drop settle has to start from.
     */
    let grip = { x: 0, y: 0 };
    const pointOf = (raw: Event | undefined) => {
      if (!raw) return null;
      const source = "changedTouches" in raw ? (raw as TouchEvent).changedTouches[0] : raw;
      const at = source as { clientX?: number; clientY?: number } | undefined;
      return at?.clientX !== undefined && at?.clientY !== undefined
        ? { x: at.clientX, y: at.clientY }
        : null;
    };

    const sorter = Sortable.create(el, {
      group: "starred",
      handle: "[data-drag-handle]",
      draggable: "[data-star-id]",
      filter: "[data-held]",
      disabled: !untrack(manual),
      animation: 250,
      easing: "cubic-bezier(0.25, 1, 0.4, 1)",
      // Cards give way once the preview is two-thirds over them, rather
      // than demanding a full eclipse before anything moves.
      swapThreshold: 0.65,
      // Sortable's own drag preview on every input, not the browser's
      // native HTML5 image: consistent, and it can be styled as a lift.
      forceFallback: true,
      fallbackOnBody: true,
      fallbackClass: "app-lift",
      ghostClass: "app-drag-ghost",
      onStart: (evt) => {
        setOpenStar(null);
        const at = pointOf((evt as { originalEvent?: Event }).originalEvent);
        const rect = evt.item.getBoundingClientRect();
        grip = at ? { x: at.x - rect.left, y: at.y - rect.top } : { x: 0, y: 0 };
      },
      onEnd: (evt) => {
        const item = evt.item as HTMLElement;
        const id = item.dataset.starId;

        // The visual order at the moment of the drop, over every section.
        const ids = [...document.querySelectorAll<HTMLElement>("[data-star-id]")]
          .map((card) => card.dataset.starId)
          .filter((value): value is string => Boolean(value));

        // Hand the DOM back before the store speaks: Sortable's move is
        // undone so Solid's list model and the document agree, then the
        // render replays the move from the data.
        const from = evt.from as HTMLElement;
        const siblings = [...from.children].filter((child) => child !== item);
        from.insertBefore(item, siblings[evt.oldIndex ?? 0] ?? null);

        if (!id) return;
        /*
         * Rendered from the mirror in the same task as the drop - flushed,
         * so the DOM below is already the new order - while the collection
         * write catches up on its own schedule. Without the mirror there
         * was a painted frame of the old order between the two.
         */
        setHandOrder(ids);
        flush();
        starred.adopt(ids);

        /*
         * The settle. Sortable's preview vanishes on release and the card
         * would simply appear in its slot; instead the rendered card is
         * played from where the preview was let go - release point minus
         * the grip - into rest, shedding the lift on the way. Individual
         * transform properties, so nothing else on the card is disturbed.
         * Measured now, synchronously: the flush above has already put the
         * card in its final slot.
         */
        const released = pointOf((evt as { originalEvent?: Event }).originalEvent);
        if (!released || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
        {
          const card = [...document.querySelectorAll<HTMLElement>("[data-star-id]")].find(
            (node) => node.dataset.starId === id,
          );
          if (!card) return;
          const rest = card.getBoundingClientRect();
          const dx = released.x - grip.x - rest.left;
          const dy = released.y - grip.y - rest.top;
          if (Math.abs(dx) < 2 && Math.abs(dy) < 2) return;
          card.animate(
            [
              {
                translate: `${dx}px ${dy}px`,
                scale: "1.03",
                rotate: "-0.5deg",
                boxShadow: "0 12px 32px rgb(0 0 0 / 0.22)",
              },
              {
                translate: "0px 0px",
                scale: "1",
                rotate: "0deg",
                boxShadow: "0 0 0 rgb(0 0 0 / 0)",
              },
            ],
            { duration: 320, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
          );
        }
      },
    });
    sorters.add(sorter);
    onCleanup(() => {
      sorters.delete(sorter);
      sorter.destroy();
    });
  };

  /*
   * A pinned card's place in the list is not the hand-arranged one, so it
   * does not offer a grip that would move it somewhere it is not.
   */
  const rowFor = (entry: Resolved) => (
    <StarredRow
      entry={entry}
      lang={lang()}
      metres={metresTo(entry)}
      arrival={arrivalOf().get(entry.item.id)}
      draggable={manual() && !entry.item.pinned}
      open={openStar() === entry.item.id}
      onOpen={() => setOpenStar(entry.item.id)}
      onClose={() => {
        if (openStar() === entry.item.id) setOpenStar(null);
      }}
      onEngage={() => {
        if (openStar() !== entry.item.id) setOpenStar(null);
      }}
      onRemove={() => starred.remove(entry.item.id)}
      onRegroup={() =>
        askGroup({
          current: entry.item.group,
          apply: (group) => starred.setGroup(entry.item.id, group),
        })
      }
      onRestop={() => {
        setRestopping(entry);
        requestAnimationFrame(() => setStopOpen(true));
      }}
      onPin={() => starred.togglePin(entry.item.id)}
    />
  );

  return (
    <Page>
      <ScreenTitle
        title={t("starred", lang())}
        /*
         * Which stars to look at, in the band rather than under it. The
         * chips take whatever width the order chip leaves and scroll sideways
         * past it: a filter row that holds a whole row of the screen open is
         * paying list space for a question most riders answer once, and with
         * the title spoken rather than drawn there was an empty half of the
         * header sitting directly above it.
         */
        trailing={
          <Show when={resolved().length > 0 && groups().length > 0}>
            <div class="app-scroll flex min-w-0 flex-1 items-center gap-2 overflow-x-auto py-0.5">
              <FilterChip
                label={t("allItems", lang())}
                active={filter() === null}
                onSelect={() => setFilter(null)}
              />
              <For each={groups()}>
                {(group) => (
                  <FilterChip
                    label={group}
                    color={groupColorVar(groupColor(group))}
                    active={filter() === group}
                    onSelect={() => setFilter(group)}
                  />
                )}
              </For>
              <Show when={hasUngrouped()}>
                <FilterChip
                  label={t("ungrouped", lang())}
                  active={filter() === ""}
                  onSelect={() => setFilter("")}
                />
              </Show>
            </div>
          </Show>
        }
        controls={
          <Show when={resolved().length > 0}>
            {/* Order is a setting made once, so it rides in the header as
                the question rather than holding a row open above the list
                for ever. The same quiet chip the other screens put in their
                headers - at pill size it outweighed the title it sat beside. */}
            <SortTrigger label={t("sortBy", lang())} onClick={() => setSortOpen(true)} />
          </Show>
        }
      />

      {/*
       * Above the stars, and outside them: a reminder can be armed from
       * any route, so a rider with no stars at all could otherwise have a
       * live alert with nowhere on the screen that admits it exists.
       */}
      <Show when={armed().length > 0}>
        <Section>
          <SectionLabel
            trailing={
              <span class="tnum text-[0.75rem] font-semibold text-faint-foreground">
                {armed().length}
              </span>
            }
          >
            {t("alerts", lang())}
          </SectionLabel>
          <RowCard>
            <For each={armed()}>
              {(entry) => (
                <div class="flex items-center gap-3 px-3.5 py-2.5">
                  <RoutePlate route={entry.route.route} co={entry.route.co} size="sm" />
                  <div class="flex min-w-0 grow flex-col gap-0.5">
                    <span class="truncate text-[0.88rem] font-bold text-foreground">
                      {entry.stopName}
                    </span>
                    <span class="truncate text-[0.75rem] font-medium text-subtle-foreground">
                      {entry.alert.kind === "arrival"
                        ? `${t("alertArrival", lang())} · ${entry.alert.leadMinutes} ${t("minute", lang())}`
                        : `${t("alertDestination", lang())} · ${entry.alert.radiusM} m`}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => alerts.remove(entry.alert.id)}
                    class="flex h-7 shrink-0 items-center gap-1.5 rounded-full bg-secondary px-3 text-[0.75rem] font-bold text-destructive"
                  >
                    <AlarmIcon size={11} />
                    {t("alertOff", lang())}
                  </button>
                </div>
              )}
            </For>
          </RowCard>
        </Section>
      </Show>

      <Show
        when={resolved().length > 0}
        fallback={
          <div class="flex flex-col gap-6">
            <EmptyState title={t("emptyStarred", lang())} hint={t("emptyStarredHint", lang())} />

            {/* Rather than an empty screen, offer the routes already being
                checked most often - one tap to keep them here. */}
            <Show when={suggestions().length > 0}>
              <Section>
                <SectionLabel>{t("starThese", lang())}</SectionLabel>
                <RowCard>
                  <For each={suggestions()}>
                    {(route) => (
                      <div class="flex items-center gap-3 px-3.5 py-2.5">
                        <RoutePlate route={route.route} co={route.co} size="sm" />
                        <span class="flex min-w-0 grow items-center gap-1.5">
                          <span class="min-w-0 truncate text-[0.88rem] font-bold text-foreground">
                            {t("towards", lang())} {pick(route.dest, lang())}
                          </span>
                          <Show when={isSpecialService(route)}>
                            <SpecialTag lang={lang()} />
                          </Show>
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            const co = route.co[0] ?? "kmb";
                            const stopId = route.stops[co]?.[0];
                            if (!stopId) return;
                            // Made here, grouped here - the same question the
                            // star on a route asks before it saves anything.
                            askGroup({
                              current: "",
                              confirm: t("addStar", lang()),
                              apply: (group) =>
                                starred.toggle({ routeKey: route.key, co, stopId, seq: 1, group }),
                            });
                          }}
                          class="flex h-7 shrink-0 items-center gap-1.5 rounded-full bg-primary px-2.5 text-[0.75rem] font-bold text-primary-foreground"
                        >
                          <StarIcon size={12} />
                          {t("addStar", lang())}
                        </button>
                      </div>
                    )}
                  </For>
                </RowCard>
              </Section>
            </Show>
          </div>
        }
      >
        <div class="flex flex-col gap-6">
          <Show when={position() === null}>
            <p class="-mb-3 text-[0.75rem] font-medium text-subtle-foreground">
              {t("noLocation", lang())}
            </p>
          </Show>

          <Show
            when={pinned().length > 0 || active().length > 0 || resting().length > 0}
            fallback={<EmptyState title={t("nothingInFilter", lang())} />}
          >
            <Show when={listed().length > 0}>
              <RowCard ref={sortableGrid}>
                <For each={listed()}>{(entry) => rowFor(entry)}</For>
              </RowCard>
            </Show>

            <Show when={resting().length > 0}>
              <Section>
                <SectionLabel>{t("notRunning", lang())}</SectionLabel>
                <RowCard ref={sortableGrid}>
                  <For each={resting()}>{(entry) => rowFor(entry)}</For>
                </RowCard>
              </Section>
            </Show>
          </Show>
        </div>
      </Show>

      <SortSheet
        open={sortOpen()}
        onClose={() => setSortOpen(false)}
        value={order()}
        options={orders()}
        onChoose={(value) => {
          // Switching to the stored order keeps the order already on screen:
          // the ranking being looked at becomes the stored arrangement.
          if (value === "manual" && order() !== "manual") {
            starred.adopt(sort(resolved()).map((r) => r.item.id));
          }
          settings.setStarredOrder(value);
        }}
        lang={lang()}
      />

      <Show when={asking()}>
        {(ask) => (
          <GroupSheet
            open={groupOpen()}
            onClose={() => setGroupOpen(false)}
            groups={groups()}
            current={ask().current}
            confirmLabel={ask().confirm}
            onChoose={(group) => ask().apply(group)}
            lang={lang()}
          />
        )}
      </Show>

      {/* Keyed: a different star is a different sheet, so the child takes
          the entry itself. The accessor form threw a stale-value error the
          moment the portalled list read it, and there is nothing here that
          wants to survive the entry changing. */}
      <Show when={restopping()} keyed>
        {(entry) => (
          <Show when={entry.route}>
            {(route) => (
              <StopSheet
                open={stopOpen()}
                onClose={() => setStopOpen(false)}
                route={route()}
                co={entry.item.co}
                stopId={entry.item.stopId}
                onChoose={(choice) => starred.retarget(entry.item.id, choice)}
                lang={lang()}
              />
            )}
          </Show>
        )}
      </Show>
    </Page>
  );
}

/** One group in the filter row, including the "everything" pseudo-group. */
function FilterChip(props: {
  label: string;
  /** The group's colour: the chip's whole ground is painted with it. */
  color?: string;
  active: boolean;
  onSelect: () => void;
}) {
  /*
   * Inline, because the chosen-state utility rules would otherwise repaint
   * the chip in the accent: a group chip answers in its own colour - a tinted
   * ground while open, the full colour once chosen, with the page's ground
   * colour as ink, which reads on a mid-tone in the light theme and on a
   * bright one in the dark.
   */
  const paint = () =>
    props.color
      ? props.active
        ? { background: props.color, color: "var(--background)" }
        : {
            background: `color-mix(in srgb, ${props.color} 15%, transparent)`,
            color: props.color,
          }
      : undefined;

  return (
    <button
      type="button"
      aria-pressed={props.active ? "true" : "false"}
      onClick={props.onSelect}
      style={paint()}
      class={[
        "flex h-[1.6rem] shrink-0 items-center rounded-full px-2.5 text-[0.75rem] font-bold transition-colors duration-150",
        {
          "bg-primary text-primary-foreground": props.active && !props.color,
          "bg-secondary text-subtle-foreground": !props.active && !props.color,
        },
      ]}
    >
      {props.label}
    </button>
  );
}
