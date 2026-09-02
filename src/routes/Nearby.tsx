import { useLinkProps } from "@tanstack/solid-router";
import { uniqBy } from "es-toolkit";
import { For, Show, createMemo } from "solid-js";
import {
  Card,
  Chip,
  EmptyState,
  Hairline,
  LivePill,
  ScreenTitle,
  SectionLabel,
  Segmented,
  SpecialTag,
} from "~/components/Chrome";
import { CardColumns, CardColumnItem, Page, RowCard, Section } from "~/components/Layout";
import {
  ChevronRightIcon,
  MapIcon,
  MegaphoneIcon,
  PinIcon,
  RadiusIcon,
  RefreshIcon,
} from "~/components/Icons";
import { RouteLine } from "~/components/RouteRow";
import { browseLink, routeLink } from "~/lib/links";
import { RoutePlate } from "~/components/RoutePlate";
import { EtaCountdown } from "~/components/EtaCountdown";
import { StopCard } from "~/components/StopCard";
import { StopListSkeleton } from "~/components/Skeleton";
import { useDb } from "~/data/context";
import { lastRunGone } from "~/data/schedule";
import { now } from "~/stores/clock";
import { presetRoutes, scenicHighlights } from "~/data/presets";
import { operatorLabel } from "~/lib/operators";
import {
  isSpecialService,
  nearbyStopClusters,
  routeAt,
  routesAtCluster,
  type RouteAtStop,
  type StopCluster,
} from "~/data/db";
import { etaKey, fetchStopEtas } from "~/data/eta/batch";
import { observe } from "~/data/observe";
import type { Eta, KeyedRoute, StopEntry } from "~/data/types";
import { stopIdsFor, useEta } from "~/data/useEta";
import { live } from "~/data/live";
import { routesMentioned } from "~/data/notices";
import { useNotices } from "~/data/useNotices";
import { distanceM, formatDistance, formatRange, walkMinutes, type LatLng } from "~/lib/geo";
import { pick, stripStopCode, t, type Lang } from "~/lib/i18n";
import { liveUpdatedAt } from "~/data/live";
import { frequent } from "~/stores/frequent";
import { geo, useGeolocation } from "~/stores/geolocation";
import { starred } from "~/stores/starred";
import { settings, type NearbyMode } from "~/stores/settings";
import { sheets } from "~/stores/sheets";
/**
 * How many stops to render before the list stops being useful.
 *
 * A dozen fills a phone screen, but the kilometre notches of the range slider
 * exist for sparse country - and there, a hard twelve would hand the 2 km and
 * 4 km choices the same list as 800 m. So the cap follows the range. It grows
 * slower than the area does, because every extra card is another live
 * arrivals query on a cadence.
 */
function maxStops(radiusM: number): number {
  if (radiusM <= 800) return 12;
  return radiusM <= 2000 ? 18 : 24;
}
/** Routes previewed per stop; the stop page shows the rest. */
const PREVIEW_ROUTES = 4;
/** Departures in the merged list. Past this it is a timetable, not an answer. */
const MAX_DEPARTURES = 30;

interface Departure {
  at: RouteAtStop;
  cluster: StopCluster;
  etas: Eta[];
  /** Soonest arrival, or `Infinity` where the feed has nothing. */
  next: number;
}

/**
 * The routes most of the city knows by number, for a screen with no position
 * to fill itself from: a rider who has just installed the app on a desk, or
 * refused the location prompt, still gets somewhere to go from here.
 */
function PopularRoutes(props: { lang: Lang }) {
  const db = useDb();
  const routes = createMemo(() => presetRoutes(db()));

  return (
    <Show when={routes().length > 0}>
      <Section>
        <SectionLabel
          trailing={
            <span class="text-[0.75rem] font-semibold text-faint-foreground">
              {t("popularRoutesHint", props.lang)}
            </span>
          }
        >
          {t("popularRoutes", props.lang)}
        </SectionLabel>
        {/* Plain rows only: the card seams and columns itself. */}
        <RowCard>
          <For each={routes()}>
            {(route) => (
              <a
                {...useLinkProps(routeLink(route.key))}
                class="app-tap flex items-center gap-3 px-3.5 py-2.5"
              >
                <RoutePlate route={route.route} co={route.co} size="sm" />
                <div class="flex min-w-0 grow flex-col gap-0.5">
                  <span class="flex min-w-0 items-center gap-1.5">
                    <span class="truncate text-[0.88rem] font-bold tracking-[-0.01em] text-foreground">
                      <span class="mr-1 text-[0.75rem] font-semibold text-subtle-foreground">
                        {t("towards", props.lang)}
                      </span>
                      {pick(route.dest, props.lang)}
                    </span>
                    <Show when={isSpecialService(route)}>
                      <SpecialTag lang={props.lang} />
                    </Show>
                  </span>
                  <span class="truncate text-[0.75rem] font-medium text-subtle-foreground">
                    {operatorLabel(route.co, props.lang)} · {pick(route.orig, props.lang)}
                  </span>
                </div>
                <span class="text-faint-foreground">
                  <ChevronRightIcon size={15} />
                </span>
              </a>
            )}
          </For>
        </RowCard>
      </Section>
    </Show>
  );
}

/**
 * The buses tourists and day-trippers ride for the view - one route fronting
 * each scenic series, so the list spans the Peak, the beaches, the corridor
 * and Lantau rather than six numbers from the same coast. Leads the screen
 * only when there is no position; a located rider gets `ScenicLink` instead.
 */
function ScenicRoutes(props: { lang: Lang }) {
  const db = useDb();
  const highlights = createMemo(() => scenicHighlights(db()));

  return (
    <Show when={highlights().length > 0}>
      <Section>
        <SectionLabel
          trailing={
            <a
              {...useLinkProps(browseLink("tourism"))}
              class="app-tap text-[0.75rem] font-semibold text-primary"
            >
              {t("more", props.lang)}
            </a>
          }
        >
          {t("scenicRoutes", props.lang)}
        </SectionLabel>
        {/* Plain rows only: the card draws its own seams, and on a wide
            window flows the rows into columns - a Hairline child would sit
            in a grid cell of its own and tear the card apart. */}
        <RowCard>
          <For each={highlights()}>
            {(entry) => (
              <a
                {...useLinkProps(routeLink(entry.route.key))}
                class="app-tap flex items-center gap-3 px-3.5 py-2.5"
              >
                <RoutePlate route={entry.route.route} co={entry.route.co} size="sm" />
                <div class="flex min-w-0 grow flex-col gap-0.5">
                  <span class="truncate text-[0.88rem] font-bold tracking-[-0.01em] text-foreground">
                    {pick(entry.series.name, props.lang)}
                  </span>
                  <span class="truncate text-[0.75rem] font-medium text-subtle-foreground">
                    {t("towards", props.lang)} {pick(entry.route.dest, props.lang)} ·{" "}
                    {operatorLabel(entry.route.co, props.lang)}
                  </span>
                </div>
                <span class="text-faint-foreground">
                  <ChevronRightIcon size={15} />
                </span>
              </a>
            )}
          </For>
        </RowCard>
      </Section>
    </Show>
  );
}

/**
 * The located rider's way into the same catalogue. Nearby stops are the
 * screen's answer; this is one quiet line at the bottom, not a section
 * competing with them.
 */
function ScenicLink(props: { lang: Lang }) {
  return (
    <a
      {...useLinkProps(browseLink("tourism"))}
      class="app-press flex items-center gap-2.5 rounded-xl bg-card px-3.5 py-2.5 text-subtle-foreground shadow-card"
    >
      <MapIcon size={14} />
      <span class="min-w-0 grow truncate text-[0.81rem] font-bold">
        {t("scenicRoutes", props.lang)}
      </span>
      <ChevronRightIcon size={13} />
    </a>
  );
}

/** How far a stop can be and still be the one you are heading for. */
const GUESS_RADIUS_M = 500;

interface Guess {
  route: KeyedRoute;
  seq: number;
  stopId: string;
  stop: StopEntry;
  metres: number;
}

/** "15:18" in the rider's own clock, for saying how old a reading is. */
function clockTime(at: number): string {
  return new Date(at).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/**
 * The trip the app thinks you are about to make.
 *
 * A rider who opens a transit app at a kerb is usually not browsing: they are
 * catching the bus they always catch. This answers that before the list does -
 * the route, the stop of it within a short walk, and how long until it comes -
 * and opens the route at that stop when tapped.
 */
function NextTrip(props: { trip: Guess; lang: Lang; at: LatLng }) {
  const db = useDb();
  const etas = useEta(() => ({
    route: props.trip.route,
    seq: props.trip.seq,
    stopIdByCo: stopIdsFor(props.trip.route, props.trip.seq),
  }));
  /* An empty answer at a kerb at midnight is not the same news as an empty
     answer at noon; the timetable is what tells the two apart. */
  const over = () => {
    now();
    return lastRunGone(db(), props.trip.route);
  };

  return (
    <Card>
      <a
        {...useLinkProps(routeLink(props.trip.route.key, props.trip.seq))}
        class="app-tap flex items-center gap-3 px-3.5 py-3"
      >
        <RoutePlate route={props.trip.route.route} co={props.trip.route.co} size="md" />

        <div class="flex min-w-0 grow flex-col gap-0.5">
          <span class="truncate text-[0.94rem] font-bold tracking-[-0.01em] text-foreground">
            {t("towards", props.lang)} {pick(props.trip.route.dest, props.lang)}
          </span>
          <span class="truncate text-[0.81rem] font-medium text-subtle-foreground">
            {stripStopCode(pick(props.trip.stop.name, props.lang))} · {t("walk", props.lang)}{" "}
            {walkMinutes(props.trip.metres)} {t("minute", props.lang)}
          </span>
        </div>

        <EtaCountdown etas={etas()} lang={props.lang} size="lg" limit={1} over={over()} />
      </a>
    </Card>
  );
}

/**
 * What to do when there is no position.
 *
 * The old panel said "allow location" and offered a retry that called into a
 * watch already registered, so it returned immediately and nothing happened -
 * a button that could not fail and could not work either. Each way of failing
 * now says what it is and what the rider can do about it: a blocked permission
 * has to be changed in the browser, an insecure origin cannot ask at all, and
 * a timeout is worth simply trying again - which now really does try again.
 */
function NoLocation(props: { lang: Lang }) {
  const wording = () => {
    switch (geo.reason()) {
      case "blocked":
        return {
          title: t("locationBlocked", props.lang),
          hint: t("locationBlockedHint", props.lang),
        };
      case "insecure":
        return {
          title: t("locationInsecure", props.lang),
          hint: t("locationInsecureHint", props.lang),
        };
      case "unsupported":
        return { title: t("locationUnsupported", props.lang), hint: undefined };
      case "timeout":
        return {
          title: t("locationTimeout", props.lang),
          hint: t("locationTimeoutHint", props.lang),
        };
      default:
        return { title: t("locationDenied", props.lang), hint: t("locationHint", props.lang) };
    }
  };

  // Retrying an origin that cannot ask, or a browser that cannot answer, would
  // be the same dead button in a new costume.
  const canRetry = () => geo.reason() !== "insecure" && geo.reason() !== "unsupported";
  const busy = () => geo.status() === "locating";

  return (
    <EmptyState
      title={wording().title}
      hint={wording().hint}
      action={
        <Show when={canRetry()}>
          <button
            type="button"
            disabled={busy()}
            onClick={() => geo.retry()}
            class="app-press flex h-9 items-center gap-2 rounded-lg bg-primary px-4 text-[0.88rem] font-bold text-primary-foreground disabled:opacity-60"
          >
            <span class={{ "motion-safe:animate-spin": busy() }}>
              <RefreshIcon size={13} />
            </span>
            {busy() ? t("locating", props.lang) : t("retry", props.lang)}
          </button>
        </Show>
      }
    />
  );
}

export default function Nearby() {
  const db = useDb();
  const lang = settings.lang;
  const { position, status } = useGeolocation();

  /*
   * Same kerbs -> same objects. `<For>` keys rows by reference, so handing it
   * fresh copies of the same clusters unmounted and remounted every card -
   * queries, observers and all - whenever the position moved enough to pass
   * the store's jitter gate without changing the answer. The distances on the
   * kept objects can lag by a few tens of metres; the moment one drifts past
   * that, or any kerb changes place in the list, the list is rebuilt.
   */
  let lastStops: StopCluster[] = [];
  const stops = createMemo(() => {
    const at = position();
    if (!at) return (lastStops = []);
    const radius = settings.radiusM();
    const next = nearbyStopClusters(db(), at, radius).slice(0, maxStops(radius));
    const same =
      next.length === lastStops.length &&
      next.every(
        (cluster, i) =>
          cluster.stopId === lastStops[i]?.stopId &&
          Math.abs(cluster.metres - (lastStops[i]?.metres ?? 0)) < 40,
      );
    return same ? lastStops : (lastStops = next);
  });

  /*
   * Nothing has been located yet. Distinct from "located, and there is nothing
   * here", which is a real answer and gets words rather than a placeholder.
   */
  const waiting = () => position() === null && status() !== "denied" && status() !== "unavailable";

  const nearestName = () => {
    const first = stops()[0];
    return first ? stripStopCode(pick(first.stop.name, lang())) : null;
  };

  /**
   * Every departure near you, as one queue.
   *
   * Grouping by stop answers "what is at this kerb"; a rider who does not mind
   * which kerb they walk to is asking the other question - "what leaves first"
   * - and a list of cards cannot be read that way. Both are here because both
   * are asked, and which one is on screen is remembered.
   *
   * Arrivals are batched per kerb, so the merged list costs the same requests
   * as the grouped one rather than one per row.
   */
  const load = async (clusters: StopCluster[]): Promise<Departure[]> => {
    const perStop = await Promise.all(
      clusters.map(async (cluster) => {
        // One route number can call at a kerb as several service types; to
        // someone standing there they are the same bus.
        const routes = uniqBy(
          routesAtCluster(db(), cluster.memberIds),
          (at) => `${at.route.route}/${at.route.dest.en}`,
        );
        if (routes.length === 0) return [] as Departure[];

        const map = await fetchStopEtas(db(), cluster.stopId, routes).catch(
          () => new Map<string, Eta[]>(),
        );

        return routes.map((at) => {
          const etas = map.get(etaKey(at.route.key)) ?? [];
          return {
            at,
            cluster,
            etas,
            next: etas[0]?.at.getTime() ?? Number.POSITIVE_INFINITY,
          };
        });
      }),
    );

    /*
     * A route running past two kerbs of the same junction is still one bus to
     * catch. Sorted first, so the copy that survives is the one leaving
     * soonest, and the nearer kerb breaks a tie.
     */
    const sorted = perStop
      .flat()
      .sort((a, b) => a.next - b.next || a.cluster.metres - b.cluster.metres);

    return uniqBy(sorted, (row) => row.at.route.key).slice(0, MAX_DEPARTURES);
  };

  // A plain signal, not a query read: this screen owning a `useQuery` had its
  // rendering held through every poll - see `~/data/observe`.
  const departureQuery = observe<Departure[]>(() => {
    const clusters = stops();
    // Only fetched while the merged view is the one on screen; the grouped
    // view's cards ask for the same kerbs themselves.
    if (settings.nearbyMode() !== "routes" || clusters.length === 0) return null;
    return {
      ...live(),
      queryKey: ["departures", clusters.map((cluster) => cluster.stopId)] as const,
      queryFn: () => load(clusters),
    };
  });
  const departures = (): Departure[] => departureQuery.data() ?? [];

  /*
   * The route you are probably about to take: the one you open most often,
   * from the stop of it you are standing nearest. It is a guess, so it is only
   * offered when it is a good one - a route you have opened before, with a
   * stop of it inside a short walk.
   */
  let lastGuess: Guess | null = null;
  const guess = createMemo(() => {
    const here = position();
    if (!here) return (lastGuess = null);

    for (const key of frequent.top(5)) {
      const route = routeAt(db(), key);
      if (!route) continue;

      const co = route.co[0] ?? "kmb";
      const ids = route.stops[co] ?? [];
      let index = -1;
      let metres = Number.POSITIVE_INFINITY;

      ids.forEach((id, i) => {
        const stop = db().stopList[id];
        if (!stop) return;
        const d = distanceM(here, stop.location);
        if (d < metres) {
          metres = d;
          index = i;
        }
      });

      const stopId = index >= 0 ? ids[index] : undefined;
      const stop = stopId ? db().stopList[stopId] : undefined;
      if (stop && stopId && metres <= GUESS_RADIUS_M) {
        /* Same trip -> same object: the keyed <Show> above the card remounts
           its child per new reference, and the card re-created its query for
           every wobble the jitter gate let through. */
        if (
          lastGuess &&
          lastGuess.route.key === route.key &&
          lastGuess.seq === index + 1 &&
          Math.abs(lastGuess.metres - metres) < 40
        ) {
          return lastGuess;
        }
        return (lastGuess = { route, seq: index + 1, stopId, stop, metres });
      }
    }
    return (lastGuess = null);
  });

  /**
   * Notices that name a route you keep or use, so a disruption reaches the
   * screen the rider actually opens rather than waiting in a tab.
   */
  const { notices } = useNotices();

  const mine = createMemo(() => {
    const numbers = new Set<string>();
    for (const item of starred.items()) {
      const route = routeAt(db(), item.routeKey);
      if (route) numbers.add(route.route);
    }
    for (const key of frequent.top(8)) {
      const route = routeAt(db(), key);
      if (route) numbers.add(route.route);
    }
    return numbers;
  });

  const affecting = createMemo(() => {
    const numbers = mine();
    if (numbers.size === 0) return [];
    return notices().list.filter((notice) =>
      routesMentioned(notice).some((route) => numbers.has(route)),
    );
  });

  /* A function, not an array: the labels have to follow the language. */
  const modes = (): { value: NearbyMode; label: string }[] => [
    { value: "stop", label: t("byStop", lang()) },
    { value: "routes", label: t("allRoutes", lang()) },
  ];

  return (
    <Page>
      {/* Where you are belongs beside the title, and how far you will walk for
          a bus belongs beside both - one band, not three stacked rows. */}
      <ScreenTitle
        title={t("home", lang())}
        trailing={
          <div class="flex min-w-0 items-center gap-1.5 text-primary">
            <PinIcon size={15} />
            <span class="truncate text-[0.88rem] font-bold tracking-[-0.01em] text-foreground">
              {nearestName() ??
                t(
                  status() === "ready"
                    ? "noNearby"
                    : status() === "denied" || status() === "unavailable"
                      ? "locationDenied"
                      : "locating",
                  lang(),
                )}
            </span>
          </div>
        }
        controls={
          <>
            <Show when={status() === "ready"}>
              <LivePill label={t("live", lang())} />
            </Show>
            {/* One chip wearing the current range, not a row of presets:
                the choosing happens on a map, in its own sheet. */}
            <button
              type="button"
              onClick={() => sheets.openRange()}
              aria-label={`${t("radius", lang())} ${formatRange(settings.radiusM())}`}
              class="app-press flex h-[1.6rem] items-center gap-1.5 rounded-full bg-secondary px-2.5 text-[0.75rem] font-bold text-subtle-foreground"
            >
              <RadiusIcon size={12} />
              <span class="tnum">{formatRange(settings.radiusM())}</span>
            </button>
          </>
        }
      />

      <Show when={guess()}>
        {(trip) => (
          <Section>
            <SectionLabel
              trailing={
                <span class="tnum text-[0.75rem] font-semibold text-faint-foreground">
                  {t("updatedAt", lang())} {clockTime(liveUpdatedAt())}
                </span>
              }
            >
              {t("headingOut", lang())}
            </SectionLabel>
            <NextTrip trip={trip()} lang={lang()} at={position()!} />
          </Section>
        )}
      </Show>

      {/* One line for the state of the network, and only about the routes this
          rider actually uses - a tab full of notices is not an answer to
          "is anything wrong with my bus". */}
      <Show when={mine().size > 0}>
        <a
          {...useLinkProps({ to: "/notices" })}
          class={[
            "app-press flex items-center gap-2.5 rounded-xl px-3.5 py-2.5",
            affecting().length > 0
              ? "bg-warning/10 text-warning"
              : "bg-card text-subtle-foreground shadow-card",
          ]}
        >
          <MegaphoneIcon size={14} />
          <span class="min-w-0 grow truncate text-[0.81rem] font-bold">
            <Show when={affecting().length > 0} fallback={t("noNoticesYours", lang())}>
              {affecting().length} {t("noticesAffecting", lang())}
            </Show>
          </span>
          <ChevronRightIcon size={13} />
        </a>
      </Show>

      <Section>
        {/* How the same stops are read, beside the heading of the list it
            governs rather than trailing the radius chips, where it wrapped onto
            a line of its own and read as another radius. */}
        <SectionLabel
          trailing={
            <Segmented
              pill
              dense
              value={settings.nearbyMode()}
              options={modes()}
              onChange={(mode) => settings.setNearbyMode(mode)}
              label={t("nearbyStops", lang())}
            />
          }
        >
          {settings.nearbyMode() === "routes"
            ? t("nearbyRoutes", lang())
            : t("nearbyStops", lang())}
        </SectionLabel>

        {/*
         * Something to open before the phone knows where it is - and
         * something to open if it never will. A home screen that is a
         * blank until a permission dialog is answered is not a home screen.
         */}
        <Show when={position() === null}>
          {/* The scenic list leads: a rider with no position granted is more
              often a visitor planning a day than a commuter chasing a stop. */}
          <ScenicRoutes lang={lang()} />
          <PopularRoutes lang={lang()} />
        </Show>

        <Show
          when={status() !== "denied" && status() !== "unavailable"}
          fallback={<NoLocation lang={lang()} />}
        >
          <Show
            when={!waiting()}
            fallback={
              /* The wait is the shape of the answer. A single line of text here
                 made the list arrive as a jolt, and a row of thin bars did not
                 look like the cards that replaced them. */
              <CardColumns>
                <StopListSkeleton />
              </CardColumns>
            }
          >
            <Show
              when={stops().length > 0}
              fallback={
                <div class="py-10 text-center">
                  <Chip>{t("noNearby", lang())}</Chip>
                </div>
              }
            >
              <Show
                when={settings.nearbyMode() === "routes"}
                fallback={
                  <CardColumns>
                    <For each={stops()}>
                      {(entry, index) => (
                        <CardColumnItem
                          class="motion-safe:app-rise"
                          style={{ "animation-delay": `${Math.min(index(), 8) * 24}ms` }}
                        >
                          <StopCard
                            stopId={entry.stopId}
                            stop={entry.stop}
                            memberIds={entry.memberIds}
                            metres={entry.metres}
                            lang={lang()}
                            maxRoutes={PREVIEW_ROUTES}
                          />
                        </CardColumnItem>
                      )}
                    </For>
                  </CardColumns>
                }
              >
                <Card>
                  <For each={departures()}>
                    {(row, index) => (
                      <>
                        <Show when={index() > 0}>
                          <Hairline />
                        </Show>
                        <RouteLine
                          route={row.at.route}
                          seq={row.at.seq}
                          lang={lang()}
                          etas={row.etas}
                          countdownSize="sm"
                          /* Which kerb, and how far: in a merged list that is
                             the fact the grouping used to carry. */
                          subtitle={`${stripStopCode(pick(row.cluster.stop.name, lang()))} · ${formatDistance(row.cluster.metres)}`}
                        />
                      </>
                    )}
                  </For>
                </Card>
              </Show>
            </Show>
          </Show>
        </Show>
      </Section>

      <Show when={position() !== null}>
        <ScenicLink lang={lang()} />
      </Show>
    </Page>
  );
}
