import { useLinkProps, useNavigate, useSearch } from "@tanstack/solid-router";
import { For, Show, createEffect, createMemo, createSignal, lazy } from "solid-js";
import {
  Card,
  Chip,
  EmptyState,
  Hairline,
  Reveal,
  SectionLabel,
  StopCode,
} from "~/components/Chrome";
import { EXPLORE_SHEET_LOW, ExploreFrame } from "~/components/ExploreFrame";
import type { ExplorePin } from "~/components/ExploreMap";
import { Section } from "~/components/Layout";
import { ModeSwitch } from "~/components/ModeSwitch";
import {
  BookmarkIcon,
  CheckIcon,
  ChevronRightIcon,
  CloseIcon,
  PinIcon,
  ShareIcon,
  SwapIcon,
  WalkIcon,
} from "~/components/Icons";
import { RoutePlate } from "~/components/RoutePlate";
import { routeLink } from "~/lib/links";
import { createWide } from "~/lib/wide";
import { useDb } from "~/data/context";
import { nearbyStops, searchStops } from "~/data/db";
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

// The stage carries the map library, so it is its own chunk: the fields and
// the journeys paint first and the map arrives when the screen has settled.
const ExploreMap = lazy(() => import("~/components/ExploreMap"));

type Endpoint = { kind: "me" } | { kind: "stop"; id: string; stop: StopEntry };

function endpointLabel(end: Endpoint | null, lang: Lang): string | null {
  if (!end) return null;
  return end.kind === "me" ? t("myLocation", lang) : stripStopCode(pick(end.stop.name, lang));
}

function JourneyCard(props: {
  journey: Journey;
  lang: Lang;
  /** Whether this is the journey the map has lit. */
  selected?: boolean;
  /** A tap anywhere on the card makes it that journey. */
  onSelect?: () => void;
}) {
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
    /*
     * The card is also the way to light its journey on the map: a tap
     * anywhere on it selects, exactly as a tap on the drawn line does. The
     * links inside still navigate - selecting on the way through is free.
     * A wrapper rather than a role: a card full of its own links cannot
     * honestly claim to be one button, and everything the map would add is
     * already printed on the card itself.
     */
    <div class="cursor-pointer" onClick={() => props.onSelect?.()}>
      <Card>
        <div class="flex items-center justify-between px-3.5 pb-2 pt-3">
          {/*
           * The badge is where the choice shows: lit on the journey the map
           * has lit, quiet on the rest. It used to tint the whole card,
           * which in dark mode was a slab of muddled indigo that swallowed
           * its own chips - and it used to colour by directness, which the
           * words already say. One element, one meaning.
           */}
          <span
            class={[
              "rounded-full px-2 py-0.5 text-[0.75rem] font-bold transition-colors duration-state",
              {
                "bg-primary text-primary-foreground": props.selected === true,
                "bg-secondary text-muted-foreground": props.selected !== true,
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

              <a
                {...useLinkProps(routeLink(leg.route.key))}
                class="app-tap flex items-center gap-3 px-3.5 py-2.5"
              >
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
    </div>
  );
}

export default function Plan() {
  const db = useDb();
  const lang = settings.lang;
  const { position } = useGeolocation();

  const search = useSearch({ from: "/plan" });

  const endOf = (value: string | undefined): Endpoint | null => {
    if (!value) return null;
    if (value === "me") return { kind: "me" };
    const stop = db().stopList[value];
    return stop ? { kind: "stop", id: value, stop } : null;
  };

  /*
   * Born as what the address says, not caught up to it: the ends and the
   * URL write each other, and a screen that started empty and only learned
   * its URL from an effect kept losing the race to the effects writing the
   * emptiness back - a reload of ?from=me&to=X&j=2 came out as ?from=me.
   */
  const [from, setFrom] = createSignal<Endpoint | null>(endOf(search().from) ?? { kind: "me" });
  const [to, setTo] = createSignal<Endpoint | null>(endOf(search().to));
  const [picking, setPicking] = createSignal<"from" | "to" | null>(to() ? null : "to");
  const [query, setQuery] = createSignal("");

  const matches = createMemo(() => (picking() ? searchStops(db(), query(), 10) : []));

  const coordsOf = (end: Endpoint | null): LatLng | null => {
    if (!end) return null;
    return end.kind === "me" ? position() : end.stop.location;
  };

  const journeys = createMemo<Journey[]>(() => {
    const a = coordsOf(from());
    const b = coordsOf(to());
    if (!a || !b) return [];
    // The nearby range now reaches kilometres; a walk to a stop does not.
    return planJourneys(db(), a, b, { walkRadiusM: Math.min(settings.radiusM(), 800) });
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

  const wide = createWide();

  /*
   * Which journey the map has lit. The first is lit as soon as there are
   * any - a plan should open with an answer drawn, not a question - and a
   * choice that stops existing when the ends change falls back to the first.
   */
  const [chosen, setChosen] = createSignal<string | null>(null);
  const selectedId = createMemo(() => {
    const list = journeys();
    const wanted = chosen();
    if (wanted && list.some((journey) => journey.id === wanted)) return wanted;
    // No pick this session: the address's pick, then the first. Read here
    // rather than copied into state by an effect - the copy kept losing the
    // race against the effect that writes the address back.
    const named = search().j !== undefined ? list[search().j as number]?.id : undefined;
    return named ?? list[0]?.id ?? null;
  });

  const ends = createMemo(() => ({ from: coordsOf(from()), to: coordsOf(to()) }));

  /*
   * The pins follow what the rider is doing: picking an end puts the
   * candidate stops on the map, each a tap away from being chosen there
   * instead of on the list; otherwise the two ends themselves are marked,
   * where they are stops - "my location" is already the dot.
   */
  const pins = createMemo<ExplorePin[]>(() => {
    if (picking()) {
      return matches().map((match) => ({
        id: match.stopId,
        name: stripStopCode(pick(match.stop.name, lang())),
        location: match.stop.location,
        kind: "stop",
      }));
    }
    const marks: ExplorePin[] = [];
    const a = from();
    const b = to();
    if (a?.kind === "stop") {
      marks.push({
        id: a.id,
        name: stripStopCode(pick(a.stop.name, lang())),
        location: a.stop.location,
        kind: "origin",
      });
    }
    if (b?.kind === "stop") {
      marks.push({
        id: b.id,
        name: stripStopCode(pick(b.stop.name, lang())),
        location: b.stop.location,
        kind: "destination",
      });
    }
    /*
     * The chosen journey's own stops: where you board and where you get off,
     * named - the two questions the drawn line cannot answer by itself. An
     * end that is itself the boarding kerb keeps its endpoint mark.
     */
    const lit = journeys().find((journey) => journey.id === selectedId());
    for (const leg of lit?.legs ?? []) {
      if (leg.boardStopId !== (a?.kind === "stop" ? a.id : "")) {
        marks.push({
          id: `board-${leg.route.key}-${leg.boardSeq}`,
          name: stripStopCode(pick(leg.boardStop.name, lang())),
          location: leg.boardStop.location,
          kind: "stop",
        });
      }
      if (leg.alightStopId !== (b?.kind === "stop" ? b.id : "")) {
        marks.push({
          id: `alight-${leg.route.key}-${leg.alightSeq}`,
          name: stripStopCode(pick(leg.alightStop.name, lang())),
          location: leg.alightStop.location,
          kind: "stop",
        });
      }
    }
    return marks;
  });

  /*
   * The sheet follows what the rider is doing. Picking an end needs the
   * match list, so the sheet rises to it; an end chosen turns the map into
   * the answer, so the sheet drops to its low rest and the drawn journey is
   * the first thing seen - the cards are one pull away. Only when something
   * was found: an empty map explaining nothing is worse than the empty
   * state saying why.
   */
  /* The results sheet rests low when it arrives; pulling it tall is the
     rider's own gesture, never the screen's. */
  const [sheetSnap, setSheetSnap] = createSignal(0);

  /*
   * Choose on the map, the way a maps app does it: a pin stands over the
   * visible centre, the map is dragged underneath until the pin points at
   * the place, and the nearest stop to it is confirmed by name - never
   * guessed from a stray tap. It is not a mode anyone enters: for as long as
   * an end is being picked, the pin simply stands there - type into the
   * field or drag the map at it, whichever answers first.
   */
  const aiming = () => picking() !== null;

  /**
   * Whether a field actually has the caret. Picking an end outlives a blur -
   * tapping the map to aim must not abandon the question - but the
   * suggestions are an autocomplete, and an autocomplete lives and dies with
   * its field's focus.
   */
  const [typing, setTyping] = createSignal(false);

  /**
   * The results sheet, put away by hand. It exists only while there are
   * results, may always be shoved off entirely, and a fresh answer brings it
   * back - dismissing yesterday's plan is not an opinion about tomorrow's.
   */
  const [sheetAway, setSheetAway] = createSignal(false);
  const sheetOpen = () => journeys().length > 0 && picking() === null && !sheetAway();

  /**
   * What the picker offers: your own position, and the stops the typed
   * letters match. It behaves like a field's autocomplete, because that is
   * what it is - nothing until there is something to offer, and never a
   * sheet: focusing a field must move nothing but the caret. On a phone it
   * floats under the fields, over the map; a wide window lays it in the
   * panel where the eye already is.
   */
  const Suggestions = () => (
    <div class="flex flex-col gap-2.5">
      <Show when={picking() === "from"}>
        <button
          type="button"
          onClick={() => {
            setFrom({ kind: "me" });
            setPicking(null);
          }}
          class="app-press flex w-full items-center gap-2.5 rounded-2xl bg-card px-3.5 py-3 text-left shadow-card"
        >
          <span class="text-primary">
            <PinIcon size={15} />
          </span>
          <span class="text-[0.88rem] font-bold text-foreground">{t("myLocation", lang())}</span>
        </button>
      </Show>

      <Show when={matches().length > 0}>
        <Card>
          <For each={matches()}>
            {(match, index) => (
              <>
                <Show when={index() > 0}>
                  <Hairline />
                </Show>
                <button
                  type="button"
                  onClick={() => choose(match.stopId, match.stop)}
                  class="app-tap flex w-full items-center gap-3 px-3.5 py-2.5 text-left"
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
  );

  /** Where the pin points, and the stop that would be chosen there. */
  const [mapCentre, setMapCentre] = createSignal<LatLng | null>(null);
  const pinStop = createMemo(() => {
    if (!aiming()) return null;
    const centre = mapCentre();
    if (!centre) return null;
    return nearbyStops(db(), centre, 500)[0] ?? null;
  });

  // A fresh answer offers itself again, at its low rest, even if the last
  // one had been pushed away.
  createEffect(
    () =>
      journeys()
        .map((journey) => journey.id)
        .join("|"),
    (key, was) => {
      if (key && key !== was) {
        setSheetAway(false);
        setSheetSnap(0);
      }
    },
  );

  /** The stored shape of an end: a place, not the copy of it in this session. */
  const asEnd = (end: Endpoint | null): TripEnd | null =>
    end ? (end.kind === "me" ? { kind: "me" } : { kind: "stop", id: end.id }) : null;

  const pair = createMemo(() => {
    const a = asEnd(from());
    const b = asEnd(to());
    return a && b ? { from: a, to: b } : null;
  });

  /** The name an end travels under in a URL. */
  const endName = (end: Endpoint | null): string | undefined =>
    end ? (end.kind === "me" ? "me" : end.id) : undefined;

  /*
   * A link names both ends, so a trip someone sends opens as that trip rather
   * than as an empty planner with a story attached. Ends the screen already
   * holds are left alone - this also fires when the screen itself wrote the
   * URL, and re-setting an end it just set would churn the plan for nothing.
   */
  createEffect(
    () => `${search().from ?? ""}|${search().to ?? ""}`,
    () => {
      const start = endOf(search().from);
      const end = endOf(search().to);
      if (start && endName(start) !== endName(from())) setFrom(start);
      if (end && endName(end) !== endName(to())) {
        setTo(end);
        setPicking(null);
      }
    },
  );

  /*
   * And the other way round: the ends the screen is showing are the ends the
   * URL names, however they were chosen - typed, tapped on a pin, aimed with
   * the map. A plan made by hand is as reloadable and shareable as one
   * arrived at by link, and the back button walks out of it. `replace`, so
   * every reconsidered end is not a page of history.
   */
  const navigate = useNavigate();
  createEffect(
    () => ({ a: endName(from()), b: endName(to()) }),
    ({ a, b }) => {
      if ((search().from ?? undefined) === a && (search().to ?? undefined) === b) return;
      void navigate({
        to: "/plan",
        // The ends changed, so whichever alternative was chosen is gone with
        // them; `j` is dropped rather than carried to a different question.
        search: { ...(a !== undefined && { from: a }), ...(b !== undefined && { to: b }) },
        replace: true,
      });
    },
  );

  /*
   * Which of the answers is lit, as its place in the list - the first stays
   * out of the address, so only a deliberate second choice marks it. Ids
   * would be truer but they are a paragraph of route keys; a plan reloaded
   * moments later has the same list in the same order, which is what a
   * reload is.
   */
  createEffect(
    () => {
      const id = selectedId();
      const index = id === null ? -1 : journeys().findIndex((journey) => journey.id === id);
      return index > 0 ? index : undefined;
    },
    (index) => {
      if ((search().j ?? undefined) === index) return;
      // An address naming a choice keeps it until there is a list to choose
      // from; stripping it while the answer is still being worked out - the
      // position fix is often the slow part - would forget it unheard.
      if (journeys().length === 0 && search().j !== undefined) return;
      void navigate({
        to: "/plan",
        search: (prev) => {
          const { j: _, ...rest } = prev;
          return index === undefined ? rest : { ...rest, j: index };
        },
        replace: true,
      });
    },
  );

  const tripLabel = () =>
    [endpointLabel(from(), lang()), endpointLabel(to(), lang())].filter(Boolean).join(" → ");

  const shareTrip = () => {
    if (!pair()) return;
    // The address bar already names both ends; the link is where we stand.
    const url = window.location.href;

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

    /*
     * Focused for the keyboard that is already there: a wide window should
     * take typing the moment an end is being picked. A phone should not -
     * focusing raises its keyboard, and the screen opens with an end already
     * being picked, which popped the keyboard and the sheet over a map
     * nobody had asked anything of yet.
     */
    createEffect(
      () => active() && wide(),
      (on) => {
        if (on) field.focus();
      },
    );

    return (
      <div class={["flex h-11 w-full items-center gap-2 rounded-2xl bg-card px-3.5 shadow-card"]}>
        <input
          ref={field}
          value={active() ? query() : (endpointLabel(props.end, lang()) ?? "")}
          onInput={(e) => setQuery(e.currentTarget.value)}
          onFocus={() => {
            setPicking(props.which);
            setQuery("");
            setTyping(true);
          }}
          onBlur={() => setTyping(false)}
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
            class="app-press flex size-6 shrink-0 items-center justify-center rounded-full bg-secondary text-muted-foreground"
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
    <ExploreFrame
      sheetLabel={t("plan", lang())}
      snap={sheetSnap()}
      onSnapChange={setSheetSnap}
      sheetOpen={sheetOpen()}
      dismissible
      onDismiss={() => setSheetAway(true)}
      map={
        <div class="relative size-full">
          <ExploreMap
            lang={lang()}
            me={position()}
            pins={pins()}
            journeys={picking() ? [] : journeys()}
            selectedId={selectedId()}
            ends={ends()}
            onSelectJourney={setChosen}
            onSelectPin={(id) => {
              const stop = db().stopList[id];
              if (picking() && stop) choose(id, stop);
            }}
            pinned={aiming()}
            onViewChange={setMapCentre}
            insetFraction={!wide() && sheetOpen() ? EXPLORE_SHEET_LOW : 0}
          />

          {/* The autocomplete, floated under the fields. `preventDefault` on
              the press keeps the field focused through it - a suggestion
              that blurs the field on the way down closes itself before its
              own click can land. */}
          <Show when={!wide() && typing() && (matches().length > 0 || picking() === "from")}>
            <div
              class="app-scroll absolute inset-x-2.5 top-2.5 z-20 max-h-[70%] touch-pan-y overflow-y-auto"
              onMouseDown={(e) => e.preventDefault()}
            >
              <Suggestions />
            </div>
          </Show>

          {/* The results, pushed away but not gone: one press brings the
              sheet back. Sits where the sheet's edge was. */}
          <Show when={!wide() && sheetAway() && journeys().length > 0 && picking() === null}>
            <div class="absolute inset-x-0 bottom-3.5 z-10 flex justify-center">
              <button
                type="button"
                onClick={() => {
                  setSheetAway(false);
                  setSheetSnap(0);
                }}
                class="app-press tnum flex h-9 items-center rounded-full bg-primary px-4 text-[0.81rem] font-bold text-primary-foreground shadow-card"
              >
                {journeys().length} {t("routesCount", lang())}
              </button>
            </div>
          </Show>

          {/* Nowhere to go, said over the map: a sheet that exists only to
              carry results does not open to carry an apology. */}
          <Show when={!wide() && picking() === null && from() && to() && journeys().length === 0}>
            <div class="absolute inset-x-0 bottom-3.5 z-10 flex justify-center px-3">
              <div class="flex flex-col items-center gap-0.5 rounded-2xl bg-card px-4 py-3 text-center shadow-card">
                <span class="text-[0.88rem] font-bold text-foreground">
                  {t("noJourneys", lang())}
                </span>
                <span class="text-[0.75rem] font-medium text-subtle-foreground">
                  {t("noJourneysHint", lang())}
                </span>
              </div>
            </div>
          </Show>

          {/*
           * What the pin would choose, said before it is chosen: the nearest
           * stop by name and distance, a confirm, and the way out. It floats
           * clear of the sheet's low rest, where the pin's answer lands.
           */}
          <Show when={aiming()}>
            <div
              class="absolute inset-x-0 z-10 flex justify-center px-3"
              style={{ bottom: "0.875rem" }}
            >
              <div class="flex min-w-0 items-center gap-2 rounded-full bg-card p-1.5 shadow-card">
                <Show
                  when={pinStop()}
                  fallback={
                    <span class="px-2.5 text-[0.81rem] font-semibold text-subtle-foreground">
                      {t("noStopNearPin", lang())}
                    </span>
                  }
                >
                  {(near) => (
                    <>
                      <span class="flex min-w-0 items-baseline gap-1.5 pl-2.5">
                        <span class="max-w-[9.5rem] truncate text-[0.88rem] font-bold text-foreground">
                          {stripStopCode(pick(near().stop.name, lang()))}
                        </span>
                        <span class="tnum shrink-0 text-[0.75rem] font-medium text-subtle-foreground">
                          {formatDistance(near().metres)}
                        </span>
                      </span>
                      <button
                        type="button"
                        onClick={() => choose(near().stopId, near().stop)}
                        class="app-press flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-primary px-3 text-[0.81rem] font-bold text-primary-foreground"
                      >
                        <CheckIcon size={13} />
                        {t("useThisStop", lang())}
                      </button>
                    </>
                  )}
                </Show>
                <Show when={!wide()}>
                  <button
                    type="button"
                    aria-label={t("close", lang())}
                    onClick={() => {
                      setPicking(null);
                      setQuery("");
                    }}
                    class="app-press flex size-8 shrink-0 items-center justify-center rounded-full bg-secondary text-muted-foreground"
                  >
                    <CloseIcon size={13} />
                  </button>
                </Show>
              </div>
            </div>
          </Show>
        </div>
      }
      header={
        <>
          {/* The switch IS the title, at every width - 搜尋/規劃 says what the
              screen is better than a heading above it could. Full width, so
              it lines up with the fields under it. */}
          <ModeSwitch lang={lang()} />

          <div class="flex items-stretch gap-2.5">
            {/*
             * The dot, the dotted run and the pin, in the gutter beside the
             * fields: the journey is drawn once here so neither field has to
             * carry a "起點" label to say which end it is.
             */}
            <div class="flex w-3 shrink-0 flex-col items-center py-4" aria-hidden="true">
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
              class="app-press flex size-9 shrink-0 self-center items-center justify-center rounded-full bg-secondary text-muted-foreground"
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
                    "app-press flex h-8 items-center gap-1.5 rounded-full px-3 text-[0.81rem] font-bold transition-colors duration-state",
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
                  class="app-press flex size-8 items-center justify-center rounded-full bg-secondary text-muted-foreground"
                >
                  <ShareIcon size={13} />
                </button>
              </div>
            )}
          </Show>
        </>
      }
      panel={
        <div class="flex flex-col gap-6">
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
                          class="app-tap min-w-0 grow truncate text-left text-[0.88rem] font-bold text-foreground"
                        >
                          {trip.label}
                        </button>
                        <button
                          type="button"
                          aria-label={t("close", lang())}
                          onClick={() => trips.remove(trip.id)}
                          class="app-press flex size-7 shrink-0 items-center justify-center rounded-full bg-secondary text-muted-foreground"
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

          <Show when={wide()}>
            <Reveal open={picking() !== null}>
              <Suggestions />
            </Reveal>
          </Show>

          <Section>
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
                    {(journey) => (
                      <JourneyCard
                        journey={journey}
                        lang={lang()}
                        selected={journey.id === selectedId()}
                        onSelect={() => setChosen(journey.id)}
                      />
                    )}
                  </For>
                </div>
              </Show>
            </Show>
          </Section>
        </div>
      }
    />
  );
}
