import { useSearchParams } from "@solidjs/router";
import { For, Show, createEffect, createMemo, createSignal } from "solid-js";
import {
  Card,
  Chip,
  EmptyState,
  Hairline,
  Reveal,
  ScreenTitle,
  SectionLabel,
  StopCode,
} from "~/components/Chrome";
import { Section, SplitPage } from "~/components/Layout";
import { ModeSwitch } from "~/components/ModeSwitch";
import {
  BookmarkIcon,
  ChevronRightIcon,
  CloseIcon,
  PinIcon,
  ShareIcon,
  SwapIcon,
  WalkIcon,
} from "~/components/Icons";
import { RoutePlate } from "~/components/RoutePlate";
import { routeHref } from "~/components/RouteRow";
import { useDb } from "~/data/context";
import { searchStops } from "~/data/db";
import { planJourneys, type Journey } from "~/data/planner";
import { serviceSpan } from "~/data/schedule";
import { stopIdsFor, useEta } from "~/data/useEta";
import type { StopEntry } from "~/data/types";
import { formatDistance, walkMinutes, type LatLng } from "~/lib/geo";
import { pick, stripStopCode, t, type Lang } from "~/lib/i18n";
import { now } from "~/stores/clock";
import { useGeolocation } from "~/stores/geolocation";
import { toast } from "~/stores/toast";
import { trips, type TripEnd } from "~/stores/trips";
import { settings } from "~/stores/settings";

type Endpoint = { kind: "me" } | { kind: "stop"; id: string; stop: StopEntry };

function endpointLabel(end: Endpoint | null, lang: Lang): string | null {
  if (!end) return null;
  return end.kind === "me" ? t("myLocation", lang) : stripStopCode(pick(end.stop.name, lang));
}

function JourneyCard(props: { journey: Journey; lang: Lang }) {
  const db = useDb();
  const j = () => props.journey;

  /*
   * The wait for the first bus, which is the part of a journey time a planner
   * usually leaves out and a rider standing at the kerb feels most.
   */
  const first = () => j().legs[0];
  const etas = useEta(() => {
    const leg = first();
    return leg
      ? { route: leg.route, seq: leg.boardSeq, stopIdByCo: stopIdsFor(leg.route, leg.boardSeq) }
      : null;
  }, 1);

  const wait = createMemo(() => {
    const at = etas()?.[0]?.at.getTime();
    if (at === undefined) return null;
    return Math.max(0, Math.floor((at - now()) / 60_000));
  });

  /*
   * The tightest end of the day across the legs: a journey is only possible
   * for as long as its most restricted route still runs.
   */
  const lastRun = createMemo(() => {
    const spans = j()
      .legs.map((leg) => serviceSpan(db(), leg.route))
      .filter((span): span is NonNullable<typeof span> => span !== null);
    if (spans.length === 0) return null;
    return spans.reduce((tightest, span) =>
      span.untilLast < tightest.untilLast ? span : tightest,
    );
  });

  const walkMinutesTotal = () =>
    walkMinutes(j().walkStart) + walkMinutes(j().walkEnd) + walkMinutes(j().walkTransfer);

  return (
    <Card>
      <div class="flex items-center justify-between px-3.5 pb-2 pt-3">
        <span
          class={[
            "rounded-full px-2 py-0.5 text-[0.75rem] font-bold",
            {
              "bg-primary-muted text-primary": j().legs.length === 1,
              "bg-secondary text-muted-foreground": j().legs.length > 1,
            },
          ]}
        >
          {j().legs.length === 1 ? t("direct", props.lang) : t("oneChange", props.lang)}
        </span>
        <span class="tnum text-[0.88rem] font-bold text-foreground">
          {t("wholeJourney", props.lang)} {j().totalMinutes} {t("minute", props.lang)}
        </span>
      </div>

      {/* What the total is made of: the wait, the walking and the change.
          A single number hides the part a rider can feel. */}
      <div class="flex flex-wrap items-center gap-1.5 px-3.5 pb-2.5">
        <Show when={wait() !== null}>
          <Chip tone="accent" class="shrink-0">
            <span class="tnum">
              {t("waitLabel", props.lang)} {wait()} {t("minute", props.lang)}
            </span>
          </Chip>
        </Show>
        <Chip class="shrink-0">
          <WalkIcon size={11} />
          <span class="tnum">
            {walkMinutesTotal()} {t("minute", props.lang)}
          </span>
        </Chip>
        <Show when={lastRun()}>
          {(span) => (
            <Chip tone={span().untilLast <= 60 ? "warn" : "plain"} class="shrink-0">
              <span class="tnum">
                {t("lastBus", props.lang)} {span().last}
              </span>
            </Chip>
          )}
        </Show>
      </div>

      <Hairline />

      <div class="flex items-center gap-1.5 px-3.5 py-2 text-subtle-foreground">
        <WalkIcon size={12} />
        <span class="tnum text-[0.75rem] font-semibold">
          {t("walkLabel", props.lang)} {formatDistance(j().walkStart)} ·{" "}
          {walkMinutes(j().walkStart)} {t("minute", props.lang)}
        </span>
      </div>

      <For each={j().legs}>
        {(leg, index) => (
          <>
            <Show when={index() > 0}>
              <div class="flex items-center gap-1.5 bg-secondary/60 px-3.5 py-2 text-subtle-foreground">
                <SwapIcon size={12} />
                <span class="tnum text-[0.75rem] font-semibold">
                  {[
                    t("changeHere", props.lang),
                    j().walkTransfer > 0
                      ? `${t("walkLabel", props.lang)} ${formatDistance(j().walkTransfer)}`
                      : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </div>
            </Show>

            <a href={routeHref(leg.route.key)} class="mb-tap flex items-center gap-3 px-3.5 py-2.5">
              <RoutePlate route={leg.route.route} co={leg.route.co} size="sm" />
              <div class="flex min-w-0 grow flex-col gap-0.5">
                <span class="truncate text-[0.88rem] font-bold tracking-[-0.01em] text-foreground">
                  {stripStopCode(pick(leg.boardStop.name, props.lang))} →{" "}
                  {stripStopCode(pick(leg.alightStop.name, props.lang))}
                </span>
                <span class="tnum truncate text-[0.75rem] font-medium text-subtle-foreground">
                  {[
                    `${leg.hops} ${t("stops", props.lang)}`,
                    `${leg.minutes} ${t("minute", props.lang)}`,
                    leg.fare,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </div>
              <span class="text-faint-foreground">
                <ChevronRightIcon size={14} />
              </span>
            </a>
          </>
        )}
      </For>

      <div class="flex items-center gap-1.5 px-3.5 pb-3 pt-1 text-subtle-foreground">
        <WalkIcon size={12} />
        <span class="tnum text-[0.75rem] font-semibold">
          {t("walkLabel", props.lang)} {formatDistance(j().walkEnd)} · {walkMinutes(j().walkEnd)}{" "}
          {t("minute", props.lang)}
        </span>
      </div>
    </Card>
  );
}

export default function Plan() {
  const db = useDb();
  const lang = settings.lang;
  const { position } = useGeolocation();

  const [from, setFrom] = createSignal<Endpoint | null>({ kind: "me" });
  const [to, setTo] = createSignal<Endpoint | null>(null);
  const [picking, setPicking] = createSignal<"from" | "to" | null>("to");
  const [query, setQuery] = createSignal("");
  const [params] = useSearchParams<{ from?: string; to?: string }>();

  const matches = createMemo(() => (picking() ? searchStops(db(), query(), 10) : []));

  const coordsOf = (end: Endpoint | null): LatLng | null => {
    if (!end) return null;
    return end.kind === "me" ? position() : end.stop.location;
  };

  const journeys = createMemo<Journey[]>(() => {
    const a = coordsOf(from());
    const b = coordsOf(to());
    if (!a || !b) return [];
    return planJourneys(db(), a, b, { walkRadiusM: settings.radiusM() });
  });

  const choose = (id: string, stop: StopEntry) => {
    const target = picking();
    if (target === "from") setFrom({ kind: "stop", id, stop });
    else setTo({ kind: "stop", id, stop });
    setPicking(null);
    setQuery("");
  };

  const swap = () => {
    const a = from();
    setFrom(to());
    setTo(a);
  };

  /** The stored shape of an end: a place, not the copy of it in this session. */
  const asEnd = (end: Endpoint | null): TripEnd | null =>
    end ? (end.kind === "me" ? { kind: "me" } : { kind: "stop", id: end.id }) : null;

  const pair = createMemo(() => {
    const a = asEnd(from());
    const b = asEnd(to());
    return a && b ? { from: a, to: b } : null;
  });

  const endOf = (value: string | undefined): Endpoint | null => {
    if (!value) return null;
    if (value === "me") return { kind: "me" };
    const stop = db().stopList[value];
    return stop ? { kind: "stop", id: value, stop } : null;
  };

  /*
   * A link names both ends, so a trip someone sends opens as that trip rather
   * than as an empty planner with a story attached.
   */
  createEffect(
    () => `${params.from ?? ""}|${params.to ?? ""}`,
    () => {
      const start = endOf(params.from);
      const end = endOf(params.to);
      if (start) setFrom(start);
      if (end) {
        setTo(end);
        setPicking(null);
      }
    },
  );

  const tripLabel = () =>
    [endpointLabel(from(), lang()), endpointLabel(to(), lang())].filter(Boolean).join(" → ");

  const shareTrip = () => {
    const both = pair();
    if (!both) return;
    const name = (end: TripEnd) => (end.kind === "me" ? "me" : end.id);
    const url = `${window.location.origin}/plan?from=${encodeURIComponent(
      name(both.from),
    )}&to=${encodeURIComponent(name(both.to))}`;

    if (navigator.share) {
      void navigator.share({ title: tripLabel(), url }).catch(() => undefined);
      return;
    }
    void navigator.clipboard
      ?.writeText(url)
      .then(() => toast.show(t("linkCopied", lang()), tripLabel()))
      .catch(() => undefined);
  };

  /** Reopening a saved trip: the ends are stored, the buses are worked out now. */
  const openTrip = (trip: { from: TripEnd; to: TripEnd }) => {
    const start = endOf(trip.from.kind === "me" ? "me" : trip.from.id);
    const end = endOf(trip.to.kind === "me" ? "me" : trip.to.id);
    if (start) setFrom(start);
    if (end) setTo(end);
    setPicking(null);
    setQuery("");
  };

  /**
   * One endpoint: the place, or the field you type it into.
   *
   * Tapping a row turns that row into the input rather than opening a second
   * search box beneath it - two fields both labelled "destination" is a
   * question about which one the app is listening to.
   */
  const EndpointRow = (props: { which: "from" | "to"; end: Endpoint | null }) => {
    const active = () => picking() === props.which;
    let field!: HTMLInputElement;

    createEffect(
      () => active(),
      (on) => {
        if (on) field.focus();
      },
    );

    return (
      <div
        class={[
          "flex h-12 w-full items-center gap-2 rounded-2xl border-[1.5px] bg-card px-3.5 transition-colors duration-state",
          { "border-primary-border": active(), "border-border": !active() },
        ]}
      >
        <input
          ref={field}
          value={active() ? query() : (endpointLabel(props.end, lang()) ?? "")}
          onInput={(e) => setQuery(e.currentTarget.value)}
          onFocus={() => {
            setPicking(props.which);
            setQuery("");
          }}
          placeholder={t(props.which === "from" ? "chooseOrigin" : "chooseDest", lang())}
          aria-label={t(props.which === "from" ? "fromLabel" : "toLabel", lang())}
          autocomplete="off"
          class={[
            "grow bg-transparent text-[0.94rem] outline-none placeholder:font-medium placeholder:text-subtle-foreground",
            {
              "font-bold text-foreground": props.end !== null && !active(),
              "font-semibold text-foreground": active(),
              "font-medium text-subtle-foreground": props.end === null && !active(),
            },
          ]}
        />

        <Show when={active()}>
          <button
            type="button"
            aria-label="close"
            onClick={() => {
              setPicking(null);
              setQuery("");
            }}
            class="mb-press flex size-6 shrink-0 items-center justify-center rounded-full bg-secondary text-muted-foreground"
          >
            <CloseIcon size={12} />
          </button>
        </Show>

        <Show when={!active() && props.which === "from" && props.end?.kind === "me"}>
          <span class="shrink-0 text-primary">
            <PinIcon size={15} />
          </span>
        </Show>
      </div>
    );
  };

  return (
    <SplitPage
      aside={
        <>
          <ScreenTitle title={t("searchRoutes", lang())} pinned={false} />

          <div class="-mt-2.5">
            <ModeSwitch lang={lang()} />
          </div>

          <div class="-mt-2 flex items-stretch gap-2.5">
            {/*
             * The dot, the dotted run and the pin, in the gutter beside the
             * fields: the journey is drawn once here so neither field has to
             * carry a "起點" label to say which end it is.
             */}
            <div class="flex w-3 shrink-0 flex-col items-center py-[1.15rem]" aria-hidden="true">
              <span class="size-2.5 shrink-0 rounded-full border-2 border-subtle-foreground" />
              <span class="my-1 w-0 grow border-l-2 border-dotted border-faint-foreground" />
              <span class="shrink-0 text-primary">
                <PinIcon size={14} />
              </span>
            </div>

            <div class="flex grow flex-col gap-2">
              <EndpointRow which="from" end={from()} />
              <EndpointRow which="to" end={to()} />
            </div>

            {/* Centred between the two ends, because that is what it acts on. */}
            <button
              type="button"
              aria-label={t("swapEnds", lang())}
              onClick={swap}
              class="mb-press flex size-10 shrink-0 self-center items-center justify-center rounded-full bg-secondary text-muted-foreground"
            >
              <SwapIcon size={16} />
            </button>
          </div>

          {/* Keeping a trip, and passing it on: both ends in one link, so the
              answer is worked out fresh wherever it is opened. */}
          <Show when={pair()}>
            {(both) => (
              <div class="-mt-1 flex items-center gap-2">
                <button
                  type="button"
                  aria-pressed={trips.has(both().from, both().to) ? "true" : "false"}
                  onClick={() => trips.toggle(both().from, both().to, tripLabel())}
                  class={[
                    "mb-press flex h-8 items-center gap-1.5 rounded-full px-3 text-[0.81rem] font-bold transition-colors duration-state",
                    {
                      "bg-primary text-primary-foreground": trips.has(both().from, both().to),
                      "bg-secondary text-muted-foreground": !trips.has(both().from, both().to),
                    },
                  ]}
                >
                  <BookmarkIcon size={13} />
                  {t("saveTrip", lang())}
                </button>

                <button
                  type="button"
                  aria-label={t("share", lang())}
                  onClick={shareTrip}
                  class="mb-press flex size-8 items-center justify-center rounded-full bg-secondary text-muted-foreground"
                >
                  <ShareIcon size={13} />
                </button>
              </div>
            )}
          </Show>

          {/* The trips this rider actually makes, one tap from being planned
              again - the same two ends, today's buses. */}
          <Show when={trips.items().length > 0 && picking() === null}>
            <Section tight>
              <SectionLabel>{t("savedTrips", lang())}</SectionLabel>
              <Card>
                <For each={trips.items()}>
                  {(trip, index) => (
                    <>
                      <Show when={index() > 0}>
                        <Hairline />
                      </Show>
                      <div class="flex items-center gap-2 px-3.5 py-2.5">
                        <button
                          type="button"
                          onClick={() => openTrip(trip)}
                          class="mb-tap min-w-0 grow truncate text-left text-[0.88rem] font-bold text-foreground"
                        >
                          {trip.label}
                        </button>
                        <button
                          type="button"
                          aria-label={t("close", lang())}
                          onClick={() => trips.remove(trip.id)}
                          class="mb-press flex size-7 shrink-0 items-center justify-center rounded-full bg-secondary text-muted-foreground"
                        >
                          <CloseIcon size={12} />
                        </button>
                      </div>
                    </>
                  )}
                </For>
              </Card>
            </Section>
          </Show>

          <Reveal open={picking() !== null}>
            {/* Aligned with the fields, clear of the gutter and the swap. */}
            <div class="pl-[1.375rem] pr-12">
              <Show when={picking() === "from"}>
                <button
                  type="button"
                  onClick={() => {
                    setFrom({ kind: "me" });
                    setPicking(null);
                  }}
                  class="mb-press flex w-full items-center gap-2.5 rounded-2xl border border-border bg-card px-3.5 py-3 text-left"
                >
                  <span class="text-primary">
                    <PinIcon size={15} />
                  </span>
                  <span class="text-[0.88rem] font-bold text-foreground">
                    {t("myLocation", lang())}
                  </span>
                </button>
              </Show>

              <Show when={matches().length > 0}>
                <Card class="mt-2.5">
                  <For each={matches()}>
                    {(match, index) => (
                      <>
                        <Show when={index() > 0}>
                          <Hairline />
                        </Show>
                        <button
                          type="button"
                          onClick={() => choose(match.stopId, match.stop)}
                          class="mb-tap flex w-full items-center gap-3 px-3.5 py-2.5 text-left"
                        >
                          {/* The name once, in the language being read, and the
                              pole code beside it - which is both what tells two
                              stops of one name apart and what a rider can search
                              for directly. */}
                          <div class="flex min-w-0 grow items-center gap-1.5">
                            <span class="truncate text-[0.88rem] font-bold text-foreground">
                              {stripStopCode(pick(match.stop.name, lang()))}
                            </span>
                            <StopCode name={match.stop.name} lang={lang()} />
                          </div>
                          <span class="tnum shrink-0 text-[0.75rem] font-bold text-subtle-foreground">
                            {match.routeCount} {t("routesCount", lang())}
                          </span>
                        </button>
                      </>
                    )}
                  </For>
                </Card>
              </Show>
            </div>
          </Reveal>
        </>
      }
    >
      <Section class={picking() !== null ? "hidden lg:flex" : ""}>
        <Show
          when={from() && to()}
          fallback={<EmptyState title={t("plan", lang())} hint={t("planHint", lang())} />}
        >
          <Show
            when={journeys().length > 0}
            fallback={
              <EmptyState title={t("noJourneys", lang())} hint={t("noJourneysHint", lang())} />
            }
          >
            <SectionLabel
              trailing={
                <span class="tnum text-[0.75rem] font-semibold text-faint-foreground">
                  {journeys().length}
                </span>
              }
            >
              {t("routes", lang())}
            </SectionLabel>

            <div class="flex flex-col gap-2.5">
              <For each={journeys()}>
                {(journey) => <JourneyCard journey={journey} lang={lang()} />}
              </For>
            </div>
          </Show>
        </Show>
      </Section>
    </SplitPage>
  );
}
