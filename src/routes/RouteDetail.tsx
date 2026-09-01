import { useLinkProps, useNavigate, useParams, useRouter, useSearch } from "@tanstack/solid-router";
import { For, Show, createEffect, createMemo, createSignal, lazy, onCleanup } from "solid-js";
import {
  Card,
  Chip,
  EmptyState,
  FareTag,
  Reveal,
  SectionLabel,
  SpecialTag,
  StopCode,
} from "~/components/Chrome";
import { Alert } from "~/components/Alert";
import { AlertSheet } from "~/components/AlertSheet";
import { CameraSheet } from "~/components/CameraSheet";
import { GroupSheet } from "~/components/GroupSheet";
import { Modal } from "~/components/Modal";
import { RollingNumber } from "~/components/RollingNumber";
import { SplitPage } from "~/components/Layout";
import { EtaCountdown, EtaRemark } from "~/components/EtaCountdown";
import {
  AlarmIcon,
  BookmarkIcon,
  BusIcon,
  CameraIcon,
  CloseIcon,
  ExchangeIcon,
  FlagIcon,
  InfoIcon,
  MegaphoneIcon,
  MinibusIcon,
  ShareIcon,
  StarFillIcon,
  StarIcon,
  TrainIcon,
} from "~/components/Icons";
import { RoutePlate } from "~/components/RoutePlate";
import { NotFound } from "~/routes/NotFound";
import { routeLink, stopLink } from "~/lib/links";
import { useDb } from "~/data/context";
import { useInView } from "~/lib/inView";
import { nearestCamera, type NearbyCamera } from "~/data/cameras";
import { isSpecialService, reverseRoute, routeAt, routeStops } from "~/data/db";
import { lineName, lineRank, stationLines } from "~/data/rail";
import { railFare } from "~/data/railFares";
import { lastRunGone, rideMinutes, routeTimetable, serviceSpan } from "~/data/schedule";
import type { Bilingual, Eta, KeyedRoute, RouteDb, StopEntry } from "~/data/types";
import { stopIdsFor, useEta } from "~/data/useEta";
import { useVehicles } from "~/data/useVehicles";
import { progressOf } from "~/data/vehicles";
import {
  clockTime,
  notableConcession,
  countdown,
  fareAt,
  formatFare,
  isLastRun,
  serviceNotice,
} from "~/lib/format";
import { now } from "~/stores/clock";
import { distanceM } from "~/lib/geo";
import { pick, stripStopCode, t, type Lang } from "~/lib/i18n";
import { operatorLabel, plateStyle, vehicleKind, type VehicleKind } from "~/lib/operators";
import { centerWhileItSettles } from "~/lib/scroll";
import { useGeolocation } from "~/stores/geolocation";
import { frequent } from "~/stores/frequent";
import { alertId, alerts } from "~/stores/alerts";
import { saved, savedId, type SavedItem } from "~/stores/saved";
import { toast } from "~/stores/toast";
import { settings } from "~/stores/settings";

/**
 * How close the last departure has to be before the page stops stating it and
 * starts warning about it. An hour is the point where a rider still has time to
 * decide to leave, which is what the warning is for.
 */
const LAST_CALL_MINUTES = 60;

/** Everything a bookmark needs except the answer the group sheet collects. */
type PendingSave = Omit<SavedItem, "id" | "group" | "order">;

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
          <span class="text-[0.81rem] font-medium text-subtle-foreground">
            {t("noTimetable", props.lang)}
          </span>
        }
      >
        <For each={groups()}>
          {(group) => (
            <div class="flex flex-col gap-1">
              <span class="text-[0.81rem] font-bold text-foreground">
                {daysLabel(group.flags, props.lang)}
              </span>
              <For each={group.bands}>
                {(band) => (
                  <div class="flex items-baseline justify-between gap-3">
                    <span class="tnum text-[0.81rem] font-semibold text-muted-foreground">
                      {band.from} - {band.to}
                    </span>
                    <span class="tnum shrink-0 text-[0.81rem] font-medium text-subtle-foreground">
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
 * The ride being planned, as one band above the list.
 *
 * Everything a rider actually wants from a route page is here once both ends
 * are known: how long they are on the bus, what it costs from where they get
 * on, and - the part no timetable gives them - roughly what time they will be
 * standing at the other end, taken from the bus that is actually coming.
 *
 * With only the boarding stop set it asks for the other end instead of showing
 * half an answer.
 */
function RideBand(props: {
  route: KeyedRoute;
  /** False while the band is on its way out: it should not still be polling. */
  active: boolean;
  boardSeq: number;
  boardName: Bilingual;
  ride: { board: StopEntry; alight: StopEntry; minutes: number; fare: string | null } | null;
  alightSeq: number | null;
  alightStopId: string | null;
  lang: Lang;
  onClear: () => void;
}) {
  const etas = useEta(
    () =>
      props.active
        ? {
            route: props.route,
            seq: props.boardSeq,
            stopIdByCo: stopIdsFor(props.route, props.boardSeq),
          }
        : null,
    /*
     * Three, not one. A feed keeps reporting a bus for a while after it has
     * left, and with one arrival asked for that bus was the whole answer: the
     * band added the ride to a departure already behind it and, since that
     * time is a minute or so ago, read as "now plus the ride" - the wait for
     * the bus that is actually coming had been left out.
     */
    3,
  );

  /*
   * The ride, held through its own exit. The figures row animates open when
   * the other end is chosen and closed when it is taken away, and a row that
   * empties itself before it has finished collapsing collapses onto nothing.
   */
  const [shownRide, setShownRide] = createSignal<{
    board: StopEntry;
    alight: StopEntry;
    minutes: number;
    fare: string | null;
  } | null>(null);
  createEffect(
    () => props.ride,
    (ride) => {
      if (ride) setShownRide(ride);
    },
  );

  /**
   * When the bus that is coming would put you at the other end.
   *
   * The bus that is coming, not the first one the feed lists: departed buses
   * are dropped the way the countdown drops them, on the same clock, so the
   * estimate rolls on to the next bus the moment the one before it has gone.
   */
  const arriveAt = createMemo(() => {
    const ride = shownRide();
    const at = now();
    const next = etas()?.find((eta) => countdown(eta, at).kind !== "gone");
    if (!ride || !next) return null;
    return new Date(next.at.getTime() + ride.minutes * 60_000);
  });

  const armed = () =>
    props.alightStopId !== null && alerts.has("destination", props.route.key, props.alightStopId);

  const remind = () => {
    const stopId = props.alightStopId;
    const seq = props.alightSeq;
    if (stopId === null || seq === null) return;

    if (armed()) {
      alerts.remove(alertId("destination", props.route.key, stopId));
      return;
    }
    alerts.arm({
      kind: "destination",
      routeKey: props.route.key,
      co: props.route.co[0] ?? "kmb",
      stopId,
      seq,
      leadMinutes: settings.alertLeadMinutes(),
      radiusM: settings.alertRadiusM(),
    });
    toast.show(
      t("alertDestination", props.lang),
      stripStopCode(pick(props.ride?.alight.name ?? { zh: "", en: "" }, props.lang)),
    );
  };

  return (
    /* Not a `Card`: the band floats over the stop list, which is itself a
       card, so the same surface vanished into it - this is a step above, with
       the shadow a floating thing owes the rows it covers. */
    <div class="overflow-hidden rounded-xl bg-secondary shadow-xl">
      <div class="flex items-center gap-2.5 px-3.5 py-2.5">
        {/* The flag sits in its own disc rather than loose against the text:
            a lone glyph beside a line of type read as a form field, which is
            the one thing this band is not. */}
        <span class="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary-muted text-primary">
          <FlagIcon size={13} />
        </span>

        <div class="flex min-w-0 grow flex-col gap-0.5">
          {/* Half a trip is still worth stating. Naming only what is missing
              threw away the stop the rider had just chosen, so the band said
              less than the row they tapped. */}
          <Show
            when={props.ride}
            fallback={
              <>
                <span class="truncate text-[0.88rem] font-bold text-foreground">
                  {t("boardLabel", props.lang)} · {stripStopCode(pick(props.boardName, props.lang))}
                </span>
                <span class="truncate text-[0.75rem] font-medium text-subtle-foreground">
                  {t("pickAlight", props.lang)}
                </span>
              </>
            }
          >
            {(ride) => (
              <span class="truncate text-[0.88rem] font-bold text-foreground">
                {stripStopCode(pick(ride().board.name, props.lang))}
                <span class="px-1.5 text-subtle-foreground">→</span>
                {stripStopCode(pick(ride().alight.name, props.lang))}
              </span>
            )}
          </Show>
        </div>

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

      <Reveal open={props.ride !== null}>
        <Show when={shownRide()}>
          {(ride) => (
            <div class="flex flex-wrap items-center gap-1.5 border-t border-border px-3.5 py-2.5">
              <Chip tone="accent" class="shrink-0">
                <span class="tnum">
                  {t("rideTime", props.lang)} {t("aboutMinutes", props.lang)} {ride().minutes}{" "}
                  {t("minute", props.lang)}
                </span>
              </Chip>
              <Show when={ride().fare}>
                {(fare) => (
                  <Chip tone="card" class="shrink-0">
                    <span class="tnum">{fare()}</span>
                  </Chip>
                )}
              </Show>
              <Show when={arriveAt()}>
                {(at) => (
                  <Chip tone="card" class="shrink-0">
                    <span class="tnum">
                      {t("arriveAbout", props.lang)} {clockTime(at())}
                    </span>
                  </Chip>
                )}
              </Show>

              {/* The reminder this screen exists to make easy: you know where you
                  are getting off, so the app can watch for it. */}
              <button
                type="button"
                aria-pressed={armed() ? "true" : "false"}
                onClick={remind}
                class={[
                  "app-press ml-auto flex h-[1.6rem] shrink-0 items-center gap-1.5 rounded-full px-2.5 text-[0.75rem] font-bold transition-colors duration-state",
                  {
                    "bg-primary text-primary-foreground": armed(),
                    "bg-card text-muted-foreground": !armed(),
                  },
                ]}
              >
                <AlarmIcon size={11} />
                {/* Not "get off here" - that is the row's job. This one is the
                    app watching for it on the rider's behalf. */}
                {t("alertDestination", props.lang)}
              </button>
            </div>
          )}
        </Show>
      </Reveal>
    </div>
  );
}

/**
 * The vehicle a route runs, as the glyph the list draws for it.
 *
 * The same three the map paints its markers from, picked by the same rule -
 * see `vehicleKind`. A train creeping up the rail beside a station list and a
 * bus creeping along the map were one vehicle wearing two faces.
 */
const VEHICLE_ICON: Record<VehicleKind, typeof BusIcon> = {
  bus: BusIcon,
  minibus: MinibusIcon,
  rail: TrainIcon,
};

/**
 * How far off the bus is, in words. Shared by the stop row and the sheet under
 * an opened-out map, which are the same sentence in two places.
 */
function awayLabel(away: number, lang: Lang): string {
  if (away === 0) return t("busArrivingNow", lang);
  if (away === 1) return t("busOneStopAway", lang);
  return `${t("busAwayLead", lang)} ${away} ${t("busAwayTail", lang)}`;
}

/**
 * The two departures after the one the row is counting down, stacked under
 * it.
 *
 * A column, not a row: three arrivals are one series, and a series reads down -
 * the eye goes 28, 37 without being led, and the clock times line up into a
 * second column so the pair reads as a small timetable. Nothing here needs a
 * container or a label; sitting directly under the countdown, in its accent,
 * already says what they are, and the word that used to head them was one
 * more thing to read on the way to the numbers.
 *
 * Each carries the clock time it lands at. That is the point of the second
 * number: "45 分鐘" is something you have to add to a watch before it means
 * anything, whereas 15:42 is either before or after where you have to be. The
 * row's own countdown needs no clock - nobody plans around four minutes.
 */
function LaterArrivals(props: { etas: Eta[]; lang: Lang; class?: string }) {
  const rest = createMemo(() => {
    const at = now();
    return props.etas
      .map((eta) => ({ state: countdown(eta, at), at: eta.at }))
      .filter((row) => row.state.kind !== "gone")
      .slice(1, 3);
  });

  return (
    <Show when={rest().length > 0}>
      <div class={`flex items-baseline ${props.class ?? ""}`}>
        <div class="flex min-w-0 flex-col gap-[3px]">
          {/* Keyed by position: the tick rebuilds these objects every second,
              and a value-keyed list would remount the digits with it. */}
          <For each={rest()} keyed={false}>
            {(row, index) => (
              <span
                // The digits are hidden from assistive tech (ten per column),
                // so the spoken value has to live on the line itself.
                aria-label={[
                  `${row().state.kind === "arriving" ? 0 : row().state.minutes} ${t("minute", props.lang)}`,
                  clockTime(row().at),
                  row().state.remark ? pick(row().state.remark as Bilingual, props.lang) : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                // A frame apart, so the pair reads as arriving in order rather
                // than as one block appearing.
                style={{ "animation-delay": `${index * 45}ms` }}
                class="app-pop flex items-baseline gap-1.5"
              >
                {/* Right-aligned, so a tilde or a second digit pushes the
                    number out to the left and the units stay in line. */}
                <span class="flex min-w-[2.9rem] items-baseline justify-end gap-[3px]">
                  {/* The same accent as the countdown above them: these are
                      the same answer for the two buses after it, and in grey
                      they read as a footnote to the row rather than as the
                      rest of it. Weaker, because the first one is still the
                      one the rider is deciding on - but a step up the scale
                      from where they were: a rider who has opened a row is
                      reading these to decide whether to wait, and at footnote
                      size that decision was set in the smallest type on the
                      page. */}
                  <span class="tnum text-[1.13rem] font-bold leading-none tracking-[-0.03em] text-primary/70">
                    <Show when={row().state.scheduled}>
                      <span class="opacity-60">~</span>
                    </Show>
                    <RollingNumber
                      value={row().state.kind === "arriving" ? 0 : row().state.minutes}
                    />
                  </span>
                  <span class="text-[0.75rem] font-semibold text-subtle-foreground">
                    {t("minute", props.lang)}
                  </span>
                </span>

                <span class="tnum text-[0.75rem] font-semibold text-faint-foreground">
                  {clockTime(row().at)}
                </span>

                {/* An operator that marks one of these as the last of the day
                    is answering a question the number alone cannot. Anything
                    longer than that is already up beside the stop's name. */}
                <EtaRemark state={row().state} lang={props.lang} notices={false} />
              </span>
            )}
          </For>
        </div>
      </div>
    </Show>
  );
}

/**
 * The same notice in the language the reader is not reading.
 *
 * Operators type these by hand and the two sides are rarely a translation of
 * each other - one names the road and the other does not. Where the second line
 * says something of its own it is worth the two lines it costs, and where it is
 * empty or the same words it is not shown at all.
 */
function otherLanguage(text: Bilingual, lang: Lang): string | undefined {
  const line = (lang === "zh" ? text.en : text.zh).trim();
  return line && line !== pick(text, lang).trim() ? line : undefined;
}

/**
 * A notice as a string two rows can compare, so a run of stops wearing the
 * same one is recognised as one notice rather than the same notice N times.
 */
function noticeKey(text: Bilingual | undefined): string | undefined {
  return text ? `${text.zh.trim()}\n${text.en.trim()}` : undefined;
}

/**
 * "牛頭角道, 花園大廈喜鵲樓外" as its street and its landmark. Only the first
 * comma splits; a name with none is all landmark.
 */
function splitStopName(name: string): { head: string | null; tail: string } {
  const at = name.search(/[,，]/);
  if (at <= 0) return { head: null, tail: name };
  const head = name.slice(0, at).trim();
  const tail = name.slice(at + 1).trim();
  return tail ? { head, tail } : { head: null, tail: name };
}

/** A bus on the rail below a stop: where it is along the way to the next. */
interface RailBus {
  id: string;
  /** 0 is this stop, 1 is the next. */
  fraction: number;
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
  onAlert: () => void;
  /** Hands the page a bookmark to make, once it has asked where it belongs. */
  onGroup: (entry: PendingSave) => void;
  onShare: () => void;
  /** Hands the page a traffic camera near this stop, to open in a sheet. */
  onCamera: (near: NearbyCamera) => void;
  /** Hands the page the operator's notice for this stop, to open in full. */
  onNotice: (notice: Bilingual) => void;
  /** The ride being planned: this stop's part in it, if it has one. */
  role: "board" | "alight" | "riding" | null;
  onBoard: () => void;
  onAlight: () => void;
  /** Whether picking an alighting stop is the question this row can answer. */
  canAlight: boolean;
  /**
   * The rider has said where they get on and not yet where they get off, and
   * this row is one of the stops that could answer it.
   */
  picking: boolean;
  /** How far down the run of candidates this row is, for the sweep. */
  pickOrder: number;
  /** Outside the ride being planned. */
  dimmed: boolean;
  /**
   * The day's last bus has already gone past this stop.
   *
   * Read from the timetable rather than from the empty answer: a stop with
   * nothing coming says "暫無班次", which is what a rider sees at four in the
   * morning and at four in the afternoon alike. One of those two is a wait;
   * the other is a taxi.
   */
  dayOver: boolean;
  /**
   * How many stops short of this one the next bus still is, or `null` when
   * nothing live is coming. Counted in stops rather than metres because that
   * is the unit a rider standing at a kerb can check for themselves.
   */
  busAway: number | null;
  /**
   * Tells the page what the operator says about this stop, so the page can
   * see where one notice covers a run of stops. Rows only know their own
   * arrivals; the run is the page's to notice.
   */
  onNoticeChange: (key: string | undefined) => void;
  /**
   * Hands the row's arrivals to the page, which lays them over the route
   * feed to place buses the feed alone cannot see - a joint route's other
   * operator answers per stop only, and its buses were on every row and
   * nowhere on the map.
   */
  onEtasChange: (etas: Eta[] | undefined) => void;
  /** The stop before carries the same notice: the rail above is part of it. */
  noticeAbove: boolean;
  /** The stop after carries the same notice: the rail below is part of it. */
  noticeBelow: boolean;
  /** Buses on their way from this stop to the next. */
  buses: RailBus[];
  /**
   * The other lines through this station, in the network map's order. Empty
   * on a bus route, and at a station with nothing to change to.
   */
  interchanges: string[];
  /**
   * The station the ride boards at, once a rail ride has one and this stop
   * is down the line from it - the two ends a rail fare is priced between.
   * A bus fare belongs to one stop; a rail fare belongs to a pair.
   */
  fareFrom: string | null;
}) {
  /*
   * Arrivals are the reason the list exists, so every row asks for them - but
   * only while it is on screen. Most operators answer per stop, and polling
   * forty rows every twenty seconds to fill a screen that shows eight is not a
   * trade worth making.
   */
  const [watchRow, visible] = useInView();
  const etas = useEta(
    () =>
      visible() || props.open
        ? { route: props.route, seq: props.seq, stopIdByCo: stopIdsFor(props.route, props.seq) }
        : null,
    3,
    { keepLast: true },
  );

  /*
   * What the row actually shows.
   *
   * A stop the last bus has already left behind keeps whatever the operator
   * still reports - a live answer is evidence - but drops the timetable's own
   * projections. Those are an estimate of a bus that has gone: route 104 takes
   * 75 minutes spread over 33 stops, so at ten to one the estimate still had
   * the 23:50 departure four minutes from a stop the feed had watched it pass.
   * "4 分鐘" under a stop whose last bus went ten minutes ago is worse than
   * saying nothing, and what the row says instead is 尾班車已過.
   */
  const shown = () => {
    const list = etas();
    if (!list || !props.dayOver) return list;
    return list.filter((eta) => eta.source !== "scheduled");
  };

  const pinned = () => saved.has(props.route.key, props.stopId);
  /* What the flag would say if it still said anything: the four states the one
     square carries, kept where a pointer and a screen reader can reach them. */
  const boardLabel = () =>
    props.role === "board"
      ? `${t("boardLabel", props.lang)} · ${t("clearTrip", props.lang)}`
      : props.role === "alight"
        ? `${t("alightLabel", props.lang)} · ${t("clearTrip", props.lang)}`
        : props.canAlight
          ? t("alightHere", props.lang)
          : t("boardHere", props.lang);
  /** Whether the ride being planned owns the rail above and below the dot. */
  const primaryAbove = () => props.isNearest || props.role === "riding" || props.role === "alight";
  const primaryBelow = () => props.role === "board" || props.role === "riding";
  const alerted = () =>
    alerts.has("arrival", props.route.key, props.stopId) ||
    alerts.has("destination", props.route.key, props.stopId);
  /*
   * The operator's own word on this stop - a diversion, a road closed - which
   * is about the stop rather than about any one departure, and is a sentence
   * rather than a badge. It rides beside the name, where it has the width to
   * be read and something to open.
   */
  const notice = () => serviceNotice(etas(), now());
  // Braces, not an arrow body: Solid reads an effect's return value as its
  // cleanup, and a store setter returns the store.
  createEffect(
    () => noticeKey(notice()),
    (key) => {
      props.onNoticeChange(key);
    },
  );
  onCleanup(() => props.onNoticeChange(undefined));
  createEffect(
    () => etas(),
    (list) => {
      props.onEtasChange(list);
    },
  );
  onCleanup(() => props.onEtasChange(undefined));
  const nameParts = () => splitStopName(stripStopCode(pick(props.stop.name, props.lang)));
  /*
   * The vehicle drawn beside this route, wherever the row draws one: creeping
   * up the rail between two stops, or beside a word about the one that is
   * coming. The map picks its marker from the same rule, so a light rail
   * route is a train in both places. A row belongs to one route for its whole
   * life, so this is settled once rather than followed.
   */
  const VehicleIcon = VEHICLE_ICON[vehicleKind(props.route.co)];
  const fare = () => fareAt(props.route.fares, props.seq);
  const concession = () => notableConcession(props.route.fares?.[props.seq - 1]);

  /* Asked only for the open row, which is what makes the camera index load
     lazily: a page of forty closed rows never fetches it at all. */
  const camera = () => (props.open ? nearestCamera(props.stop.location) : null);
  const db = useDb();
  /*
   * Where the next train is going. The line's terminus is on the plate at the
   * top of the page, but a train is not a line: at the end of the day and on
   * a branch it turns short, and a rider bound for 寶琳 wants to know that the
   * one coming is for 康城 before they are on it. Said on the open row, where
   * the rider is reading this station's trains; set in the warning colour
   * when it is not the terminus, because that is the case it exists for.
   */
  const nextDest = createMemo(() => {
    if (!props.open || props.route.co[0] !== "mtr") return null;
    const code = etas()?.find((eta) => eta.dest)?.dest;
    const name = code ? db().stopList[code]?.name : undefined;
    if (!name) return null;
    const terminus = props.route.dest;
    const short = name.zh !== terminus.zh && name.en.toLowerCase() !== terminus.en.toLowerCase();
    return { name, short };
  });
  /*
   * What riding from the boarding station to this one costs. Asked only on
   * the rows where the rider is deciding about this station - open, chosen as
   * the end, or offered as one - because the table is a quarter of a megabyte
   * fetched on the first ask, and forty rows asking at once is one fetch but
   * forty answers appearing together.
   */
  const rideFare = createMemo(() =>
    props.fareFrom && (props.open || props.picking || props.role === "alight")
      ? railFare(props.fareFrom, props.stopId)
      : null,
  );

  return (
    <div
      ref={watchRow}
      data-stop-seq={props.seq}
      class={[
        /*
         * A hairline top and bottom, so a stop is a row of a list rather than
         * a paragraph in a column of them - and an open one is a block with
         * two edges instead of a run of loose lines bleeding into the next
         * stop. Neighbours share their edge (the seam is drawn on top, and
         * the first row leaves it to the card), or every seam would be two
         * lines thick and the list would read as ruled paper.
         */
        "flex flex-col border-t border-border transition-opacity duration-state first:border-t-0",
        {
          "opacity-60": props.passed && !props.open && !props.dimmed,
          // While a ride is being planned the stops outside it are context,
          // not choices - but never so faint that the list stops being a list.
          "opacity-40": props.dimmed && !props.open,
        },
      ]}
    >
      {/* While the page is waiting to be told where the rider gets off, the
          row itself is the answer: hunting for a small square inside a panel
          that has to be opened first is not a question anyone should have to
          be asked twice. */}
      {/*
       * The row is one control with one exception, so the control is a layer
       * rather than a wrapper: a button covering the row, with the row's
       * contents drawn over it and deaf to the pointer. A notice beside the
       * stop's name has to be tappable in its own right, and a button inside a
       * button is neither valid nor reachable - this way the row still opens
       * from anywhere on it, and the one thing that opens something else can.
       */}
      <div class="relative flex w-full items-start px-3.5 py-2 text-left">
        <button
          type="button"
          onClick={() => (props.picking ? props.onAlight() : props.onToggle())}
          aria-expanded={props.picking ? undefined : props.open ? "true" : "false"}
          aria-label={`${props.seq}. ${stripStopCode(pick(props.stop.name, props.lang))}`}
          class="app-tap absolute inset-0"
        />

        {/*
         * The negative margin cancels the row's own padding, so one row's rail
         * meets the next one's instead of stopping short of it.
         *
         * Both segments spring, so the dot sits at the middle of its row. It
         * used to hang from a fixed segment, pinned to the stop's name: back
         * then a row was a name and a countdown, and a row that grew a fare
         * line grew below the dot, leaving the mark riding high in its own
         * row. Every row carries that line now, so the middle is where the
         * stop is, and the rail reads as evenly spaced beads rather than as
         * marks nudged towards the top of each row.
         */}
        <div class="pointer-events-none relative -my-2 mr-2 flex w-3 shrink-0 flex-col items-center self-stretch">
          {/*
           * The rail says what is happening between two stops. The ride
           * being planned paints it the accent colour; a stretch the operator
           * has flagged - a diversion, a road blocked - paints it the warning
           * colour, so eleven stops under one notice read as one block on the
           * line rather than eleven badges saying the same words. The ride
           * wins where both apply: it is the thing the rider chose.
           */}
          <div
            class={[
              "w-0.5 grow transition-colors duration-state",
              {
                "bg-transparent": props.seq === 1,
                // The rail above a stop belongs to the ride only once it has
                // been boarded, so the boarding stop's own approach stays grey.
                "bg-primary": props.seq !== 1 && primaryAbove(),
                "bg-warning": props.seq !== 1 && !primaryAbove() && props.noticeAbove,
                "bg-border": props.seq !== 1 && !primaryAbove() && !props.noticeAbove,
              },
            ]}
          />
          {/* Marking where you are with a halo rather than a filled row: the
              band grew with the row and swamped an expanded stop, while this
              stays the same size and reads like a map pin. */}
          <div
            class={[
              "shrink-0 rounded-full transition-colors duration-state",
              {
                // The halo is what makes the stop you are standing at the
                // loudest mark on the rail, so the dot inside it does not
                // have to be the biggest one as well.
                "size-2.5 bg-primary": props.isNearest,
                "size-3 bg-primary":
                  !props.isNearest && (props.role === "board" || props.role === "alight"),
                "size-2 bg-primary": !props.isNearest && props.role === "riding",
                "size-2 border-2 bg-background": !props.isNearest && props.role === null,
                // A flagged stop's own marker joins the flagged stretch, so the
                // first stop of a run - whose approach is still grey - is
                // marked too.
                "border-warning": !props.isNearest && props.role === null && notice() !== undefined,
                "border-faint-foreground":
                  !props.isNearest && props.role === null && notice() === undefined,
              },
            ]}
            style={
              props.isNearest
                ? {
                    "box-shadow":
                      "0 0 0 2.5px var(--card), 0 0 0 5.5px color-mix(in srgb, var(--primary) 22%, transparent)",
                  }
                : undefined
            }
          />
          <div
            class={[
              "relative w-0.5 grow transition-colors duration-state",
              {
                "bg-transparent": props.seq >= props.total,
                "bg-primary": props.seq < props.total && primaryBelow(),
                "bg-warning": props.seq < props.total && !primaryBelow() && props.noticeBelow,
                "bg-border": props.seq < props.total && !primaryBelow() && !props.noticeBelow,
              },
            ]}
          >
            {/*
             * The buses on their way to the next stop, on the line between the
             * two. A countdown that jumps from fourteen minutes at one stop to
             * one at the next looks like a mistake until the bus sitting
             * between them is drawn; this is that bus. It sits at its share
             * of the way there, and the position glides with the clock the
             * way the countdown ticks - one movement, one meaning.
             *
             * The gap between two dots is two half-rows: this one below its
             * dot, the next one above its own. Only the first is a box CSS
             * can measure here, so the fraction is read against twice it -
             * exact while rows are the height they now all share, and a hair
             * out on the one that is open, which is the row the bus is least
             * likely to be short of.
             *
             * An opened row stretches its line, and the bus keeps its share
             * of it: the line is the road between the two stops however tall
             * the card, and a bus a minute from the next stop pinned near the
             * top of an open card read as a different fact from the same bus
             * hugging the dot once the card closed.
             */}
            <For each={props.buses}>
              {(bus) => (
                <span
                  aria-hidden="true"
                  data-rail-bus={bus.id}
                  class="absolute left-1/2 flex size-4 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-primary text-primary-foreground transition-[top] duration-1000 ease-linear motion-reduce:transition-none"
                  style={{
                    top: `${bus.fraction * 200}%`,
                    "box-shadow": "0 0 0 2px var(--card)",
                  }}
                >
                  <VehicleIcon size={10} />
                </span>
              )}
            </For>
          </div>
        </div>

        <div class="pointer-events-none relative flex min-w-0 grow flex-col gap-0.5">
          {/* Everything on this line hangs off the name's first baseline, not
              off the middle of however many lines the name runs to. A long
              name wraps - "九龍城轉車站- 富豪東方酒店" takes two - and centred,
              the number and the code slid down into the gap beside the second
              line, reading as marks on the wrong row. */}
          <div class="flex min-w-0 items-baseline gap-1.5">
            {/*
             * The stop's place in the route, as a prefix on the name - where
             * the eye already is, and set as close to it as the two words of
             * one phrase.
             *
             * No column reserved for the longest number on the route: held
             * open, the numbers under ten either began with a digit of blank
             * or left one between themselves and the name, and both read as
             * the row starting late. The names stepping right by a digit at
             * stop ten is the smaller cost, and the rail beside them is
             * already the straight edge the eye follows down the page.
             */}
            <span
              class={[
                "tnum shrink-0 text-[0.85rem] font-semibold tracking-[-0.01em]",
                { "text-primary": props.isNearest, "text-faint-foreground": !props.isNearest },
              ]}
            >
              {props.seq}.
            </span>

            {/*
             * The name may run to two lines, because the end of it is the
             * part that matters: "牛頭角道, 近牛頭角下邨貴..." lost the one
             * word that told this stop from the next. And the operator's
             * "street, landmark" form repeats the street down a whole run of
             * stops, so the street is set quieter and the landmark carries
             * the weight - the part that changes is the part that is bold.
             */}
            <span
              class={[
                "line-clamp-2 min-w-0 break-words text-[0.85rem] tracking-[-0.01em]",
                {
                  // Where you are standing takes the accent, name and number
                  // both: the pin and the halo mark the row, and the name is
                  // what the eye lands on once the row is found.
                  "font-bold text-primary": props.isNearest,
                  "font-bold text-foreground": !props.isNearest && !props.passed,
                  "font-semibold text-subtle-foreground": !props.isNearest && props.passed,
                },
              ]}
            >
              <Show when={nameParts().head} fallback={nameParts().tail}>
                <span class="font-semibold text-subtle-foreground">{nameParts().head}, </span>
                {nameParts().tail}
              </Show>
            </span>

            {/*
             * What the operator says is wrong here, beside the name it is
             * wrong about. It was a truncated grey pill in the countdown
             * column - a warning nobody could read and nobody could open;
             * here it keeps the operator's words, wears the app's warning
             * colour, and opens in full on a tap.
             */}
            {/*
             * Said in words once, at the first stop of the run. Down the rest
             * of it the amber rail carries the meaning and the chip shrinks to
             * its mark - still there, still opens the notice in full, so a
             * rider who scrolled straight to stop twenty is not left reading
             * a colour with no words behind it.
             */}
            <Show when={notice()}>
              {(text) => (
                <button
                  type="button"
                  onClick={() => props.onNotice(text())}
                  aria-label={`${t("serviceNotice", props.lang)}: ${pick(text(), props.lang)}`}
                  data-notice={props.noticeAbove ? "continued" : "start"}
                  class={[
                    "app-press pointer-events-auto flex shrink-0 items-center gap-1 rounded-full bg-warning/12 py-px text-[0.69rem] font-bold leading-[1.4] text-warning",
                    props.noticeAbove ? "px-1" : "max-w-[40%] px-1.5",
                  ]}
                >
                  {/* The mark survives the truncation the words may not. */}
                  <MegaphoneIcon size={10} />
                  <Show when={!props.noticeAbove}>
                    <span class="truncate">{pick(text(), props.lang)}</span>
                  </Show>
                </button>
              )}
            </Show>

            {/* Which end of the ride this is, in words. A filled dot on the
                rail is a mark; only the word says what the mark means. */}
            <Show when={props.role === "board" || props.role === "alight"}>
              <span class="app-pop shrink-0 rounded-md bg-primary px-1.5 py-0.5 text-[0.69rem] font-bold text-primary-foreground">
                {props.role === "board"
                  ? t("boardLabel", props.lang)
                  : t("alightLabel", props.lang)}
              </span>
            </Show>

            {/* Where the rider is standing is said by the halo on the rail and
                by the number going the accent colour - a pin beside the name
                as well was the third copy of it, and the one taking room from
                the name itself. It is still said for a screen reader. */}
            <Show when={props.isNearest}>
              <span class="sr-only">{t("youAreHere", props.lang)}</span>
            </Show>

            {/* An armed reminder is a promise the app made; it says so on the
                row rather than only inside the sheet that set it. */}
            <Show when={alerted()}>
              <span class="shrink-0 text-primary" title={t("alertOn", props.lang)}>
                <AlarmIcon size={13} />
                <span class="sr-only">{t("alertOn", props.lang)}</span>
              </span>
            </Show>
          </div>

          {/* Rail carries no per-stop fare in this dataset, and an open row
              was printing the empty value as "車費 null". */}
          {/* The amounts wear a tag, so the two numbers on the line are the
              two things on it that can be read at a glance; the words that
              name them are the quieter half. */}
          {/* On every row that has one. A section fare repeats down a run of
              stops, but what a ride costs is half of what a rider is deciding
              between two stops with, and making them open a row to see it put
              the price behind a tap while the time sat in the open. */}
          <Show when={fare() !== null}>
            {/* Set off from the name rather than tucked under it: the tags
                give the line a shape of its own, and at the list's own
                line-spacing it read as a second line of the stop's name. */}
            <span class="mt-2 flex min-w-0 items-center gap-1 text-[0.64rem] font-semibold text-subtle-foreground">
              <span class="shrink-0">{t("fareFull", props.lang)}</span>
              <FareTag>{fare()}</FareTag>
              <Show when={concession()}>
                {(amount) => (
                  <>
                    <span class="shrink-0">·</span>
                    <span class="truncate">{t("fareOctopus", props.lang)}</span>
                    <FareTag>{amount()}</FareTag>
                  </>
                )}
              </Show>
            </span>
          </Show>

          {/*
           * Where a rider can change lines, as the colours they know the lines
           * by - the way the network map and the line screen say it. On every
           * row rather than only the open one: an interchange is the fact
           * about a station a rider scans a line for, and it is what tells
           * 旺角 from 太子 when both are two minutes away.
           */}
          {/* The open row has the room and the attention to say the line's
              name; down the list the code carries it in the space the name
              column can spare. */}
          <Show when={props.interchanges.length > 0}>
            <span
              data-rail-interchange
              class="mt-1.5 flex min-w-0 flex-wrap items-center gap-1 text-[0.64rem] font-semibold text-subtle-foreground"
            >
              <span class="shrink-0">{t("changeHere", props.lang)}</span>
              <For each={props.interchanges}>
                {(code) => (
                  <span
                    class="flex h-[1.05rem] shrink-0 items-center rounded px-1 text-[0.69rem] font-extrabold tracking-[0.01em]"
                    style={{
                      background: plateStyle(["mtr"], code).background,
                      color: plateStyle(["mtr"], code).color,
                    }}
                  >
                    {props.open ? pick(lineName(code), props.lang) : code}
                  </span>
                )}
              </For>
            </span>
          </Show>

          <Show when={nextDest()}>
            {(next) => (
              <span
                data-rail-next-dest={next().short ? "short" : "terminus"}
                class={[
                  "mt-1.5 flex min-w-0 items-center gap-1 text-[0.64rem] font-semibold",
                  next().short ? "text-warning" : "text-subtle-foreground",
                ]}
              >
                <VehicleIcon size={11} />
                <span class="truncate">
                  {t("towards", props.lang)} {stripStopCode(pick(next().name, props.lang))}
                </span>
              </span>
            )}
          </Show>

          {/* The rail fare, in the same shape as the bus one above - two
              amounts wearing tags - but priced from the station the rider
              boards at, because that is the only way a rail fare exists. */}
          <Show when={rideFare()}>
            {(f) => (
              <span
                data-rail-stop-fare
                class="mt-2 flex min-w-0 items-center gap-1 text-[0.64rem] font-semibold text-subtle-foreground"
              >
                <Show when={f().octopus}>
                  {(amount) => (
                    <>
                      <span class="shrink-0">{t("fareOctopusAdult", props.lang)}</span>
                      <FareTag>{amount()}</FareTag>
                    </>
                  )}
                </Show>
                <Show when={f().single}>
                  {(amount) => (
                    <>
                      <Show when={f().octopus}>
                        <span class="shrink-0">·</span>
                      </Show>
                      <span class="truncate">{t("fareSingleTicket", props.lang)}</span>
                      <FareTag>{amount()}</FareTag>
                    </>
                  )}
                </Show>
              </span>
            )}
          </Show>
        </div>

        {/*
         * The next bus, on every row. The two after it are one tap away.
         *
         * The wait has to look like a wait: an empty countdown reads as
         * "no service", which at a stop with plenty of buses is a lie.
         *
         * Except while the rider is choosing where they get off: they are on
         * the bus, so when the next one reaches a stop down the line answers
         * nothing, and the space is better spent saying what a tap will do.
         */}
        <Show
          when={props.picking}
          fallback={
            /* No chevron beside the countdown: forty of them down the page
               were forty marks saying the same thing about a row that already
               opens from anywhere on it, and each one took its width from the
               stop's name. The row still reports its state to a screen reader
               through `aria-expanded` on the button covering it. */
            <div class="pointer-events-none relative flex shrink-0 items-start">
              {/* One size smaller down the list than in the open row: the
                  list is for scanning forty of these, and the stop a rider
                  opened is the one whose number they are reading. */}
              {/* The clock time on every row, not only the open one. "32
                  分鐘" is a number to add to a watch; 10:39 is either before
                  or after where the rider has to be, and asking them to open
                  a row for it made the countdown the only answer they could
                  scan. */}
              <EtaCountdown
                etas={shown()}
                lang={props.lang}
                size={props.open ? "md" : "sm"}
                limit={1}
                clock
                over={props.dayOver}
                /* Said in full beside the name, a tap away; a second copy
                   here would be the same sentence cut to six characters. */
                notices={false}
                /* Rows tick on the same second; this runs the roll down the
                   list a frame apart per row, cycling every screenful. */
                stagger={(props.seq % 10) * 28}
              />
            </div>
          }
        >
          {/* They arrive in the order the bus meets them, a frame apart, so
              the offer reads as running down the route rather than as forty
              rows all changing at once. Capped, or the far end of a long route
              would still be arriving after the rider has chosen. */}
          <span
            class="app-pop pointer-events-none relative flex h-8 shrink-0 items-center gap-1.5 self-center rounded-lg bg-primary-muted px-2.5 text-[0.81rem] font-bold text-primary"
            style={{ "animation-delay": `${Math.min(props.pickOrder * 22, 220)}ms` }}
          >
            <FlagIcon size={13} />
            {t("alightLabel", props.lang)}
          </span>
        </Show>
      </div>

      <Reveal open={props.open}>
        {/* The rail carries on behind everything the open row adds, or opening
            a stop cuts the route in half. It spans the whole panel rather than
            the actions alone, which left the line stopping short above the
            board button and picking up again at the next stop. */}
        <div class="relative">
          <Show when={props.seq < props.total}>
            <span
              aria-hidden="true"
              class={[
                "absolute inset-y-0 left-[1.1875rem] w-0.5",
                {
                  "bg-primary": primaryBelow(),
                  "bg-warning": !primaryBelow() && props.noticeBelow,
                  "bg-border": !primaryBelow() && !props.noticeBelow,
                },
              ]}
            />
          </Show>

          {/*
           * Where the bus actually is, in the one unit that needs no map: a
           * rider at a kerb can count stops, and "two stops away" is the
           * answer they would get from looking up the road if the road were
           * straight. The countdown says when; this says where, and the two
           * disagreeing is itself worth seeing - a bus three stops away with
           * one minute on the clock is a bus stuck in traffic.
           *
           * Inferred rather than reported, so it is off until a rider turns it
           * on in settings - see `settings.showVehicles`.
           */}
          <Show when={props.busAway !== null}>
            {/* No pop on the way in: the count changes as the bus moves, and
                a line that flinches every time it is re-stated draws the eye
                back to a number that has barely changed. */}
            {/* In the row's own grey, not the accent: the accent is for where
                the rider is, and a bus three stops out is a fact about the
                road, not a thing to be drawn to. */}
            <div class="flex items-center gap-1.5 px-3.5 pb-1.5 pl-[2.125rem] text-[0.75rem] font-semibold text-muted-foreground">
              <VehicleIcon size={12} />
              <span>{awayLabel(props.busAway as number, props.lang)}</span>
            </div>
          </Show>

          {/* The later departures, on their own line now that the actions have
              moved down to sit with the button they belong beside. */}
          <LaterArrivals class="px-3.5 pb-2 pl-[2.125rem]" etas={etas() ?? []} lang={props.lang} />

          {/*
           * One row of everything there is to do with this stop, gathered at
           * the end of the row where the thumb already is.
           *
           * The flag is where you get on and where you get off: a rider does
           * not ride a route, they ride a piece of one, and every number that
           * matters - how long, how much, what time you are there - depends on
           * which piece. It led the row wearing its question in words, and a
           * label that changes with what is set - board here, get off here -
           * kept resizing the one control a thumb was aiming at. It is a
           * square like the rest now, at the same end, and its question lives
           * where every other control's does: in the name a screen reader
           * speaks and the tooltip a pointer gets.
           *
           * Nothing here is filled. Five containers under the arrivals made
           * the open panel a wall of boxes, and the last of them - a pill
           * around the flag - was the loudest thing on a row whose point is
           * the numbers above it. What the fills were carrying was state, and
           * state is carried here the way the row above carries it: a set
           * boarding point, an armed alarm and a made bookmark go the app's
           * own accent colour, the same colour they take beside the stop's
           * name, and everything unset stays grey.
           */}
          <div class="flex items-center justify-end gap-0.5 pb-3 pl-[2.125rem] pr-1.5">
            {/*
             * The code on the pole, at the quiet end of the panel a rider has
             * opened rather than beside the name.
             *
             * It tells two stops of the same name apart, which is a real job -
             * but one almost nobody is doing: a rider reads the name, and the
             * code was a grey tag on every one of forty rows, taking width
             * from the name it followed and pushing a long one onto a second
             * line. Down here it costs nothing and is still one tap away for
             * the rider matching a pole to a screen.
             */}
            <StopCode name={props.stop.name} lang={props.lang} class="mr-auto" />

            <button
              type="button"
              onClick={props.canAlight ? props.onAlight : props.onBoard}
              aria-label={boardLabel()}
              title={boardLabel()}
              aria-pressed={props.role === "board" || props.role === "alight" ? "true" : "false"}
              class={[
                "app-bare app-press flex size-8 items-center justify-center rounded-lg transition-colors duration-state hover:bg-secondary",
                {
                  "text-primary": props.role === "board" || props.role === "alight",
                  "text-subtle-foreground hover:text-foreground":
                    props.role !== "board" && props.role !== "alight",
                },
              ]}
            >
              <FlagIcon size={16} />
            </button>

            <button
              type="button"
              aria-label="pin"
              title={t("pinned", props.lang)}
              aria-pressed={pinned() ? "true" : "false"}
              onClick={() => {
                /*
                 * Dropping a bookmark is immediate; making one is a question -
                 * which list it joins is part of making it, not an errand to
                 * run later on another screen. Nothing is saved until that
                 * sheet is confirmed, so backing out of it leaves the
                 * bookmark list exactly as it was.
                 */
                if (pinned()) {
                  saved.remove(savedId(props.route.key, props.stopId));
                  return;
                }
                props.onGroup({
                  routeKey: props.route.key,
                  co: props.route.co[0] ?? "kmb",
                  stopId: props.stopId,
                  seq: props.seq,
                });
              }}
              class={[
                "app-bare app-press flex size-8 items-center justify-center rounded-lg transition-colors duration-state hover:bg-secondary",
                {
                  "text-primary": pinned(),
                  "text-subtle-foreground hover:text-foreground": !pinned(),
                },
              ]}
            >
              <BookmarkIcon size={16} />
            </button>

            {/* Waiting for it, or riding on it: both questions are asked from
                the stop you care about, so both are answered from here. */}
            <button
              type="button"
              aria-label={t("remindMe", props.lang)}
              title={t("remindMe", props.lang)}
              aria-pressed={alerted() ? "true" : "false"}
              onClick={props.onAlert}
              class={[
                "app-bare app-press flex size-8 items-center justify-center rounded-lg transition-colors duration-state hover:bg-secondary",
                {
                  "text-primary": alerted(),
                  "text-subtle-foreground hover:text-foreground": !alerted(),
                },
              ]}
            >
              <AlarmIcon size={16} />
            </button>

            <button
              type="button"
              aria-label={t("share", props.lang)}
              title={t("share", props.lang)}
              onClick={props.onShare}
              class="app-press flex size-8 items-center justify-center rounded-lg text-subtle-foreground transition-colors duration-state hover:bg-secondary hover:text-foreground"
            >
              <ShareIcon size={16} />
            </button>

            {/* Only where the department has a camera within sight of the
                kerb: a button that opens somebody else's junction would teach
                riders not to press it. */}
            <Show when={camera()}>
              {(near) => (
                <button
                  type="button"
                  aria-label={t("trafficCamera", props.lang)}
                  title={t("trafficCamera", props.lang)}
                  onClick={() => props.onCamera(near())}
                  class="app-press flex size-8 items-center justify-center rounded-lg text-subtle-foreground transition-colors duration-state hover:bg-secondary hover:text-foreground"
                >
                  <CameraIcon size={16} />
                </button>
              )}
            </Show>

            <a
              {...useLinkProps(stopLink(props.stopId))}
              aria-label={t("openStop", props.lang)}
              title={t("openStop", props.lang)}
              class="app-press flex size-8 items-center justify-center rounded-lg text-subtle-foreground transition-colors duration-state hover:bg-secondary hover:text-foreground"
            >
              {/* Not a chevron: the other three icons do something to this
                  stop, and this one is what else there is to know about it. */}
              <InfoIcon size={16} />
            </a>
          </div>
        </div>
      </Reveal>
    </div>
  );
}

export default function RouteDetail() {
  const db = useDb();
  const router = useRouter();
  const params = useParams({ from: "/route/$key" });
  /** `?stop=19` - a shared link naming the stop the sender was standing at. */
  const search = useSearch({ from: "/route/$key" });
  const navigate = useNavigate();

  /*
   * The opened-out map is a place the rider is in, so it lives in the URL:
   * opening it out is a step the back button undoes, and a reload or a shared
   * link lands in it. Putting it back replaces rather than pushes, so leaving
   * is one step and not two.
   */
  const setMapOpen = (open: boolean) =>
    navigate({
      to: "/route/$key",
      params: { key: params().key },
      search: (prev) => ({ ...prev, map: open ? true : undefined }),
      replace: !open,
    });
  const lang = settings.lang;
  const { position } = useGeolocation();

  const route = createMemo(() => routeAt(db(), params().key));
  /*
   * When the route's day ends. Read through the clock so the warning arrives on
   * its own: a rider who opened the page at half past ten should not have to
   * reload it to be told the last bus is now twenty minutes away.
   */
  const span = createMemo(() => {
    now();
    const r = route();
    return r ? serviceSpan(db(), r) : null;
  });

  const stops = createMemo(() => {
    const r = route();
    return r ? routeStops(db(), r) : [];
  });
  const reverse = createMemo(() => {
    const r = route();
    return r ? reverseRoute(db(), r) : undefined;
  });

  /*
   * The stop the rider picked, told apart from the stop they are standing
   * near. The two used to share one slot, which dressed the app's guess up
   * as the rider's choice: the map ringed the nearest stop as if it had been
   * tapped, and the URL could not say whether anyone had chosen anything.
   * Only a pick is ever the map's ring or the URL's `stop`; "closed" is a
   * pick too - the rider shutting the row the app opened for them.
   */
  const [pickedSeq, setPickedSeq] = createSignal<number | "closed" | null>(null);
  /** The open row: the rider's pick, or failing that the stop they stand at. */
  const openSeq = (): number | null => {
    const picked = pickedSeq();
    if (picked === "closed") return null;
    if (picked !== null) return picked;
    return nearestIndex() >= 0 ? nearestIndex() + 1 : null;
  };
  /*
   * A pick, made anywhere - a row, the map, a link - lands in the URL, so a
   * reload keeps it and it can be sent to someone. Replaced, not pushed:
   * reading down a route stop by stop should not wind up a page of history
   * per stop on the way back out.
   */
  const pickStop = (seq: number | "closed" | null) => {
    setPickedSeq(seq);
    void navigate({
      to: "/route/$key",
      params: { key: params().key },
      search: (prev) => ({ ...prev, stop: typeof seq === "number" ? seq : undefined }),
      replace: true,
    });
  };
  /*
   * The timetable is a dialog over the whole of a phone's screen, so it lives
   * in the URL the way the opened-out map does: back closes it, a reload comes
   * back to it, and a link to "the 606 timetable" is a link.
   */
  const showInfo = () => search().info === true;
  const setShowInfo = (open: boolean) =>
    navigate({
      to: "/route/$key",
      params: { key: params().key },
      search: (prev) => ({ ...prev, info: open ? true : undefined }),
      replace: !open,
    });
  /*
   * One sheet for the whole page rather than one per row: a forty-stop route
   * would otherwise carry forty mounted dialogs. The target is set a frame
   * before the sheet opens so the sheet has a closed state to rise from.
   */
  const [alertStop, setAlertStop] = createSignal<{ seq: number; id: string; name: string } | null>(
    null,
  );
  const [alertOpen, setAlertOpen] = createSignal(false);

  /* The camera outlives its row the way the alert sheet does: the sheet is
     the page's, so closing the row underneath does not tear it down. */
  const [cameraNear, setCameraNear] = createSignal<NearbyCamera | null>(null);
  const [cameraOpen, setCameraOpen] = createSignal(false);
  /**
   * The operator notice a row asked to have opened, and the stop it is about.
   * It outlives its own dialog, like the alert sheet above: a target cleared on
   * close takes the sheet's contents with it before it has finished closing.
   */
  const [notice, setNotice] = createSignal<{ name: string; text: Bilingual } | null>(null);
  const [noticeOpen, setNoticeOpen] = createSignal(false);

  const showNotice = (name: string, text: Bilingual) => {
    setNotice({ name, text });
    requestAnimationFrame(() => setNoticeOpen(true));
  };
  /** A bookmark waiting on the one answer it still needs: which group. */
  const [pending, setPending] = createSignal<PendingSave | null>(null);
  const [groupOpen, setGroupOpen] = createSignal(false);

  const askAlert = (seq: number, id: string, name: string) => {
    setAlertStop({ seq, id, name });
    requestAnimationFrame(() => setAlertOpen(true));
  };

  /**
   * A stop on a route, as a link someone else can open.
   *
   * "Where are you?" is answered with a place and a route, so the link carries
   * both - the route page, opened at that stop. The system sheet is used where
   * there is one; on a desktop browser there is not, and a link on the
   * clipboard is the same favour by another route.
   */
  const shareStop = (seq: number, name: string) => {
    const r = route();
    if (!r) return;

    // Built through the router so the share link is spelled exactly the way
    // the app would navigate to it, encoding and all.
    const url = `${window.location.origin}${router.buildLocation(routeLink(r.key, seq)).href}`;
    const title = `${r.route} ${t("towards", lang())} ${pick(r.dest, lang())} · ${name}`;

    if (navigator.share) {
      // A cancelled share is a rider changing their mind, not a failure.
      void navigator.share({ title, url }).catch(() => undefined);
      return;
    }

    void navigator.clipboard
      ?.writeText(url)
      .then(() => toast.show(t("linkCopied", lang()), title))
      .catch(() => undefined);
  };

  /*
   * The piece of the route this rider is actually riding. Held here rather
   * than in the URL: it is a question asked and answered inside one visit,
   * and a link that carried it would claim someone else's journey.
   */
  const [boardSeq, setBoardSeq] = createSignal<number | null>(null);
  const [alightSeq, setAlightSeq] = createSignal<number | null>(null);

  const setBoard = (seq: number) => {
    if (boardSeq() === seq) {
      setBoardSeq(null);
      setAlightSeq(null);
      return;
    }
    setBoardSeq(seq);
    // An alighting stop behind the new boarding one is not a ride.
    if ((alightSeq() ?? Infinity) <= seq) setAlightSeq(null);
  };

  const setAlight = (seq: number) => setAlightSeq((current) => (current === seq ? null : seq));

  const roleOf = (seq: number): "board" | "alight" | "riding" | null => {
    const on = boardSeq();
    const off = alightSeq();
    if (on === seq) return "board";
    if (off === seq) return "alight";
    if (on !== null && off !== null && seq > on && seq < off) return "riding";
    return null;
  };

  /** Waiting to be told the other end of the ride. */
  const picking = () => boardSeq() !== null && alightSeq() === null;

  /**
   * What the band shows, held through its own exit.
   *
   * The band is put down rather than deleted: it stays mounted while it falls
   * back to the edge, and a band that emptied itself the moment the ride was
   * cleared would spend that fall blank. It is also mounted closed for a frame
   * before it opens, or the rise has nothing to rise from.
   */
  type BandView = {
    boardSeq: number;
    boardName: Bilingual;
    ride: ReturnType<typeof ride>;
    alightSeq: number | null;
    alightStopId: string | null;
  };
  const [band, setBand] = createSignal<BandView | null>(null);
  const [bandOpen, setBandOpen] = createSignal(false);

  createEffect(
    (): BandView | null => {
      const on = boardSeq();
      if (on === null) return null;
      const off = alightSeq();
      return {
        boardSeq: on,
        boardName: stops()[on - 1]?.stop.name ?? { zh: "", en: "" },
        ride: ride(),
        alightSeq: off,
        alightStopId: off !== null ? (stops()[off - 1]?.id ?? null) : null,
      };
    },
    (view) => {
      if (!view) {
        setBandOpen(false);
        return;
      }
      setBand(view);
      requestAnimationFrame(() => setBandOpen(true));
    },
  );

  const askGroup = (entry: PendingSave) => {
    setPending(entry);
    requestAnimationFrame(() => setGroupOpen(true));
  };

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

  /** Any bookmark kept on this route, whichever stop it was kept at. */
  const routeSaved = createMemo(() => {
    const key = route()?.key;
    return key !== undefined && saved.items().some((item) => item.routeKey === key);
  });

  /**
   * Star the route. Not a new kind of keeping: it saves the route at the
   * stop you are nearest - its first stop when there is no position - so the
   * Saved screen's groups, live ranking and alerts all apply unchanged.
   * Un-starring removes every bookmark kept on this route.
   */
  const toggleStar = () => {
    const r = route();
    if (!r) return;
    if (routeSaved()) {
      for (const item of saved.items().filter((i) => i.routeKey === r.key)) {
        saved.remove(item.id);
      }
      return;
    }
    const index = nearestIndex() >= 0 ? nearestIndex() : 0;
    const entry = stops()[index];
    if (!entry) return;
    askGroup({ routeKey: r.key, co: r.co[0] ?? "kmb", stopId: entry.id, seq: index + 1 });
  };

  // A different route is a different list; nothing a row said carries over.
  createEffect(
    () => route()?.key,
    () => {
      setNoticeKeys(new Map());
    },
  );

  /**
   * What each row says the operator says about it, by stop. Rows fetch their
   * own arrivals, so the page only learns of a notice once the row carrying
   * it has been on screen; the run grows as the rider scrolls into it.
   */
  const [noticeKeys, setNoticeKeys] = createSignal(new Map<number, string>(), {
    equals: false,
    ownedWrite: true,
  });
  const noteNotice = (seq: number, key: string | undefined) => {
    setNoticeKeys((map) => {
      if (map.get(seq) === key) return map;
      if (key === undefined) map.delete(seq);
      else map.set(seq, key);
      return map;
    });
  };

  /**
   * What each row's poll answered, by stop - every operator merged, which is
   * more than the route feed knows on a joint route. Grown the same way as
   * the notices above: a row reports while it is on screen, and the map's
   * buses reach as far as the rows a rider has actually seen.
   */
  const [rowEtas, setRowEtas] = createSignal(new Map<number, Eta[]>(), {
    equals: false,
    ownedWrite: true,
  });
  const noteEtas = (seq: number, etas: Eta[] | undefined) => {
    setRowEtas((map) => {
      if (etas === undefined) map.delete(seq);
      else map.set(seq, etas);
      return map;
    });
  };
  /**
   * The furthest stop an operator still reports the last run at.
   *
   * The timetable spreads a route's journey time evenly over its stops, which
   * at one in the morning is slower than the road really is: the estimate had
   * the last bus back at stop 23 while the feed was reporting it a minute from
   * stop 30. A live answer is evidence and beats the estimate, so where the
   * operator says the last one is here, every stop behind it is done.
   *
   * Zero when no row has heard of it - the ordinary case, all day long.
   */
  const lastRunSeq = createMemo(() => {
    let furthest = 0;
    for (const [seq, list] of rowEtas()) {
      if (seq <= furthest) continue;
      const live = list.some(
        (eta) => eta.source !== "scheduled" && eta.remark && isLastRun(eta.remark),
      );
      if (live) furthest = seq;
    }
    return furthest;
  });

  /**
   * Whether the day's last bus has already gone past a given stop - the
   * difference between 暫無班次 and 尾班車已過, which are the same silence and
   * different news. The timetable answers it (see `lastRunGone`), and a live
   * sighting of the last run further up the line overrules it.
   *
   * `now()` is read so the row turns over on the clock rather than on a
   * reload: the moment the last one passes is exactly when this changes.
   */
  const dayOver = (seq: number) => {
    now();
    const r = route();
    if (!r) return false;
    return seq < lastRunSeq() || lastRunGone(db(), r);
  };

  /** Whether two neighbouring stops are under the same notice. */
  const sameNotice = (a: number, b: number) => {
    const key = noticeKeys().get(a);
    return key !== undefined && key === noticeKeys().get(b);
  };

  /**
   * How many stops short of `seq` the nearest bus behind it still is.
   *
   * `null` when nothing live is coming - a timetable says a bus will exist,
   * not where it is, so a stop served only by the timetable says nothing here
   * rather than counting stops to an imaginary vehicle.
   */
  const stopsAway = (seq: number): number | null => {
    let best: number | null = null;
    for (const bus of vehicles()?.vehicles ?? []) {
      if (bus.nextSeq > seq) continue;
      const away = seq - bus.nextSeq;
      if (best === null || away < best) best = away;
    }
    return best;
  };

  /**
   * The stop the page is currently about: the one a rider has opened, or the
   * one they are standing at.
   */
  const focusSeq = createMemo(() => {
    const open = openSeq();
    if (open !== null) return open;
    const index = nearestIndex();
    return index >= 0 ? index + 1 : null;
  });

  /*
   * Arrivals for that one stop, and only for the operators that will not
   * describe a whole route in one request. It is the same URL the row itself
   * is already polling, so the shared cache answers it - but a bus is only
   * placed on the map from arrivals we were fetching anyway, never by asking
   * for more.
   */
  const focusEtas = useEta(() => {
    const r = route();
    const seq = focusSeq();
    if (!r || seq === null) return null;
    return { route: r, seq, stopIdByCo: stopIdsFor(r, seq) };
  }, 3);

  /** The open stop, as the sheet under an opened-out map needs it. */

  /**
   * Where the buses are. Nobody publishes that, so it is worked backwards out
   * of the arrival times - see `~/data/vehicles`.
   *
   * Everything drawn from it is opt-in and asked for separately - the map's
   * badges, the glyphs on the rail, the count on an open stop - and they all
   * read this one feed, so wanting none of them stops the work rather than
   * hiding its results. What survives is what the operator actually published,
   * the countdowns; the ride estimate falls back to the timetable's own
   * journey time.
   */
  const vehicles = useVehicles(() => {
    if (!settings.vehiclesOnMap() && !settings.vehiclesOnList() && !settings.vehiclesAway()) {
      return null;
    }
    const r = route();
    const list = stops();
    if (!r || list.length === 0) return null;

    const seq = focusSeq();
    const etas = focusEtas();
    /*
     * The rows' answers, plus the focus stop's own - the one stop the page
     * polls even when its row is off screen, which matters when the rider's
     * stop is the only one anything is known about.
     */
    const atStops = new Map(rowEtas());
    if (seq !== null && etas && etas.length > 0 && !atStops.has(seq)) atStops.set(seq, etas);
    return {
      route: r,
      stops: list.map((entry) => entry.stop.location),
      atStops,
    };
  });

  /**
   * The buses between each stop and the next, and how far along - one map per
   * clock tick rather than a filter per row. Written as row props, so every
   * row's `buses` re-evaluated on every tick; on the many routes with nothing
   * live that was forty fresh empty arrays a second, each waking its row's
   * scope to diff nothing against nothing. Rows without a bus now share one
   * frozen empty array and stay asleep until a bus actually reaches them.
   *
   * Declared after `vehicles`, which it closes over: a memo's first run is
   * not always deferred - created inside a navigation's transition it runs at
   * once - and above the declaration that run was a ReferenceError only a
   * client-side navigation could hit.
   */
  const busesBySeq = createMemo(() => {
    const list = vehicles()?.vehicles;
    if (!list || list.length === 0) return null;
    const at = now();
    const by = new Map<number, RailBus[]>();
    for (const bus of list) {
      const seq = bus.nextSeq - 1;
      const entry = { id: bus.id, fraction: progressOf(bus, at) - seq };
      const bucket = by.get(seq);
      if (bucket) bucket.push(entry);
      else by.set(seq, [entry]);
    }
    return by;
  });
  const NO_BUSES: RailBus[] = [];
  const busesAfter = (seq: number): RailBus[] =>
    (settings.vehiclesOnList() ? busesBySeq()?.get(seq) : undefined) ?? NO_BUSES;

  /** Which lines call at each station, for a rail route; nothing for a bus. */
  const interchangeIndex = createMemo(() => (route()?.co[0] === "mtr" ? stationLines(db()) : null));
  const interchangesAt = (stopId: string): string[] => {
    const r = route();
    const index = interchangeIndex();
    if (!r || !index) return [];
    return (index.get(stopId) ?? [])
      .filter((code) => code !== r.route)
      .sort((a, b) => lineRank(a) - lineRank(b));
  };

  /** The station a rail ride boards at, for a stop down the line from it. */
  const fareFromFor = (seq: number): string | null => {
    const r = route();
    const on = boardSeq();
    if (!r || r.co[0] !== "mtr" || on === null || seq <= on) return null;
    return stops()[on - 1]?.id ?? null;
  };

  /** The ride, once both ends are known: how long, how much, and by when. */
  const ride = createMemo(() => {
    const r = route();
    const on = boardSeq();
    const off = alightSeq();
    if (!r || on === null || off === null || off <= on) return null;

    const list = stops();
    const board = list[on - 1];
    const alight = list[off - 1];
    if (!board || !alight) return null;

    /*
     * How long the ride takes, from the feed where there is one. The published
     * journey time is an average over a year; this is a rider asking how long
     * they will be on the bus that is coming, and the two are not the same
     * number on a wet Friday - see `~/data/pace`.
     */
    const live = vehicles()?.ride;

    return {
      board: board.stop,
      alight: alight.stop,
      minutes: live ? Math.round(live(on, off) / 60) : rideMinutes(r, on, off),
      // The railway prices a pair of stations, not a boarding stop, so its
      // fare comes from its own table - Octopus, which is what the bus fare
      // beside it is too.
      fare:
        r.co[0] === "mtr"
          ? (railFare(board.id, alight.id)?.octopus ?? null)
          : formatFare(fareAt(r.fares, on) ?? undefined),
    };
  });

  /*
   * Open the stop you are standing at and scroll to it, so the page answers the
   * question you came with before you touch anything. Only while the page is
   * still where it opened: once a rider has scrolled, moving the list under
   * them is worse than leaving them to find it.
   *
   * And only until the rider picks a stop themselves. The first position fix
   * can land a second or two after the page does, and scrolling away from the
   * row someone has just tapped is the worst possible moment to be helpful.
   * The row itself opens on its own - the open row is derived from the pick
   * and the position - so all that is left to do here is the scroll.
   */
  let jumped = false;
  /* The list's own scroller: the page is held to the window, so this is the
     only thing a rider can have scrolled. */
  let listPane!: HTMLDivElement;

  createEffect(
    () => nearestIndex(),
    (index) => {
      if (index < 0 || pickedSeq() !== null) return;
      if (jumped || (listPane?.scrollTop ?? 0) > 24) return;
      jumped = true;
      requestAnimationFrame(() => {
        const row = document.querySelector(`[data-stop-seq="${index + 1}"]`);
        if (row) centerWhileItSettles(row);
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
    pickStop(seq);
    requestAnimationFrame(() => {
      const row = document.querySelector(`[data-stop-seq="${seq}"]`);
      if (row) centerWhileItSettles(row);
    });
  };

  /*
   * A link that names a stop was sent by someone who meant that stop, so it
   * beats the one the rider happens to be standing near.
   */
  createEffect(
    () => search().stop ?? Number.NaN,
    (seq) => {
      if (!Number.isInteger(seq) || seq < 1 || seq > stops().length) return;
      // The screen's own write comes back through here; nothing new to do.
      if (seq === pickedSeq()) return;
      openStop(seq);
    },
  );

  /**
   * The rows, as a component rather than inline: the list is drawn in the card
   * on the page and again in the sheet over an opened-out map, and the second
   * copy is built only while that map is open.
   */
  const StopList = () => (
    <Show when={route()}>
      {(r) => (
        <>
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
                  busAway={settings.vehiclesAway() && openSeq() === seq() ? stopsAway(seq()) : null}
                  onNoticeChange={(key) => noteNotice(seq(), key)}
                  onEtasChange={(list) => noteEtas(seq(), list)}
                  noticeAbove={sameNotice(seq() - 1, seq())}
                  noticeBelow={sameNotice(seq(), seq() + 1)}
                  buses={busesAfter(seq())}
                  interchanges={interchangesAt(entry.id)}
                  fareFrom={fareFromFor(seq())}
                  total={stops().length}
                  open={openSeq() === seq()}
                  onToggle={() => pickStop(openSeq() === seq() ? "closed" : seq())}
                  onAlert={() =>
                    askAlert(seq(), entry.id, stripStopCode(pick(entry.stop.name, lang())))
                  }
                  onGroup={askGroup}
                  onShare={() => shareStop(seq(), stripStopCode(pick(entry.stop.name, lang())))}
                  onCamera={(near) => {
                    setCameraNear(near);
                    setCameraOpen(true);
                  }}
                  onNotice={(text) =>
                    showNotice(stripStopCode(pick(entry.stop.name, lang())), text)
                  }
                  role={roleOf(seq())}
                  onBoard={() => setBoard(seq())}
                  onAlight={() => setAlight(seq())}
                  canAlight={boardSeq() !== null && seq() > (boardSeq() as number)}
                  picking={picking() && seq() > (boardSeq() as number)}
                  pickOrder={seq() - (boardSeq() ?? 0) - 1}
                  /* While the question is open, the stops behind the bus
                 cannot answer it - they are context, not choices. */
                  dimmed={
                    (ride() !== null && roleOf(seq()) === null) ||
                    (picking() && seq() < (boardSeq() as number))
                  }
                  dayOver={dayOver(seq())}
                />
              );
            }}
          </For>
        </>
      )}
    </Show>
  );

  return (
    <Show when={route()} fallback={<NotFound kind="route" />}>
      {(r) => (
        <SplitPage
          mainFills
          /* The map is the half worth widening: the stop list is a trail that
             reads down, and every pixel added to a stop row only pushes its
             arrival further from its name. */
          wideAside
          aside={
            <>
              <header class="flex items-center gap-3 lg:-mb-2">
                {/* The plate and the destination are what the page is, not a
                    control: making the whole row a button meant every stray tap
                    near the title opened a timetable nobody asked for. The two
                    things you can actually do sit at the end, as buttons. */}
                <RoutePlate route={r().route} co={r().co} size="md" />

                <div class="flex min-w-0 grow flex-col gap-0.5">
                  <span class="flex min-w-0 items-center gap-1.5">
                    <span class="truncate text-[1rem] font-bold tracking-[-0.02em] text-foreground">
                      {t("towards", lang())} {pick(r().dest, lang())}
                    </span>
                    {/* The tag a special row wears in a list, kept on when the
                        row is opened - or the page it lands on looks like the
                        main service it is not. */}
                    <Show when={isSpecialService(r())}>
                      <SpecialTag lang={lang()} />
                    </Show>
                  </span>
                  <span class="truncate text-[0.75rem] font-medium text-subtle-foreground">
                    {operatorLabel(r().co, lang())} · {pick(r().orig, lang())}
                  </span>
                </div>

                {/*
                 * A chevron at the end of a header says "onward" and nothing
                 * else. A clock says the one thing the route itself can tell
                 * you: when it runs. Spelling that out took a third of the row
                 * away from the destination, which is what a rider actually
                 * reads here, so the icon carries it and the label is the
                 * button's name.
                 */}
                <button
                  type="button"
                  onClick={() => setShowInfo(!showInfo())}
                  /* Not `aria-expanded`: the timetable opens as a dialog over
                     the page, not as a section of the header - and the stop
                     rows below are the things that expand. */
                  aria-haspopup="dialog"
                  aria-label={t("routeInfo", lang())}
                  title={t("timetable", lang())}
                  class="app-press flex size-8 shrink-0 items-center justify-center rounded-full bg-secondary text-muted-foreground"
                >
                  <AlarmIcon size={16} />
                </button>

                {/* The route, kept: one tap from the place its name is. */}
                <button
                  type="button"
                  onClick={toggleStar}
                  aria-label={t(routeSaved() ? "bookmarked" : "addBookmark", lang())}
                  title={t(routeSaved() ? "bookmarked" : "addBookmark", lang())}
                  class={[
                    "app-press flex size-8 shrink-0 items-center justify-center rounded-full bg-secondary",
                    routeSaved() ? "text-primary" : "text-muted-foreground",
                  ]}
                >
                  <Show when={routeSaved()} fallback={<StarIcon size={15} />}>
                    <StarFillIcon size={15} />
                  </Show>
                </button>

                {/* The other direction is a property of the route, so it sits
                    with the route's own name rather than under the map - where
                    it was one scroll away from the thing it answers. */}
                <Show when={reverse()}>
                  {(other) => (
                    <a
                      {...useLinkProps(routeLink(other().key))}
                      aria-label={t("reverse", lang())}
                      title={t("reverse", lang())}
                      class="app-press flex size-8 shrink-0 items-center justify-center rounded-full bg-secondary text-muted-foreground"
                    >
                      <ExchangeIcon size={15} />
                    </a>
                  )}
                </Show>
              </header>

              <Modal
                open={showInfo()}
                onClose={() => setShowInfo(false)}
                title={`${r().route} · ${t("timetable", lang())}`}
                lang={lang()}
              >
                {/* The figures that sat under the map: the span, and what
                    the ride costs and takes. Opening the timetable is asking
                    "when does it run" - this is the rest of that answer. */}
                <div class="mb-3 flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
                  <Show when={span()}>
                    {(hours) => (
                      <span class="tnum text-[0.81rem] font-bold text-foreground">
                        {t("firstBus", lang())} {hours().first} · {t("lastBus", lang())}{" "}
                        {hours().last}
                      </span>
                    )}
                  </Show>
                  <span class="tnum ml-auto flex shrink-0 items-baseline gap-1.5 text-[0.81rem] font-bold text-foreground">
                    {[formatFare(r().fares?.[0]), `${stops().length} ${t("stops", lang())}`]
                      .filter(Boolean)
                      .join(" · ")}
                    <Show when={r().jt}>
                      <span class="text-[0.75rem] font-medium text-subtle-foreground">
                        {t("aboutMinutes", lang())} {r().jt} {t("minute", lang())}
                      </span>
                    </Show>
                  </span>
                </div>
                <Timetable db={db()} route={r()} lang={lang()} />
              </Modal>

              {/*
               * The operator's notice, in full and in both languages. It comes
               * off a feed as one long line - "受阻於牛池灣，改行清水灣道" -
               * and a row has no width for that, but a rider deciding whether
               * to wait needs all of it, not the first six characters.
               */}
              <Show when={notice()}>
                {(open) => (
                  <Modal
                    open={noticeOpen()}
                    onClose={() => setNoticeOpen(false)}
                    title={t("serviceNotice", lang())}
                    lang={lang()}
                  >
                    <div class="flex flex-col gap-2">
                      <span class="text-[0.75rem] font-bold uppercase tracking-[0.06em] text-faint-foreground">
                        {open().name}
                      </span>
                      <p class="text-[0.94rem] font-semibold leading-relaxed text-foreground">
                        {pick(open().text, lang())}
                      </p>
                      {/* The other language too: operators write these by hand,
                          and one side of the pair is often the fuller one. */}
                      <Show when={otherLanguage(open().text, lang())}>
                        {(line) => (
                          <p class="text-[0.81rem] font-medium leading-relaxed text-subtle-foreground">
                            {line()}
                          </p>
                        )}
                      </Show>
                      <span class="text-[0.75rem] font-medium text-faint-foreground">
                        {t("noticeFromOperator", lang())}
                      </span>
                    </div>
                  </Modal>
                )}
              </Show>

              <Show when={alertStop()}>
                {(target) => (
                  <AlertSheet
                    open={alertOpen()}
                    onClose={() => setAlertOpen(false)}
                    route={r()}
                    seq={target().seq}
                    stopId={target().id}
                    stopName={target().name}
                    lang={lang()}
                  />
                )}
              </Show>

              <Show when={cameraNear()}>
                {(near) => (
                  <CameraSheet
                    open={cameraOpen()}
                    onClose={() => setCameraOpen(false)}
                    near={near()}
                    lang={lang()}
                  />
                )}
              </Show>

              <Show when={pending()}>
                {(entry) => (
                  <GroupSheet
                    open={groupOpen()}
                    onClose={() => setGroupOpen(false)}
                    groups={saved.groups()}
                    current=""
                    confirmLabel={t("addBookmark", lang())}
                    onChoose={(group) => saved.toggle({ ...entry(), group })}
                    lang={lang()}
                  />
                )}
              </Show>

              {/* On a wide screen the card takes whatever the column has left
                  below the header, and the map takes whatever the card has
                  left above its figures: a map is worth exactly as much as
                  you can see of it, and a fixed 30rem left the bottom third
                  of a tall window empty. The floor is for short windows,
                  where the column scrolls rather than squashing the map. */}
              <Card class="flex flex-col lg:min-h-[24rem] lg:flex-1">
                <RouteMap
                  route={r()}
                  stops={stops()}
                  stopNames={stops().map((entry) => stripStopCode(pick(entry.stop.name, lang())))}
                  nearestIndex={nearestIndex() >= 0 ? nearestIndex() : undefined}
                  selectedIndex={
                    typeof pickedSeq() === "number" ? (pickedSeq() as number) - 1 : undefined
                  }
                  onSelectStop={(index) => openStop(index + 1)}
                  expanded={search().map === true}
                  onExpandedChange={setMapOpen}
                  feed={vehicles()}
                  me={position()}
                  walkTarget={
                    nearestIndex() >= 0 ? (stops()[nearestIndex()]?.stop.location ?? null) : null
                  }
                  /* Shorter on a phone: the map is a preview with an expand button, and
                     the stop list under it is what the rider is here to read - at 17rem
                     the map took two stops' worth of a small screen to say what it says
                     at 14 (12 lost too much of the route's shape). Wide screens keep
                     filling the column. */
                  heightClass="h-[14rem] lg:h-auto lg:min-h-0 lg:flex-1"
                  lang={lang()}
                  unavailableLabel={t("mapUnavailable", lang())}
                  list={() => <StopList />}
                />
              </Card>
            </>
          }
        >
          {/*
           * Every stop, always. Folding away the ones behind you hid part of
           * the answer behind a control, and the page opens scrolled to where
           * you are standing anyway.
           */}

          {/*
           * The hour in which the service day is against you - not started,
           * about to end, or already over. The figures it used to sit beside
           * - fare, stops, journey time, the span itself - live in the
           * timetable dialog now, and this is the one of them worth
           * interrupting for, so it left the map's card with them and became
           * a row of its own directly above the list it applies to. Inside
           * the card it was a strip under a map, read after the map and
           * below the fold on a phone; the list is what a rider is here to
           * read, and "there is no bus yet" belongs at the top of it.
           */}
          <Show when={span()}>
            {(hours) => (
              <Show when={hours().untilFirst > 0 || hours().untilLast <= LAST_CALL_MINUTES}>
                <Alert lang={lang()} tone="warn" icon={<AlarmIcon size={13} />} class="shrink-0">
                  <span class="tnum font-semibold">
                    <Show
                      when={hours().untilFirst <= 0}
                      fallback={
                        <>
                          {t("notRunning", lang())} · {t("firstBus", lang())} {hours().first}
                          {/* And how long that is, once it is close enough to
                              be worth waiting out - the same hour the last-bus
                              warning uses. The other half of this note has
                              always counted down to the last departure; this
                              half stated a clock time and left the rider to do
                              the subtraction at four in the morning. Past the
                              hour the time alone is the honest answer: "312
                              分鐘" is not a wait, it is a night's sleep. */}
                          <Show when={hours().untilFirst <= LAST_CALL_MINUTES}>
                            {" · "}
                            {Math.round(hours().untilFirst)} {t("minute", lang())}
                          </Show>
                        </>
                      }
                    >
                      {t("lastBus", lang())} {hours().last} ·{" "}
                      <Show when={hours().untilLast >= 0} fallback={t("alreadyLeft", lang())}>
                        {Math.round(hours().untilLast)} {t("minute", lang())}
                      </Show>
                    </Show>
                  </span>
                </Alert>
              </Show>
            )}
          </Show>

          {/* Said once, before the list, and closed for good with one tap:
              the rider who has learned the gesture should not be told again. */}
          <Alert id="route.tap-for-eta" lang={lang()} class="shrink-0">
            {t("tapForEta", lang())}
          </Alert>

          {/* The card is the frame; the rows move inside it, at every width. */}
          {/* The card is the frame; the rows move inside it, at every width. */}
          <Card class="relative flex min-h-0 flex-1 flex-col">
            <div ref={listPane} class="app-scroll min-h-0 flex-1">
              <StopList />

              {/* The card is the scroller, so this is where the list has to
                  leave room for the band floating over its foot. */}
              <Show when={boardSeq() !== null}>
                <div class="h-20 lg:h-28" />
              </Show>
            </div>

            <Show when={band()}>
              {(view) => (
                /*
                 * A ride is planned by scrolling a list, so the ride cannot
                 * scroll away with it: the band floats over the foot of the
                 * list, which is the foot of this card at every width - on a
                 * phone the card ends just above the tab bar, where the thumb
                 * is.
                 */
                <div class="pointer-events-none absolute inset-x-3 bottom-3 z-30">
                  <div
                    class="app-dock pointer-events-auto mx-auto w-full max-w-[42rem]"
                    data-open={bandOpen() ? "true" : "false"}
                  >
                    <RideBand
                      active={bandOpen()}
                      route={r()}
                      boardSeq={view().boardSeq}
                      boardName={view().boardName}
                      ride={view().ride}
                      alightSeq={view().alightSeq}
                      alightStopId={view().alightStopId}
                      lang={lang()}
                      onClear={() => {
                        setBoardSeq(null);
                        setAlightSeq(null);
                      }}
                    />
                  </div>
                </div>
              )}
            </Show>
          </Card>
        </SplitPage>
      )}
    </Show>
  );
}
