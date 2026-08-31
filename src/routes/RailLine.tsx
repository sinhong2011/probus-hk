import { useLinkProps, useNavigate, useParams, useSearch } from "@tanstack/solid-router";
import { For, Show, createMemo } from "solid-js";
import { Card, Chip, EmptyState, Hairline, Reveal, SectionLabel } from "~/components/Chrome";
import { ChevronRightIcon, CloseIcon, PinIcon } from "~/components/Icons";
import { DirectionTrains } from "~/components/DirectionTrains";
import { Page, Section, SplitPage } from "~/components/Layout";
import { RoutePlate } from "~/components/RoutePlate";
import { routeLink } from "~/lib/links";
import { useDb } from "~/data/context";
import { NotFound } from "~/routes/NotFound";
import { lineName, lineStations, railLine, type RailLine, type RailStation } from "~/data/rail";
import { railFare, type RailFare } from "~/data/railFares";
import { serviceSpan } from "~/data/schedule";
import type { Bilingual, KeyedRoute } from "~/data/types";
import { distanceM } from "~/lib/geo";
import { pick, t, type Lang } from "~/lib/i18n";
import { plateStyle } from "~/lib/operators";
import { useGeolocation } from "~/stores/geolocation";
import { settings } from "~/stores/settings";

/** Past this you are not at the station, you are near it. */
const AT_STATION_M = 500;

const lineColor = (code: string) => plateStyle(["mtr"], code).background;

/**
 * One line, read the way the railway is read.
 *
 * A bus route is a direction you pick before anything else; a railway line is a
 * place you stand and two ways it can take you. So the line page is a list of
 * stations on a coloured spine - the shape of the diagram in every station -
 * and opening one shows both directions at once, each with its platform. That
 * is the question a rider on a platform actually has, and the direction-first
 * route page could not answer it without being visited twice.
 */
export default function RailLine() {
  const db = useDb();
  const params = useParams({ from: "/rail/$code" });
  const lang = settings.lang;
  const { position } = useGeolocation();

  const code = () => params().code.toUpperCase();
  const line = createMemo(() => railLine(db(), code()));
  const stations = createMemo(() => {
    const l = line();
    return l ? lineStations(db(), l) : [];
  });

  /*
   * Two stations, in the order a rider names them: where they are standing,
   * and where they are going. The first is also the one whose panel is open -
   * a railway station's own question, both directions and their platforms - so
   * a rider who only ever taps once never meets the second half of this at all.
   */
  /*
   * The trip lives in the URL rather than in a signal: two taps that name a
   * journey have named a place worth reloading and worth sending, and the
   * URL was already the state everywhere else the screen keeps one. Replace,
   * not push - re-picking stations is thinking, not travelling.
   */
  const search = useSearch({ from: "/rail/$code" });
  const navigate = useNavigate();
  const fromId = () => search().from ?? null;
  const toId = () => search().to ?? null;
  const setTrip = (from: string | null, to: string | null) =>
    void navigate({
      to: "/rail/$code",
      params: { code: params().code },
      search: { ...(from !== null && { from }), ...(to !== null && { to }) },
      replace: true,
    });

  const select = (id: string) => {
    // Tapping the open station closes it, and closing is what clears the trip:
    // there is no destination without somewhere to leave from.
    if (fromId() === id) {
      setTrip(null, null);
      return;
    }
    if (!fromId()) {
      setTrip(id, null);
      return;
    }
    setTrip(fromId(), toId() === id ? null : id);
  };

  const clearTrip = () => {
    setTrip(null, null);
  };

  /**
   * The stretch of line being priced, as positions in the list. Stations are
   * in running order, so the ride is everything between the two - whichever
   * way round they were tapped.
   */
  const ride = createMemo(() => {
    const list = stations();
    const from = list.findIndex((s) => s.id === fromId());
    const to = list.findIndex((s) => s.id === toId());
    if (from < 0 || to < 0) return null;
    return { start: Math.min(from, to), end: Math.max(from, to) };
  });

  /** How a station takes part in the trip: its ends, its middle, or not at all. */
  const roleOf = (id: string, index: number): StationRole => {
    if (id === fromId()) return "from";
    if (id === toId()) return "to";
    const stretch = ride();
    return stretch && index > stretch.start && index < stretch.end ? "between" : null;
  };

  /**
   * The priced trip, ready to render: both station names and what it costs.
   * The fare arrives with the table, which is fetched the first time anyone
   * asks - until then this is a trip with no price on it yet, not no trip.
   */
  const trip = createMemo(() => {
    const list = stations();
    const from = list.find((s) => s.id === fromId());
    const to = list.find((s) => s.id === toId());
    if (!from || !to) return null;
    return { from: from.stop.name, to: to.stop.name, fare: railFare(from.id, to.id) };
  });

  /** The station you are standing at, if you are standing at one. */
  const nearestId = createMemo(() => {
    const here = position();
    const list = stations();
    if (!here || list.length === 0) return null;

    let best: RailStation | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const station of list) {
      const metres = distanceM(here, station.stop.location);
      if (metres < bestDistance) {
        bestDistance = metres;
        best = station;
      }
    }
    return best && bestDistance <= AT_STATION_M ? best.id : null;
  });

  return (
    <Show when={line()} fallback={<EmptyStatePage lang={lang()} />}>
      {(l) => (
        /* The line is the context and the stations are the list, which is the
           split every other detail screen on a wide window already uses: the
           name, the colour and the two directions stay put while the trail of
           stations scrolls beside them. */
        <SplitPage
          aside={
            <>
              <LineHeader line={l()} lang={lang()} count={stations().length} />
            </>
          }
        >
          <Section>
            <SectionLabel
              trailing={
                <span class="text-[0.75rem] font-semibold text-faint-foreground">
                  {/* The second tap has to be taught, or it is not there. */}
                  {fromId() ? t("tapDestination", lang()) : t("tapStation", lang())}
                </span>
              }
            >
              {t("lineStations", lang())}
            </SectionLabel>

            <Card>
              <For each={stations()}>
                {(station, index) => (
                  <StationRow
                    station={station}
                    line={l()}
                    lang={lang()}
                    first={index() === 0}
                    last={index() === stations().length - 1}
                    here={nearestId() === station.id}
                    open={fromId() === station.id}
                    role={roleOf(station.id, index())}
                    trip={station.id === toId() ? trip() : null}
                    onClear={clearTrip}
                    onToggle={() => select(station.id)}
                  />
                )}
              </For>
            </Card>
          </Section>
        </SplitPage>
      )}
    </Show>
  );
}

/** The screen when the line in the URL is not one the database has. */
function EmptyStatePage(props: { lang: Lang }) {
  return (
    <Page>
      <NotFound kind="line" />
    </Page>
  );
}

/**
 * The line, named and coloured.
 *
 * The colour is the line's identity - riders say "the red line" long before
 * they say 荃灣綫 - so it is a band across the top rather than a detail on a
 * badge, and every direction row underneath carries it too.
 */
function LineHeader(props: { line: RailLine; lang: Lang; count: number }) {
  const db = useDb();
  const colour = () => lineColor(props.line.code);

  return (
    <Card>
      <div class="h-1.5 w-full" style={{ background: colour() }} aria-hidden="true" />

      <div class="flex items-center gap-3 px-3.5 pb-3 pt-3.5">
        <RoutePlate route={props.line.code} co={["mtr"]} size="lg" />
        <div class="flex min-w-0 grow flex-col gap-0.5">
          <h1 class="truncate text-[1.15rem] font-bold tracking-[-0.025em] text-foreground">
            {pick(lineName(props.line.code), props.lang)}
          </h1>
          <span class="truncate text-[0.81rem] font-medium text-subtle-foreground">
            {pick(lineName(props.line.code), props.lang === "zh" ? "en" : "zh")}
          </span>
        </div>
        <Chip class="shrink-0">
          <span class="tnum">
            {props.count} {t("stops", props.lang)}
          </span>
        </Chip>
      </div>

      {/* Each direction, with the two times that decide whether the railway is
          an option at all. */}
      <For each={props.line.directions}>
        {(route) => {
          const span = () => serviceSpan(db(), route);
          return (
            <>
              <Hairline />
              <a
                {...useLinkProps(routeLink(route.key))}
                class="app-tap flex items-center gap-3 px-3.5 py-2.5"
              >
                <span
                  class="size-2.5 shrink-0 rounded-full"
                  style={{ background: colour() }}
                  aria-hidden="true"
                />
                <div class="flex min-w-0 grow flex-col gap-0.5">
                  <span class="truncate text-[0.88rem] font-bold text-foreground">
                    {t("towards", props.lang)} {pick(route.dest, props.lang)}
                  </span>
                  <Show when={span()}>
                    {(hours) => (
                      <span class="tnum truncate text-[0.75rem] font-medium text-subtle-foreground">
                        {t("firstTrain", props.lang)} {hours().first} · {t("lastTrain", props.lang)}{" "}
                        {hours().last}
                      </span>
                    )}
                  </Show>
                </div>
                <span class="shrink-0 text-faint-foreground">
                  <ChevronRightIcon size={14} />
                </span>
              </a>
            </>
          );
        }}
      </For>
    </Card>
  );
}

/** Where a station sits in the trip being priced, if there is one. */
type StationRole = "from" | "to" | "between" | null;

/** Both ends of the trip and what it costs, shown on the destination row. */
interface Trip {
  from: Bilingual;
  to: Bilingual;
  fare: RailFare | null;
}

/**
 * A station on the spine.
 *
 * Closed it is a name, the lines you can change to, and where you are. Open it
 * is both directions' next trains - which is one request, not two: the feed
 * answers per line and station, and the two directions come out of the same
 * response.
 *
 * Tapped a second time, somewhere further down the line, it is the other end of
 * a journey, and it carries the fare.
 */
function StationRow(props: {
  station: RailStation;
  line: RailLine;
  lang: Lang;
  first: boolean;
  last: boolean;
  here: boolean;
  open: boolean;
  role: StationRole;
  trip: Trip | null;
  onClear: () => void;
  onToggle: () => void;
}) {
  const colour = () => lineColor(props.line.code);

  /* A station on the trip is filled in, the way a paper map inks the stretch
     you are riding; the ends of it also carry the ring the "you are here" dot
     uses, because they are the two the rider chose. */
  const onTrip = () => props.role !== null;
  const isEnd = () => props.role === "from" || props.role === "to";

  return (
    <div class="relative flex flex-col">
      {/*
       * The divider is positioned rather than stacked, and starts past the
       * spine. A hairline in the flow took a pixel of height out of the line at
       * every station, which turned a railway into a dashed one.
       */}
      <Show when={!props.last}>
        <span aria-hidden="true" class="absolute inset-x-0 bottom-0 left-10 h-px bg-border" />
      </Show>

      <button
        type="button"
        onClick={props.onToggle}
        aria-expanded={props.open ? "true" : "false"}
        class="app-tap flex w-full items-center gap-3 px-3.5 py-2.5 text-left"
      >
        {/* The line, drawn. The negative margin cancels the row's padding so
            one row's spine meets the next one's rather than stopping short. */}
        <div class="-my-2.5 flex w-3.5 shrink-0 flex-col items-center self-stretch">
          <div
            class="w-[3px] shrink-0"
            style={{ height: "18px", background: props.first ? "transparent" : colour() }}
          />
          <div
            class={[
              "shrink-0 rounded-full transition-all duration-state",
              props.here || isEnd() ? "size-3" : "size-2.5",
            ]}
            style={{
              background: props.here || onTrip() ? colour() : "var(--card)",
              border: `3px solid ${colour()}`,
              "box-shadow":
                props.here || isEnd()
                  ? `0 0 0 3px var(--card), 0 0 0 6px color-mix(in srgb, ${colour()} 28%, transparent)`
                  : undefined,
            }}
          />
          <div class="w-[3px] grow" style={{ background: props.last ? "transparent" : colour() }} />
        </div>

        <div class="flex min-w-0 grow flex-col gap-0.5">
          <div class="flex min-w-0 items-center gap-1.5">
            <span class="truncate text-[0.94rem] font-bold tracking-[-0.01em] text-foreground">
              {pick(props.station.stop.name, props.lang)}
            </span>
            <Show when={props.here}>
              <span class="shrink-0 text-primary" title={t("youAreHere", props.lang)}>
                <PinIcon size={12} />
                <span class="sr-only">{t("youAreHere", props.lang)}</span>
              </span>
            </Show>
          </div>
        </div>

        {/*
         * Where you can change. Coloured chips rather than names, because that
         * is how the network map says it and how a rider reads it - and because
         * four line names would not fit beside a station name on a phone.
         */}
        <Show when={props.station.interchanges.length > 0}>
          <div class="flex shrink-0 items-center gap-1" aria-label={t("interchange", props.lang)}>
            <For each={props.station.interchanges}>
              {(other) => (
                <span
                  class="flex h-[1.05rem] items-center rounded px-1 text-[0.69rem] font-extrabold"
                  style={{
                    background: lineColor(other),
                    color: plateStyle(["mtr"], other).color,
                  }}
                >
                  {other}
                </span>
              )}
            </For>
          </div>
        </Show>
      </button>

      {/*
       * The spine has to carry on behind the opened panel, or the line reads
       * as cut in half at exactly the station you are looking at. The wrapper
       * is only as tall as the reveal, so the segment grows and shrinks with
       * it rather than being drawn and then hidden.
       */}
      <div class="relative">
        <Show when={!props.last}>
          <span
            aria-hidden="true"
            class="absolute inset-y-0 w-[3px]"
            style={{ left: "19.5px", background: colour() }}
          />
        </Show>
        <Reveal open={props.open}>
          <div class="flex flex-col gap-2 px-3.5 pb-3 pl-[2.9375rem]">
            <For each={props.line.directions}>
              {(route) => (
                <DirectionTrains
                  route={route}
                  stationId={props.station.id}
                  lang={props.lang}
                  active={props.open}
                />
              )}
            </For>
          </div>
        </Reveal>

        {/* The fare lands under the station just tapped, which is the one the
            rider is looking at - not back up the line at the station they
            started from, half a screen away. */}
        <Reveal open={props.trip !== null}>
          <Show when={props.trip}>
            {(trip) => <FareCard trip={trip()} lang={props.lang} onClear={props.onClear} />}
          </Show>
        </Reveal>
      </div>
    </div>
  );
}

/**
 * What the ride costs, in the classes a rider might be travelling on.
 *
 * Octopus first and largest: it is what almost everyone taps in with, and the
 * single-journey ticket beside it is the price of not having one. The
 * concessions come from the railway's own table rather than the government's
 * $2 formula the bus screens compute - the railway prices its own child,
 * elderly and student fares, and on the Airport Express it publishes none.
 */
function FareCard(props: { trip: Trip; lang: Lang; onClear: () => void }) {
  const fare = () => props.trip.fare;

  return (
    <div
      data-rail-fare
      class="mx-3.5 mb-3 ml-[2.9375rem] flex flex-col gap-2 rounded-lg bg-secondary px-3 py-2.5"
    >
      <div class="flex items-center gap-2">
        <span class="min-w-0 grow truncate text-[0.88rem] font-bold text-foreground">
          {pick(props.trip.from, props.lang)}
          <span class="px-1.5 text-subtle-foreground">→</span>
          {pick(props.trip.to, props.lang)}
        </span>
        <button
          type="button"
          aria-label={t("clearTrip", props.lang)}
          title={t("clearTrip", props.lang)}
          onClick={props.onClear}
          class="app-press flex size-7 shrink-0 items-center justify-center rounded-full bg-card text-muted-foreground"
        >
          <CloseIcon size={12} />
        </button>
      </div>

      <Show
        when={fare()}
        fallback={
          <span class="text-[0.75rem] font-medium text-subtle-foreground">
            {t("loadingFares", props.lang)}
          </span>
        }
      >
        {(f) => (
          <div class="flex flex-wrap items-center gap-1.5">
            <Show when={f().octopus}>
              {(value) => (
                <Chip tone="accent" class="shrink-0">
                  <span>{t("fareOctopusAdult", props.lang)}</span>
                  <span class="tnum">{value()}</span>
                </Chip>
              )}
            </Show>
            <Show when={f().single}>
              {(value) => (
                <Chip class="shrink-0">
                  <span>{t("fareSingleTicket", props.lang)}</span>
                  <span class="tnum">{value()}</span>
                </Chip>
              )}
            </Show>
            <Show when={f().child}>
              {(value) => (
                <Chip class="shrink-0">
                  <span>{t("fareChild", props.lang)}</span>
                  <span class="tnum">{value()}</span>
                </Chip>
              )}
            </Show>
            <Show when={f().elderly}>
              {(value) => (
                <Chip class="shrink-0">
                  <span>{t("fareElderly", props.lang)}</span>
                  <span class="tnum">{value()}</span>
                </Chip>
              )}
            </Show>
            <Show when={f().student}>
              {(value) => (
                <Chip class="shrink-0">
                  <span>{t("fareStudent", props.lang)}</span>
                  <span class="tnum">{value()}</span>
                </Chip>
              )}
            </Show>
          </div>
        )}
      </Show>
    </div>
  );
}
