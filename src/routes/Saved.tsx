import { groupBy } from "es-toolkit";
import { For, Show, createEffect, createMemo, createSignal } from "solid-js";
import { Card, EmptyState, Hairline, ScreenTitle, SectionLabel } from "~/components/Chrome";
import { EtaCountdown } from "~/components/EtaCountdown";
import { GroupSheet } from "~/components/GroupSheet";
import { SortSheet, type SortChoice } from "~/components/SortSheet";
import {
  AlarmIcon,
  BookmarkIcon,
  GripIcon,
  LayersIcon,
  MinusIcon,
  SortIcon,
  WalkIcon,
} from "~/components/Icons";
import { RoutePlate } from "~/components/RoutePlate";
import { Page, Section } from "~/components/Layout";
import { routeHref } from "~/components/RouteRow";
import { useDb } from "~/data/context";
import { routeAt } from "~/data/db";
import { isRunningNow } from "~/data/schedule";
import type { Eta, KeyedRoute, StopEntry } from "~/data/types";
import { stopIdsFor, useEta } from "~/data/useEta";
import { countdown } from "~/lib/format";
import { distanceM, walkMinutes } from "~/lib/geo";
import { pick, stripStopCode, t, type Lang } from "~/lib/i18n";
import { alerts } from "~/stores/alerts";
import { frequent } from "~/stores/frequent";
import { useGeolocation } from "~/stores/geolocation";
import { now } from "~/stores/clock";
import { saved, type SavedItem } from "~/stores/saved";
import { settings, type SavedOrder } from "~/stores/settings";

/** A question the group sheet is being opened to ask, and what to do with it. */
interface GroupAsk {
  current: string;
  /** Set when the answer makes a bookmark rather than moves one. */
  confirm?: string;
  apply: (group: string) => void;
}

/** Matches the rendered row height, used to turn a drag offset into an index. */
const ROW_HEIGHT = 78;

/** The value that sorts a bookmark with no arrival to the end of the list. */
const NO_ARRIVAL = Number.POSITIVE_INFINITY;

interface Resolved {
  item: SavedItem;
  route: KeyedRoute;
  stop: StopEntry | undefined;
  stopName: string;
  running: boolean;
}

/**
 * When to set off, rather than when the bus arrives.
 *
 * A bookmark is somewhere you go regularly, so the useful number is not "the
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

function BookmarkCard(props: {
  entry: Resolved;
  lang: Lang;
  metres: number | null;
  editing: boolean;
  dragging: boolean;
  /** Reordering by hand only makes sense while the list is in hand order. */
  draggable: boolean;
  /**
   * Whether the card has to name its own group.
   *
   * Only where nothing else on the screen already has. A hand-ordered list is
   * cut into headed sections and a filtered one is named by the lit chip above
   * it, so the tag in the corner was the third printing of the same word - it
   * earns its place only in a ranked, unfiltered list, where the groups are
   * interleaved and nothing else says which is which.
   */
  showGroup: boolean;
  onRemove: () => void;
  onDrag: (event: PointerEvent) => void;
  onArrivals: () => void;
  onNext: (at: number) => void;
  onRegroup: () => void;
}) {
  const etas = useEta(() => ({
    route: props.entry.route,
    seq: props.entry.item.seq,
    stopIdByCo: stopIdsFor(props.entry.route, props.entry.item.seq),
  }));

  const advice = () => leaveAdvice(etas() ?? [], props.metres, now());

  /*
   * How many arrivals at the top of the stack are already out of reach, so the
   * countdown can promote the first one that is not. `nth` is the index of the
   * catchable arrival; `-1` is "none of them", which is every one of them.
   */
  const unreachable = () => {
    const a = advice();
    if (!a) return 0;
    return a.nth < 0 ? Number.POSITIVE_INFINITY : a.nth;
  };

  /*
   * The timetable says the route has finished, yet the operator is still
   * reporting a bus: trust the bus. The card tells the screen, which moves it
   * back out of the dormant section.
   */
  createEffect(
    () => (etas()?.length ?? 0) > 0,
    (live) => {
      if (live) props.onArrivals();
    },
  );

  /*
   * The soonest arrival, reported upward. Only the card knows it - each one
   * fetches its own feed - and the screen needs it to be able to rank the list
   * by which bus comes first.
   */
  createEffect(
    () => etas()?.[0]?.at.getTime() ?? NO_ARRIVAL,
    (at) => {
      // Braces on purpose: an effect that returns anything but a cleanup
      // function is an error in Solid 2, and a setter returns its new value.
      props.onNext(at);
    },
  );

  const dim = () => !props.entry.running && etas()?.length === 0;
  const alerted = () =>
    alerts.has("arrival", props.entry.route.key, props.entry.item.stopId) ||
    alerts.has("destination", props.entry.route.key, props.entry.item.stopId);

  return (
    <div
      class={[
        "mb-press overflow-hidden rounded-xl border bg-card shadow-card transition-shadow duration-state motion-safe:mb-rise",
        {
          "border-primary shadow-lg": props.dragging,
          "border-border": !props.dragging,
          "opacity-60": dim(),
        },
      ]}
      style={props.dragging ? { transform: "scale(1.02) rotate(-0.6deg)" } : undefined}
    >
      <div class="flex items-center gap-3 px-3.5 py-3">
        <Show when={props.editing && props.draggable}>
          <button
            type="button"
            aria-label="reorder"
            class="cursor-grab touch-none text-faint-foreground"
            onPointerDown={props.onDrag}
          >
            <GripIcon size={17} />
          </button>
        </Show>

        <RoutePlate
          route={props.entry.route.route}
          co={props.entry.route.co}
          size="md"
          muted={dim()}
        />

        <a href={routeHref(props.entry.route.key)} class="flex min-w-0 grow flex-col gap-0.5">
          <span class="truncate text-[0.94rem] font-bold tracking-[-0.01em] text-foreground">
            {t("towards", props.lang)} {pick(props.entry.route.dest, props.lang)}
          </span>
          <span class="truncate text-[0.75rem] font-medium text-subtle-foreground">
            {[
              props.entry.stopName,
              props.metres !== null
                ? `${t("walkMinutes", props.lang)} ${walkMinutes(props.metres)} ${t("minute", props.lang)}`
                : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </span>
        </a>

        {/* An armed reminder belongs on the card it was set from, not only on
            the screen that set it. */}
        <Show when={alerted() && !props.editing}>
          <span class="shrink-0 text-primary" title={t("alertOn", props.lang)}>
            <AlarmIcon size={14} />
          </span>
        </Show>

        <Show
          when={!props.editing}
          fallback={
            <div class="flex shrink-0 items-center gap-2">
              {/* Grouping is an editing action, so it lives where the other
                  editing actions are rather than behind a long press. */}
              <button
                type="button"
                onClick={props.onRegroup}
                class="flex h-7 max-w-[7rem] items-center gap-1.5 rounded-full bg-secondary px-2.5 text-[0.75rem] font-bold text-muted-foreground"
              >
                <LayersIcon size={11} />
                <span class="truncate">{props.entry.item.group || t("noGroup", props.lang)}</span>
              </button>
              <button
                type="button"
                aria-label="remove"
                onClick={props.onRemove}
                class="flex size-7 items-center justify-center rounded-full text-destructive"
                style={{ background: "color-mix(in srgb, var(--destructive) 14%, transparent)" }}
              >
                <MinusIcon size={13} />
              </button>
            </div>
          }
        >
          <EtaCountdown
            etas={etas()}
            lang={props.lang}
            size="md"
            limit={2}
            unreachable={unreachable()}
          />
        </Show>
      </div>

      {/* The one line that turns arrival times into a decision. */}
      <Show when={!props.editing && advice()}>
        {(a) => (
          <div
            class="flex items-center gap-2 border-t border-border px-3.5 py-2"
            /*
             * Urgency as an edge, not as a slab. Filled solid, the strip was
             * the loudest surface on the screen - and with two bookmarks due
             * at once the list became two indigo bars arguing with thered route
             * plates between them. A rule down the left says the same thing at
             * a tenth of the volume, and it says it at the edge the eye
             * already runs down.
             */
            style={
              a().urgent
                ? {
                    "box-shadow": "inset 3px 0 0 var(--primary)",
                    background: "color-mix(in srgb, var(--primary) 7%, transparent)",
                  }
                : undefined
            }
          >
            <span class={a().urgent ? "text-primary" : "text-subtle-foreground"}>
              <WalkIcon size={12} />
            </span>
            {/* Only the dead end needs words. "Catch the next one" was the
                struck-out arrival above saying itself a second time. */}
            <Show when={a().nth < 0}>
              <span class="text-[0.81rem] font-semibold text-faint-foreground">
                {t("tooLate", props.lang)}
              </span>
            </Show>

            <Show when={a().leaveIn !== null}>
              <span
                class={[
                  "tnum text-[0.81rem] font-bold",
                  { "text-primary": a().urgent, "text-subtle-foreground": !a().urgent },
                ]}
              >
                <Show when={a().leaveIn! > 0} fallback={t("leaveNow", props.lang)}>
                  {a().leaveIn} {t("leaveIn", props.lang)}
                </Show>
              </span>
            </Show>

            {/* The group, said once, on the side the eye is already leaving. */}
            <Show when={props.showGroup && props.entry.item.group}>
              <span class="ml-auto shrink-0 truncate text-[0.75rem] font-bold uppercase tracking-[0.1em] text-faint-foreground">
                {props.entry.item.group}
              </span>
            </Show>
          </div>
        )}
      </Show>
    </div>
  );
}

export default function Saved() {
  const db = useDb();
  const lang = settings.lang;
  const { position } = useGeolocation();
  const [editing, setEditing] = createSignal(false);
  const [dragId, setDragId] = createSignal<string | null>(null);
  /** `null` is "every group"; "" is the ungrouped bucket, which is a real one. */
  const [filter, setFilter] = createSignal<string | null>(null);
  /*
   * One sheet, two questions: where an existing bookmark should move to, and
   * where a new one should land. Both end in a group, so both are asked the
   * same way - the asker just says what the answer is for.
   */
  const [asking, setAsking] = createSignal<GroupAsk | null>(null);
  const [groupOpen, setGroupOpen] = createSignal(false);
  const [sortOpen, setSortOpen] = createSignal(false);

  const resolved = createMemo<Resolved[]>(() =>
    saved.items().flatMap((item) => {
      const route = routeAt(db(), item.routeKey);
      if (!route) return [];
      const stop = db().stopList[item.stopId];
      return [
        {
          item,
          route,
          stop,
          stopName: stop ? stripStopCode(pick(stop.name, lang())) : "",
          running: isRunningNow(db(), route),
        },
      ];
    }),
  );

  const metresTo = (entry: Resolved) => {
    const here = position();
    return here && entry.stop ? distanceM(here, entry.stop.location) : null;
  };

  /*
   * Bookmarks whose route has finished for the night are moved out of the way
   * rather than deleted - they are still yours, they are just not useful at
   * two in the morning.
   *
   * A card that turns out to have live arrivals reports back and stays put for
   * the rest of the session; the latch never clears, so a card can never
   * oscillate between the two sections as its feed refreshes.
   */
  const [live, setLive] = createSignal<Record<string, true>>({}, { ownedWrite: true });
  const noteArrivals = (id: string) =>
    setLive((prev) => (prev[id] ? prev : { ...prev, [id]: true }));

  /*
   * Every card's soonest arrival, collected here so the list can be ranked by
   * it. Each card owns its own feed, so this is the only place the whole set
   * of them exists at once.
   */
  const [nextAt, setNextAt] = createSignal<Record<string, number>>({}, { ownedWrite: true });
  const noteNext = (id: string, at: number) =>
    setNextAt((prev) => (prev[id] === at ? prev : { ...prev, [id]: at }));

  const isResting = (r: Resolved) => !r.running && !live()[r.item.id];

  /** Groups that exist, so the filter can only offer real ones. */
  const groups = createMemo(() => saved.groups());
  const hasUngrouped = createMemo(() => resolved().some((r) => r.item.group === ""));

  const matchesFilter = (r: Resolved) => filter() === null || r.item.group === filter();

  const order = () => settings.savedOrder();
  /** Hand order is the only one a drag can rearrange. */
  const manual = () => order() === "manual";

  const sort = (list: Resolved[]): Resolved[] => {
    switch (order()) {
      case "eta":
        return [...list].sort(
          (a, b) => (nextAt()[a.item.id] ?? NO_ARRIVAL) - (nextAt()[b.item.id] ?? NO_ARRIVAL),
        );
      case "distance":
        return [...list].sort((a, b) => (metresTo(a) ?? NO_ARRIVAL) - (metresTo(b) ?? NO_ARRIVAL));
      case "route":
        return [...list].sort(
          (a, b) =>
            a.route.route.localeCompare(b.route.route, "en", { numeric: true }) ||
            a.stopName.localeCompare(b.stopName),
        );
      default:
        // The stored order is the hand-dragged one; leave it exactly as it is.
        return list;
    }
  };

  const active = createMemo(() =>
    sort(resolved().filter((r) => !isResting(r) && matchesFilter(r))),
  );
  const resting = createMemo(() =>
    sort(resolved().filter((r) => isResting(r) && matchesFilter(r))),
  );

  /*
   * Sections only where they mean something. Hand order is the rider's own
   * arrangement, so it keeps its group headings; any other order is a single
   * ranked list, and a heading in the middle of one would be a claim the
   * ranking does not make.
   */
  const groupedActive = createMemo<[string, Resolved[]][]>(() => {
    if (!manual() || filter() !== null) return [["", active()]];
    const buckets = groupBy(active(), (r) => r.item.group);
    return Object.entries(buckets).sort(([a], [b]) => (a === "" ? 1 : b === "" ? -1 : 0));
  });

  /** Reminders that are armed right now, so they can be seen and called off. */
  const armed = createMemo(() =>
    alerts.items().flatMap((alert) => {
      const route = routeAt(db(), alert.routeKey);
      if (!route) return [];
      const stop = db().stopList[alert.stopId];
      return [{ alert, route, stopName: stop ? stripStopCode(pick(stop.name, lang())) : "" }];
    }),
  );

  /** Routes opened often enough to be worth offering as a bookmark. */
  const suggestions = createMemo(() =>
    frequent.top(3).flatMap((key) => {
      const route = routeAt(db(), key);
      return route && !saved.items().some((i) => i.routeKey === key) ? [route] : [];
    }),
  );

  const orders = (): SortChoice<SavedOrder>[] => [
    { value: "manual", label: t("sortManual", lang()), hint: t("sortManualHint", lang()) },
    { value: "eta", label: t("sortEta", lang()), hint: t("sortEtaHint", lang()) },
    { value: "distance", label: t("sortDistance", lang()), hint: t("sortDistanceHint", lang()) },
    { value: "route", label: t("sortRoute", lang()), hint: t("sortRouteHint", lang()) },
  ];

  /** What the header button wears: the answer, not the name of the question. */
  const orderLabel = () => orders().find((o) => o.value === order())?.label ?? "";

  const askGroup = (ask: GroupAsk) => {
    setAsking(ask);
    requestAnimationFrame(() => setGroupOpen(true));
  };

  const startDrag = (event: PointerEvent, id: string, index: number) => {
    event.preventDefault();
    const handle = event.currentTarget as HTMLElement;
    handle.setPointerCapture(event.pointerId);
    setDragId(id);

    const startY = event.clientY;
    const flat = resolved();
    const baseIndex = flat.findIndex((r) => r.item.id === id);

    const onMove = (move: PointerEvent) => {
      const delta = Math.round((move.clientY - startY) / ROW_HEIGHT);
      const next = Math.max(0, Math.min(flat.length - 1, baseIndex + delta));
      if (next !== index) saved.reorder(id, next);
    };
    const onUp = () => {
      setDragId(null);
      handle.releasePointerCapture(event.pointerId);
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
    };
    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
  };

  const cardFor = (entry: Resolved, index: number) => (
    <BookmarkCard
      entry={entry}
      lang={lang()}
      metres={metresTo(entry)}
      editing={editing()}
      draggable={manual()}
      showGroup={!manual() && filter() === null}
      dragging={dragId() === entry.item.id}
      onRemove={() => saved.remove(entry.item.id)}
      onDrag={(e) => startDrag(e, entry.item.id, index)}
      onArrivals={() => noteArrivals(entry.item.id)}
      onNext={(at) => noteNext(entry.item.id, at)}
      onRegroup={() =>
        askGroup({
          current: entry.item.group,
          apply: (group) => saved.setGroup(entry.item.id, group),
        })
      }
    />
  );

  return (
    <Page>
      <ScreenTitle
        title={t("saved", lang())}
        trailing={
          <Show when={resolved().length > 0}>
            <div class="flex items-center gap-2">
              {/* Order is a setting made once, so it rides in the header
                  wearing its own answer rather than holding a row open above
                  the list for ever. */}
              <button
                type="button"
                aria-haspopup="dialog"
                onClick={() => setSortOpen(true)}
                class="mb-press flex h-[2.1rem] min-w-0 items-center gap-1.5 rounded-full bg-secondary pl-3 pr-3.5 text-[0.81rem] font-bold text-muted-foreground"
              >
                <SortIcon size={13} />
                <span class="truncate">{orderLabel()}</span>
              </button>

              <button
                type="button"
                onClick={() => setEditing((e) => !e)}
                class={[
                  "mb-press flex h-[2.1rem] shrink-0 items-center rounded-full px-4 text-[0.88rem] font-bold transition-colors duration-150",
                  {
                    "bg-primary text-primary-foreground": editing(),
                    "bg-secondary text-muted-foreground": !editing(),
                  },
                ]}
              >
                {t(editing() ? "done" : "edit", lang())}
              </button>
            </div>
          </Show>
        }
      />

      {/*
       * Above the bookmarks, and outside them: a reminder can be armed from
       * any route, so a rider with no bookmarks at all could otherwise have a
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
          <Card>
            <For each={armed()}>
              {(entry, index) => (
                <>
                  <Show when={index() > 0}>
                    <Hairline />
                  </Show>
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
                </>
              )}
            </For>
          </Card>
        </Section>
      </Show>

      <Show
        when={resolved().length > 0}
        fallback={
          <div class="flex flex-col gap-6">
            <EmptyState title={t("emptySaved", lang())} hint={t("emptySavedHint", lang())} />

            {/* Rather than an empty screen, offer the routes already being
                checked most often - one tap to keep them here. */}
            <Show when={suggestions().length > 0}>
              <Section>
                <SectionLabel>{t("bookmarkThese", lang())}</SectionLabel>
                <Card>
                  <For each={suggestions()}>
                    {(route, index) => (
                      <>
                        <Show when={index() > 0}>
                          <Hairline />
                        </Show>
                        <div class="flex items-center gap-3 px-3.5 py-2.5">
                          <RoutePlate route={route.route} co={route.co} size="sm" />
                          <span class="min-w-0 grow truncate text-[0.88rem] font-bold text-foreground">
                            {t("towards", lang())} {pick(route.dest, lang())}
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              const co = route.co[0] ?? "kmb";
                              const stopId = route.stops[co]?.[0];
                              if (!stopId) return;
                              // Made here, grouped here - the same question the
                              // pin on a route asks before it saves anything.
                              askGroup({
                                current: "",
                                confirm: t("addBookmark", lang()),
                                apply: (group) =>
                                  saved.toggle({ routeKey: route.key, co, stopId, seq: 1, group }),
                              });
                            }}
                            class="flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-primary px-3 text-[0.81rem] font-bold text-primary-foreground"
                          >
                            <BookmarkIcon size={13} />
                            {t("addBookmark", lang())}
                          </button>
                        </div>
                      </>
                    )}
                  </For>
                </Card>
              </Section>
            </Show>
          </div>
        }
      >
        <div class="flex flex-col gap-6">
          {/*
           * The only band of controls above the list, and it answers one
           * question: which bookmarks to look at. Order is a different kind of
           * question and now lives in the header - two rows of identically
           * shaped pills, one filtering and one sorting, read as one confused
           * control rather than as two.
           */}
          <Show when={groups().length > 0}>
            <div class="-mb-2">
              <div class="flex items-center gap-2 overflow-x-auto pb-0.5 mb-scroll">
                <FilterChip
                  label={t("allItems", lang())}
                  active={filter() === null}
                  onSelect={() => setFilter(null)}
                />
                <For each={groups()}>
                  {(group) => (
                    <FilterChip
                      label={group}
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
            </div>
          </Show>

          <Show when={editing()}>
            <p class="-mb-3 text-[0.75rem] font-medium text-subtle-foreground">
              {manual()
                ? lang() === "zh"
                  ? "拖曳排序 · 撳分組改名 · 撳減號移除"
                  : "Drag to reorder, tap the group to change it, minus to remove"
                : lang() === "zh"
                  ? "揀「自訂」排序先可以拖曳"
                  : "Switch to Manual order to drag"}
            </p>
          </Show>

          <Show when={!editing() && position() === null}>
            <p class="-mb-3 text-[0.75rem] font-medium text-subtle-foreground">
              {t("noLocation", lang())}
            </p>
          </Show>

          <Show
            when={active().length > 0 || resting().length > 0}
            fallback={<EmptyState title={t("nothingInFilter", lang())} />}
          >
            <For each={groupedActive()}>
              {([group, entries]) => (
                <Show when={entries.length > 0}>
                  <Section>
                    <Show when={group !== ""}>
                      <div class="flex items-center gap-2">
                        <span class="text-[0.75rem] font-bold uppercase tracking-[0.16em] text-subtle-foreground">
                          {group}
                        </span>
                        <div class="h-px grow bg-border" />
                      </div>
                    </Show>

                    <div class="flex flex-col gap-2.5">
                      <For each={entries}>{(entry, index) => cardFor(entry, index())}</For>
                    </div>
                  </Section>
                </Show>
              )}
            </For>

            <Show when={resting().length > 0}>
              <Section>
                <SectionLabel>{t("notRunning", lang())}</SectionLabel>
                <div class="flex flex-col gap-2.5">
                  <For each={resting()}>{(entry, index) => cardFor(entry, index())}</For>
                </div>
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
        onChoose={(value) => settings.setSavedOrder(value)}
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
    </Page>
  );
}

/** One group in the filter row, including the "everything" pseudo-group. */
function FilterChip(props: { label: string; active: boolean; onSelect: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={props.active ? "true" : "false"}
      onClick={props.onSelect}
      class={[
        "flex h-[1.6rem] shrink-0 items-center rounded-full px-2.5 text-[0.75rem] font-bold transition-colors duration-150",
        {
          "bg-primary text-primary-foreground": props.active,
          "bg-secondary text-subtle-foreground": !props.active,
        },
      ]}
    >
      {props.label}
    </button>
  );
}
