import { useParams } from "@solidjs/router";
import { For, Show, createEffect, createMemo, createSignal, lazy } from "solid-js";
import { Card, Chip, EmptyState, Reveal, SectionLabel } from "~/components/Chrome";
import { Trail } from "~/components/Breadcrumb";
import { Modal } from "~/components/Modal";
import { RollingNumber } from "~/components/RollingNumber";
import { SplitPage } from "~/components/Layout";
import { EtaCountdown } from "~/components/EtaCountdown";
import { BookmarkIcon, ChevronRightIcon, PinIcon, SwapIcon, WalkIcon } from "~/components/Icons";
import { RoutePlate } from "~/components/RoutePlate";
import { routeHref } from "~/components/RouteRow";
import { useDb } from "~/data/context";
import { useInView } from "~/lib/inView";
import { reverseRoute, routeAt, routeStops } from "~/data/db";
import { routeTimetable } from "~/data/schedule";
import type { Eta, KeyedRoute, RouteDb, StopEntry } from "~/data/types";
import { stopIdsFor, useEta } from "~/data/useEta";
import { concessionFare, countdown, fareAt, formatFare } from "~/lib/format";
import { now } from "~/stores/clock";
import { distanceM, walkMinutes } from "~/lib/geo";
import { pick, stripStopCode, t, type Lang } from "~/lib/i18n";
import { operatorLabel } from "~/lib/operators";
import { useGeolocation } from "~/stores/geolocation";
import { frequent } from "~/stores/frequent";
import { saved } from "~/stores/saved";
import { settings } from "~/stores/settings";

// MapLibre is ~800 kB; keeping it in its own chunk means the rest of the
// route page paints without waiting for it, and it stays cached across deploys.
const RouteMap = lazy(() => import("~/components/RouteMap"));

/**
 * One stop on the route. Arrivals are fetched only while the row is open,
 * which is what makes a 25-stop route affordable: Citybus publishes arrivals
 * per stop, so showing every stop's countdown at once would be 25 requests
 * every poll. Tapping is also how the apps Hong Kong riders already use work.
 */
/** Which days a service-day pattern covers, in words rather than seven flags. */
function daysLabel(flags: string, lang: Lang): string {
  const runs = (i: number) => flags[i] === "1";
  const weekdays = [1, 2, 3, 4, 5].every(runs);

  if (flags === "1111111") return t("daysDaily", lang);
  if (weekdays && !runs(0) && !runs(6)) return t("daysWeekday", lang);
  if (runs(6) && !weekdays && !runs(0)) return t("daysSaturday", lang);
  if (runs(0) && !weekdays && !runs(6)) return t("daysSunday", lang);

  // Anything else - school days, racecourse specials - is listed as the days
  // it actually runs rather than squeezed into a name that would be wrong.
  const names =
    lang === "zh"
      ? ["日", "一", "二", "三", "四", "五", "六"]
      : ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
  const picked = names.filter((_, i) => runs(i));
  return lang === "zh" ? `星期${picked.join("、")}` : picked.join(", ");
}

/**
 * When the route runs, straight from the published timetable.
 *
 * The database has carried this all along and nothing showed it: a rider who
 * misses the last bus should be able to find that out before they are standing
 * at the stop.
 */
function Timetable(props: { db: RouteDb; route: KeyedRoute; lang: Lang }) {
  const groups = createMemo(() => routeTimetable(props.db, props.route));

  return (
    <div class="flex flex-col gap-3">
      <Show
        when={groups().length > 0}
        fallback={
          <span class="text-[0.72rem] font-medium text-subtle-foreground">
            {t("noTimetable", props.lang)}
          </span>
        }
      >
        <For each={groups()}>
          {(group) => (
            <div class="flex flex-col gap-1">
              <span class="text-[0.7rem] font-bold text-foreground">
                {daysLabel(group.flags, props.lang)}
              </span>
              <For each={group.bands}>
                {(band) => (
                  <div class="flex items-baseline justify-between gap-3">
                    <span class="tnum text-[0.72rem] font-semibold text-muted-foreground">
                      {band.from} - {band.to}
                    </span>
                    <span class="tnum shrink-0 text-[0.66rem] font-medium text-subtle-foreground">
                      <Show
                        when={band.headwayMin !== null}
                        fallback={t("singleDeparture", props.lang)}
                      >
                        {Math.round(band.headwayMin as number)} {t("minute", props.lang)}{" "}
                        {t("everyMinutes", props.lang)}
                      </Show>
                    </span>
                  </div>
                )}
              </For>
            </div>
          )}
        </For>
      </Show>
    </div>
  );
}

/**
 * The two departures after the one on the row, stacked into the space the
 * actions leave empty.
 *
 * They stay a column rather than a row of chips: they are the same series as
 * the countdown above them, and a series reads down. No label - two more times
 * under a time need no introduction.
 */
function LaterArrivals(props: { etas: Eta[]; lang: Lang }) {
  const rest = createMemo(() => {
    const at = now();
    return props.etas
      .map((eta) => countdown(eta, at))
      .filter((state) => state.kind !== "gone")
      .slice(1, 3);
  });

  return (
    <Show when={rest().length > 0}>
      <div class="flex flex-col">
        <For each={rest()}>
          {(state) => (
            <span
              // The digits are hidden from assistive tech (ten per column), so
              // the spoken value has to live on the line itself.
              aria-label={`${state.kind === "arriving" ? 0 : state.minutes} ${t("minute", props.lang)}`}
              class="tnum text-[1.05rem] font-bold leading-[1.3] tracking-[-0.02em] text-muted-foreground"
            >
              <Show when={state.scheduled}>
                <span class="opacity-60">~</span>
              </Show>
              <RollingNumber value={state.kind === "arriving" ? 0 : state.minutes} />
              <span class="pl-[3px] text-[0.66rem] font-semibold text-subtle-foreground">
                {t("minute", props.lang)}
              </span>
            </span>
          )}
        </For>
      </div>
    </Show>
  );
}

function StopRow(props: {
  route: KeyedRoute;
  seq: number;
  stopId: string;
  stop: StopEntry;
  lang: Lang;
  open: boolean;
  passed: boolean;
  isNearest: boolean;
  /** Total stops on the route, so the rail stops at the terminus. */
  total: number;
  onToggle: () => void;
}) {
  /*
   * Arrivals are the reason the list exists, so every row asks for them - but
   * only while it is on screen. Most operators answer per stop, and polling
   * forty rows every twenty seconds to fill a screen that shows eight is not a
   * trade worth making.
   */
  const [watchRow, visible] = useInView();
  const etas = useEta(() =>
    visible() || props.open
      ? { route: props.route, seq: props.seq, stopIdByCo: stopIdsFor(props.route, props.seq) }
      : null,
  );

  const pinned = () => saved.has(props.route.key, props.stopId);
  /*
   * A section fare holds for a run of stops, so printing it on every row is
   * forty repetitions of the same two numbers. It is worth saying only where
   * it changes - which is exactly where a rider needs to know.
   */
  const fare = () => fareAt(props.route.fares, props.seq);
  const concession = () => concessionFare(props.route.fares?.[props.seq - 1]);
  const fareChanged = () => fare() !== null && fare() !== fareAt(props.route.fares, props.seq - 1);

  return (
    <div
      ref={watchRow}
      data-stop-seq={props.seq}
      class={["flex flex-col", { "opacity-60": props.passed && !props.open }]}
    >
      <button
        type="button"
        onClick={props.onToggle}
        aria-expanded={props.open ? "true" : "false"}
        class="mb-tap flex w-full items-start gap-3 px-3.5 py-2.5 text-left"
      >
        <span
          class={[
            "tnum mt-0.5 w-5 shrink-0 text-right text-[0.66rem] font-bold",
            { "text-primary": props.isNearest, "text-faint-foreground": !props.isNearest },
          ]}
        >
          {props.seq}
        </span>

        {/*
         * The negative margin cancels the row's own padding, so one row's rail
         * meets the next one's instead of stopping short of it.
         *
         * The segment above the dot is a fixed height rather than a spring, so
         * the dot lands on the stop name whatever else the row is carrying.
         * Centring it instead made the marker slide down the moment a row grew
         * a fare line or opened, and a column of numbers that do not line up
         * with the names beside them is unreadable as a sequence.
         */}
        <div class="-my-2.5 flex w-3 shrink-0 flex-col items-center self-stretch">
          <div
            class={[
              "w-0.5 shrink-0",
              props.isNearest ? "h-[14px]" : "h-4",
              {
                "bg-transparent": props.seq === 1,
                "bg-primary": props.isNearest && props.seq !== 1,
                "bg-border": !props.isNearest && props.seq !== 1,
              },
            ]}
          />
          {/* Marking where you are with a halo rather than a filled row: the
              band grew with the row and swamped an expanded stop, while this
              stays the same size and reads like a map pin. */}
          <div
            class={[
              "shrink-0 rounded-full",
              {
                "size-3 bg-primary": props.isNearest,
                "size-2 border-2 border-faint-foreground bg-background": !props.isNearest,
              },
            ]}
            style={
              props.isNearest
                ? {
                    "box-shadow":
                      "0 0 0 3px var(--card), 0 0 0 7px color-mix(in srgb, var(--primary) 22%, transparent)",
                  }
                : undefined
            }
          />
          <div
            class={[
              "w-0.5 grow",
              { "bg-transparent": props.seq >= props.total, "bg-border": props.seq < props.total },
            ]}
          />
        </div>

        <div class="flex min-w-0 grow flex-col gap-0.5">
          <div class="flex min-w-0 items-center gap-1.5">
            <span
              class={[
                "truncate text-[0.85rem] tracking-[-0.01em]",
                {
                  "font-bold text-foreground": !props.passed,
                  "font-semibold text-subtle-foreground": props.passed,
                },
              ]}
            >
              {stripStopCode(pick(props.stop.name, props.lang))}
            </span>

            {/* Beside the name, where the eye already is. A pin says it in the
                space a phrase would have taken from the stop's own name. */}
            <Show when={props.isNearest}>
              <span class="shrink-0 text-primary" title={t("youAreHere", props.lang)}>
                <PinIcon size={13} />
                <span class="sr-only">{t("youAreHere", props.lang)}</span>
              </span>
            </Show>
          </div>

          <span class="truncate text-[0.6rem] font-medium text-faint-foreground">
            {stripStopCode(pick(props.stop.name, props.lang === "zh" ? "en" : "zh"))}
          </span>

          <Show when={fareChanged() || props.open}>
            <span class="tnum truncate text-[0.6rem] font-semibold text-subtle-foreground">
              {[
                `${t("fareFull", props.lang)} ${fare()}`,
                concession() ? `${t("fareOctopus", props.lang)} ${concession()}` : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </Show>
        </div>

        {/*
         * The next bus, on every row. The two after it are one tap away.
         *
         * The wait has to look like a wait: an empty countdown reads as
         * "no service", which at a stop with plenty of buses is a lie.
         */}
        <EtaCountdown etas={etas()} lang={props.lang} size="md" limit={1} />
      </button>

      <Reveal open={props.open}>
        {/* The later departures fill the space the actions leave, so the panel
            is one band of content rather than two buttons and a gap. */}
        <div class="relative flex items-center justify-between gap-3 px-3.5 pb-3 pl-[4.375rem]">
          {/* The rail has to carry on past the expanded actions, or opening a
              stop cuts the route in half. */}
          <Show when={props.seq < props.total}>
            <span aria-hidden="true" class="absolute inset-y-0 left-[3.1875rem] w-0.5 bg-border" />
          </Show>

          <LaterArrivals etas={etas() ?? []} lang={props.lang} />

          <div class="flex shrink-0 items-center gap-2">
            <button
              type="button"
              aria-label="pin"
              aria-pressed={pinned() ? "true" : "false"}
              onClick={() =>
                saved.toggle({
                  routeKey: props.route.key,
                  co: props.route.co[0] ?? "kmb",
                  stopId: props.stopId,
                  seq: props.seq,
                })
              }
              class={[
                "flex h-8 items-center gap-1.5 rounded-full px-3 text-[0.68rem] font-bold",
                {
                  "bg-primary text-primary-foreground": pinned(),
                  "bg-secondary text-muted-foreground": !pinned(),
                },
              ]}
            >
              <BookmarkIcon size={13} />
              {t("pinned", props.lang)}
            </button>

            <a
              href={`/stop/${encodeURIComponent(props.stopId)}`}
              class="flex h-8 items-center gap-1.5 rounded-full bg-secondary px-3 text-[0.68rem] font-bold text-muted-foreground"
            >
              {t("openStop", props.lang)}
              <ChevronRightIcon size={12} />
            </a>
          </div>
        </div>
      </Reveal>
    </div>
  );
}

export default function RouteDetail() {
  const db = useDb();
  const params = useParams<{ key: string }>();
  const lang = settings.lang;
  const { position } = useGeolocation();

  const [openSeq, setOpenSeq] = createSignal<number | null>(null);
  const [showInfo, setShowInfo] = createSignal(false);

  const route = createMemo(() => routeAt(db(), decodeURIComponent(params.key)));
  const stops = createMemo(() => {
    const r = route();
    return r ? routeStops(db(), r) : [];
  });
  const reverse = createMemo(() => {
    const r = route();
    return r ? reverseRoute(db(), r) : undefined;
  });

  /** Index of the closest stop, so the page opens where you are standing. */
  const nearestIndex = createMemo(() => {
    const here = position();
    const list = stops();
    if (!here || list.length === 0) return -1;

    let best = -1;
    let bestDistance = Number.POSITIVE_INFINITY;
    list.forEach((entry, index) => {
      const d = distanceM(here, entry.stop.location);
      if (d < bestDistance) {
        bestDistance = d;
        best = index;
      }
    });
    // Beyond a kilometre you are not "at" this route at all.
    return bestDistance <= 1000 ? best : -1;
  });

  const nearestDistance = createMemo(() => {
    const here = position();
    const index = nearestIndex();
    const entry = index >= 0 ? stops()[index] : undefined;
    return here && entry ? distanceM(here, entry.stop.location) : null;
  });

  /*
   * Open the stop you are standing at and scroll to it, so the page answers the
   * question you came with before you touch anything. Only while the page is
   * still where it opened: once a rider has scrolled, moving the list under
   * them is worse than leaving them to find it.
   */
  let jumped = false;
  createEffect(
    () => nearestIndex(),
    (index) => {
      if (index < 0) return;
      setOpenSeq(index + 1);
      if (jumped || window.scrollY > 24) return;
      jumped = true;
      requestAnimationFrame(() => {
        document
          .querySelector(`[data-stop-seq="${index + 1}"]`)
          ?.scrollIntoView({ block: "center", behavior: "smooth" });
      });
    },
  );

  createEffect(
    () => route()?.key,
    (key) => {
      if (key) frequent.record(key);
    },
  );

  /**
   * Opening a stop, wherever the tap came from.
   *
   * A pick on the map is useless if the matching row is a screen away, and a
   * stop behind the collapsed "earlier stops" section would not be rendered at
   * all, so that section opens too.
   */
  const openStop = (seq: number) => {
    setOpenSeq(seq);
    requestAnimationFrame(() => {
      document
        .querySelector(`[data-stop-seq="${seq}"]`)
        ?.scrollIntoView({ block: "center", behavior: "smooth" });
    });
  };


  return (
    <Show when={route()} fallback={<EmptyState title={t("noResults", lang())} />}>
      {(r) => (
        <SplitPage
          aside={
            <>
              {/* A real top bar rather than a button floated over the map: the map
              may collapse if it cannot render, and nothing should be left
              hanging over the content when it does. */}
              <Trail />

              <header class="-mt-3 -mb-2 flex items-center gap-3">
                {/* The number is the route's identity, so it is also the way in
                    to what the route itself does: when it runs, and how often. */}
                <button
                  type="button"
                  onClick={() => setShowInfo((v) => !v)}
                  aria-expanded={showInfo() ? "true" : "false"}
                  aria-label={t("routeInfo", lang())}
                  class="mb-press flex min-w-0 grow items-center gap-3 text-left"
                >
                  <RoutePlate route={r().route} co={r().co} size="md" />

                  <div class="flex min-w-0 grow flex-col gap-0.5">
                    <span class="truncate text-[0.92rem] font-bold tracking-[-0.02em] text-foreground">
                      {t("towards", lang())} {pick(r().dest, lang())}
                    </span>
                    <span class="truncate text-[0.62rem] font-medium text-subtle-foreground">
                      {operatorLabel(r().co, lang())} · {pick(r().orig, lang())}
                    </span>
                  </div>

                  {/* It opens a dialog rather than expanding in place, so the
                      chevron points onward and does not rotate. */}
                  <span class="shrink-0 text-faint-foreground">
                    <ChevronRightIcon size={16} />
                  </span>
                </button>
              </header>

              <Modal
                open={showInfo()}
                onClose={() => setShowInfo(false)}
                title={`${r().route} · ${t("timetable", lang())}`}
                lang={lang()}
              >
                <Timetable db={db()} route={r()} lang={lang()} />
              </Modal>

              <Card class="flex flex-col">
                <RouteMap
                  route={r()}
                  stops={stops()}
                  stopNames={stops().map((entry) => stripStopCode(pick(entry.stop.name, lang())))}
                  nearestIndex={nearestIndex() >= 0 ? nearestIndex() : undefined}
                  selectedIndex={openSeq() !== null ? (openSeq() as number) - 1 : undefined}
                  onSelectStop={(index) => openStop(index + 1)}
                  me={position()}
                  heightClass="h-[17rem] lg:h-[30rem]"
                  lang={lang()}
                  unavailableLabel={t("mapUnavailable", lang())}
                />

                <div class="flex h-14 items-center gap-2.5 border-t border-border px-3.5">
                  <Show when={reverse()} fallback={<div class="grow" />}>
                    {(other) => (
                      <a
                        href={routeHref(other().key)}
                        class="flex h-9 items-center gap-2 rounded-full bg-secondary pl-2.5 pr-3.5"
                      >
                        <span class="text-primary">
                          <SwapIcon size={15} />
                        </span>
                        <span class="text-[0.72rem] font-bold text-foreground">
                          {t("reverse", lang())}
                        </span>
                      </a>
                    )}
                  </Show>

                  <div class="flex grow flex-col items-end gap-0.5">
                    <span class="tnum text-[0.72rem] font-bold text-foreground">
                      {[formatFare(r().fares?.[0]), `${stops().length} ${t("stops", lang())}`]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                    <Show when={r().jt}>
                      <span class="tnum text-[0.6rem] font-medium text-subtle-foreground">
                        {t("aboutMinutes", lang())} {r().jt} {t("minute", lang())}
                      </span>
                    </Show>
                  </div>
                </div>

                {/*
                 * "You are here" answered nothing on its own - here is a whole
                 * route. It names the stop it means, and takes you to it.
                 */}
                <Show when={nearestDistance() !== null && stops()[nearestIndex()]}>
                  {(entry) => (
                    <button
                      type="button"
                      onClick={() => openStop(nearestIndex() + 1)}
                      class="mb-tap flex w-full items-center gap-2 border-t border-border px-3.5 py-3 text-left"
                    >
                      <Chip tone="accent">
                        <WalkIcon size={12} />
                        <span class="tnum truncate">
                          {t("nearestStop", lang())} · {stripStopCode(pick(entry().stop.name, lang()))}
                          {" · "}
                          {t("walk", lang())} {walkMinutes(nearestDistance() as number)}{" "}
                          {t("minute", lang())}
                        </span>
                      </Chip>
                      <span class="ml-auto shrink-0 text-faint-foreground">
                        <ChevronRightIcon size={14} />
                      </span>
                    </button>
                  )}
                </Show>
              </Card>
            </>
          }
        >
          {/*
           * Every stop, always. Folding away the ones behind you hid part of
           * the answer behind a control, and the page opens scrolled to where
           * you are standing anyway.
           */}
          <Card>
            <For each={stops()}>
              {(entry, index) => {
                const seq = () => index() + 1;
                return (
                  <StopRow
                    route={r()}
                    seq={seq()}
                    stopId={entry.id}
                    stop={entry.stop}
                    lang={lang()}
                    passed={nearestIndex() >= 0 && index() < nearestIndex()}
                    isNearest={index() === nearestIndex()}
                    total={stops().length}
                    open={openSeq() === seq()}
                    onToggle={() => setOpenSeq((v) => (v === seq() ? null : seq()))}
                  />
                );
              }}
            </For>
          </Card>

          <p class="-mt-2 text-center text-[0.6rem] font-medium text-faint-foreground">
            {t("tapForEta", lang())}
          </p>
        </SplitPage>
      )}
    </Show>
  );
}
