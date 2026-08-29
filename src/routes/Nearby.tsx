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
} from "~/components/Chrome";
import { CardColumns, CardColumnItem, Page, Section } from "~/components/Layout";
import { ChevronRightIcon, MegaphoneIcon, PinIcon, RefreshIcon } from "~/components/Icons";
import { RouteLine, RouteRow, routeHref } from "~/components/RouteRow";
import { RoutePlate } from "~/components/RoutePlate";
import { EtaCountdown } from "~/components/EtaCountdown";
import { StopCard } from "~/components/StopCard";
import { StopListSkeleton } from "~/components/Skeleton";
import { useDb } from "~/data/context";
import {
  nearbyStopClusters,
  routeAt,
  routesAtCluster,
  type RouteAtStop,
  type StopCluster,
} from "~/data/db";
import { etaKey, fetchStopEtas } from "~/data/eta/batch";
import type { Eta, KeyedRoute, StopEntry } from "~/data/types";
import { stopIdsFor, useEta } from "~/data/useEta";
import { fetchNotices, routesMentioned } from "~/data/notices";
import { createAsyncMemo } from "~/lib/async";
import { distanceM, formatDistance, walkMinutes } from "~/lib/geo";
import { pick, stripStopCode, t, type Lang } from "~/lib/i18n";
import { etaTick, etaTickAt } from "~/stores/clock";
import { frequent } from "~/stores/frequent";
import { geo, useGeolocation } from "~/stores/geolocation";
import { saved } from "~/stores/saved";
import { RADIUS_CHOICES, settings, type NearbyMode } from "~/stores/settings";

/** How many stops to render before the list stops being useful. */
const MAX_STOPS = 12;
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
function NextTrip(props: { trip: Guess; lang: Lang }) {
  const etas = useEta(() => ({
    route: props.trip.route,
    seq: props.trip.seq,
    stopIdByCo: stopIdsFor(props.trip.route, props.trip.seq),
  }));

  return (
    <Card>
      <a
        href={`${routeHref(props.trip.route.key)}?stop=${props.trip.seq}`}
        class="mb-tap flex items-center gap-3 px-3.5 py-3"
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

        <EtaCountdown etas={etas()} lang={props.lang} size="lg" limit={1} />
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
            class="mb-press flex h-9 items-center gap-2 rounded-lg bg-primary px-4 text-[0.88rem] font-bold text-primary-foreground disabled:opacity-60"
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

  const stops = createMemo(() => {
    const at = position();
    if (!at) return [];
    return nearbyStopClusters(db(), at, settings.radiusM()).slice(0, MAX_STOPS);
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
  const departures = createAsyncMemo<Departure[]>(async () => {
    etaTick();
    if (settings.nearbyMode() !== "routes") return [];

    const clusters = stops();
    if (clusters.length === 0) return [];

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
  });

  /*
   * The route you are probably about to take: the one you open most often,
   * from the stop of it you are standing nearest. It is a guess, so it is only
   * offered when it is a good one - a route you have opened before, with a
   * stop of it inside a short walk.
   */
  const guess = createMemo(() => {
    const here = position();
    if (!here) return null;

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
        return { route, seq: index + 1, stopId, stop, metres };
      }
    }
    return null;
  });

  /**
   * Notices that name a route you keep or use, so a disruption reaches the
   * screen the rider actually opens rather than waiting in a tab.
   */
  const notices = createAsyncMemo(async () => {
    try {
      return await fetchNotices();
    } catch {
      return [];
    }
  });

  const mine = createMemo(() => {
    const numbers = new Set<string>();
    for (const item of saved.items()) {
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
    return (notices() ?? []).filter((notice) =>
      routesMentioned(notice).some((route) => numbers.has(route)),
    );
  });

  /* A function, not an array: the labels have to follow the language. */
  const modes = (): { value: NearbyMode; label: string }[] => [
    { value: "stop", label: t("byStop", lang()) },
    { value: "routes", label: t("allRoutes", lang()) },
  ];

  return (
    <Page wide>
      {/* Where you are belongs beside the title, and how far you will walk for
          a bus belongs beside both - one band, not three stacked rows. */}
      <ScreenTitle
        title={t("nearby", lang())}
        trailing={
          <div class="flex min-w-0 items-center gap-1.5 pb-1 text-primary lg:pb-0">
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
            <For each={RADIUS_CHOICES}>
              {(radius) => (
                <button
                  type="button"
                  onClick={() => settings.setRadiusM(radius)}
                  aria-pressed={settings.radiusM() === radius ? "true" : "false"}
                  class={[
                    "flex h-[1.6rem] items-center rounded-full px-2.5 text-[0.75rem] font-bold transition-colors duration-150",
                    {
                      "bg-primary text-primary-foreground": settings.radiusM() === radius,
                      "bg-secondary text-subtle-foreground": settings.radiusM() !== radius,
                    },
                  ]}
                >
                  <span class="tnum">{radius} m</span>
                </button>
              )}
            </For>
          </>
        }
      />

      <Show when={guess()}>
        {(trip) => (
          <Section>
            <SectionLabel
              trailing={
                <span class="tnum text-[0.75rem] font-semibold text-faint-foreground">
                  {t("updatedAt", lang())} {clockTime(etaTickAt())}
                </span>
              }
            >
              {t("headingOut", lang())}
            </SectionLabel>
            <NextTrip trip={trip()} lang={lang()} />
          </Section>
        )}
      </Show>

      {/* One line for the state of the network, and only about the routes this
          rider actually uses - a tab full of notices is not an answer to
          "is anything wrong with my bus". */}
      <Show when={mine().size > 0 && notices() !== undefined}>
        <a
          href="/notices"
          class={[
            "mb-press flex items-center gap-2.5 rounded-xl border px-3.5 py-2.5",
            affecting().length > 0
              ? "border-warning/25 bg-warning/10 text-warning"
              : "border-border bg-card text-subtle-foreground",
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
                          class="motion-safe:mb-rise"
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
                          plateSize="sm"
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
    </Page>
  );
}
