import { useLinkProps } from "@tanstack/solid-router";
import { For, Show, createEffect, createMemo, createSignal } from "solid-js";
import { Chip, ScreenTitle, SectionLabel } from "~/components/Chrome";
import { Trail } from "~/components/Breadcrumb";
import { DirectionTrains } from "~/components/DirectionTrains";
import { Drawer, DrawerHeader } from "~/components/Drawer";
import { ChevronRightIcon, PinIcon } from "~/components/Icons";
import { Page } from "~/components/Layout";
import { RailDiagram } from "~/components/RailDiagram";
import { RoutePlate } from "~/components/RoutePlate";
import { useDb } from "~/data/context";
import {
  lightRailRoutes,
  lightRailStopId,
  lineName,
  lineStations,
  railLine,
  type RailLine,
} from "~/data/rail";
import { LIGHT_RAIL, MAP_STATIONS } from "~/data/railMap";
import { serviceSpan } from "~/data/schedule";
import { distanceM } from "~/lib/geo";
import { pick, stripStopCode, t, type Lang } from "~/lib/i18n";
import { routeLink, stopLink } from "~/lib/links";
import { OPERATORS, plateStyle } from "~/lib/operators";
import { useGeolocation } from "~/stores/geolocation";
import { settings } from "~/stores/settings";

/** Past this you are not at the station, you are near it. Matches the line page. */
const AT_STATION_M = 500;

/** What the sheet is showing: a station, a line, or nothing. */
type Sheet = { kind: "station"; id: string } | { kind: "line"; code: string } | null;

/**
 * The railway as the diagram everyone already has in their head - and the
 * whole of the railway, read from it.
 *
 * The line pages answered "where does this line go" on a page of their own,
 * which meant leaving the map to find out, and coming back to it to ask about
 * the next station. Everything they knew is in the sheet now: pick a station
 * and its next trains are under your thumb; pick a line, from the key or from
 * a station, and its stations and hours are, and any of them is one tap from
 * being the station you are reading. The map never goes away.
 */
export default function RailMap() {
  const db = useDb();
  const lang = settings.lang;
  const { position } = useGeolocation();

  const [sheet, setSheet] = createSignal<Sheet>(null);
  const selected = () => {
    const s = sheet();
    return s?.kind === "station" ? s.id : null;
  };
  const focus = () => {
    const s = sheet();
    return s?.kind === "line" ? s.code : null;
  };

  /* The sheet keeps its last contents while it slides away, or it would empty
     itself the moment the close began and the exit would be a blank card. */
  const [shown, setShown] = createSignal<Sheet>(null);
  createEffect(
    () => sheet(),
    (s) => {
      if (s) setShown(s);
    },
  );
  const shownStation = () => {
    const s = shown();
    return s?.kind === "station" ? s.id : null;
  };
  const shownLine = () => {
    const s = shown();
    return s?.kind === "line" ? s.code : null;
  };

  /** The station you are standing at, if you are standing at one. */
  const here = createMemo(() => {
    const at = position();
    if (!at) return null;

    let best: string | null = null;
    let closest = Number.POSITIVE_INFINITY;
    for (const station of MAP_STATIONS) {
      const stop = db().stopList[station.id];
      if (!stop) continue;
      const metres = distanceM(at, stop.location);
      if (metres < closest) {
        closest = metres;
        best = station.id;
      }
    }
    return closest <= AT_STATION_M ? best : null;
  });

  const openStation = (id: string | null) => setSheet(id ? { kind: "station", id } : null);
  const openLine = (code: string | null) => setSheet(code ? { kind: "line", code } : null);

  return (
    <Page fill>
      <ScreenTitle
        title={t("networkMap", lang())}
        subtitle={t("networkMapHint", lang())}
        lead={<Trail extra={[{ href: "/rail", label: t("rail", lang()) }]} />}
        pinned={false}
      />

      {/* The map takes the whole width, and what is picked on it rises from
          the bottom as a drawer over it. `lg:mb-3` matches the inset the
          sidebar floats at, so the map ends level with it. */}
      <div class="relative flex min-h-0 grow flex-col lg:mb-3">
        <RailDiagram
          lang={lang()}
          label={t("networkMap", lang())}
          selected={selected()}
          onSelect={openStation}
          focus={focus()}
          onFocus={openLine}
          here={here()}
          class="grow"
        />

        <Drawer
          open={sheet() !== null}
          onClose={() => setSheet(null)}
          within
          snapPoints={[0.44, 0.9]}
          label={t("networkMap", lang())}
          class="max-w-[26rem]"
        >
          <Show when={shownStation()}>
            {(id) => (
              <StationSheet
                id={id()}
                lang={lang()}
                here={here() === id()}
                onLine={openLine}
                onClose={() => setSheet(null)}
              />
            )}
          </Show>
          <Show when={shownLine()}>
            {(code) => (
              <LineSheet
                code={code()}
                lang={lang()}
                here={here()}
                onStation={openStation}
                onClose={() => setSheet(null)}
              />
            )}
          </Show>
        </Drawer>
      </div>
    </Page>
  );
}

/**
 * A station: every line through it with its next trains in both directions,
 * and for the light rail every tram calling, each with its own count.
 *
 * The line's name is a row that opens the line, so the sheet is never a dead
 * end; the arrivals are simply there, because they are what a rider standing
 * on a platform wants before anything else.
 */
function StationSheet(props: {
  id: string;
  lang: Lang;
  here: boolean;
  onLine: (code: string) => void;
  onClose: () => void;
}) {
  const db = useDb();
  const station = createMemo(() => MAP_STATIONS.find((s) => s.id === props.id) ?? null);
  const name = () => stripStopCode(pick(db().stopList[props.id]?.name, props.lang)) || props.id;

  const lines = createMemo(() =>
    (station()?.lines ?? [])
      .filter((code) => code !== LIGHT_RAIL)
      .flatMap((code) => {
        const line = railLine(db(), code);
        return line ? [line] : [];
      }),
  );

  /*
   * Light rail is route-numbered, so its rows are trams with a direction each,
   * looked up by the id the feed knows this stop as. That id is spelled two
   * ways across the data, so each route is asked for its own spelling.
   */
  const trams = createMemo(() => {
    const stop = station()?.lightRail;
    if (!stop) return [];
    return lightRailRoutes(db()).flatMap((route) => {
      const at = (route.stops.lightRail ?? []).find((s) => lightRailStopId(s) === stop);
      return at ? [{ route, at }] : [];
    });
  });

  return (
    <div class="flex flex-col pb-3">
      <DrawerHeader title={name()} onClose={props.onClose} closeLabel={t("close", props.lang)}>
        <Show when={props.here}>
          <Chip tone="accent" class="shrink-0">
            <PinIcon size={11} />
            {t("youAreHere", props.lang)}
          </Chip>
        </Show>
      </DrawerHeader>

      <For each={lines()}>
        {(line) => (
          <div class="flex flex-col gap-2 px-3.5 pb-3">
            <button
              type="button"
              onClick={() => props.onLine(line.code)}
              class="mb-press flex items-center gap-3 rounded-lg py-1 text-left"
            >
              <RoutePlate route={line.code} co={["mtr"]} size="sm" />
              <span class="min-w-0 grow truncate text-[0.88rem] font-bold text-foreground">
                {pick(lineName(line.code), props.lang)}
              </span>
              <span class="shrink-0 text-faint-foreground">
                <ChevronRightIcon size={14} />
              </span>
            </button>
            <For each={line.directions}>
              {(route) => (
                <DirectionTrains route={route} stationId={props.id} lang={props.lang} active />
              )}
            </For>
          </div>
        )}
      </For>

      <Show when={trams().length > 0}>
        <div class="flex flex-col gap-2 px-3.5 pb-3">
          <div class="flex items-center gap-3 py-1">
            <RoutePlate
              route={OPERATORS.lightRail.short[props.lang]}
              co={["lightRail"]}
              size="sm"
            />
            <span class="min-w-0 grow truncate text-[0.88rem] font-bold text-foreground">
              {OPERATORS.lightRail.name[props.lang]}
            </span>
          </div>
          <For each={trams()}>
            {(tram) => (
              <DirectionTrains
                route={tram.route}
                stationId={tram.at}
                co="lightRail"
                lang={props.lang}
                active
                numbered
              />
            )}
          </For>
        </div>
      </Show>

      <div class="mx-3.5 h-px bg-border" />
      <a {...useLinkProps(stopLink(props.id))} class="mb-tap flex items-center gap-3 px-3.5 py-2.5">
        <span class="min-w-0 grow truncate text-[0.88rem] font-bold text-primary">
          {t("nextTrains", props.lang)}
        </span>
        <span class="shrink-0 text-primary">
          <ChevronRightIcon size={14} />
        </span>
      </a>
    </div>
  );
}

/**
 * A line: its two directions with the hours they run, and every station on
 * it in running order. A station tapped here becomes the station being read,
 * and the map goes to it.
 */
function LineSheet(props: {
  code: string;
  lang: Lang;
  here: string | null;
  onStation: (id: string) => void;
  onClose: () => void;
}) {
  const db = useDb();
  const line = createMemo<RailLine | undefined>(() => railLine(db(), props.code));
  const stations = createMemo(() => {
    const l = line();
    return l ? lineStations(db(), l) : [];
  });
  const colour = () => plateStyle(["mtr"], props.code).background;

  /*
   * The light rail is not a line but a network of routes, and its sheet is
   * the list of them - each a tram with a direction, opening its own page.
   */
  const trams = createMemo(() => (props.code === LIGHT_RAIL ? lightRailRoutes(db()) : []));

  return (
    <Show
      when={line()}
      fallback={
        <Show when={props.code === LIGHT_RAIL}>
          <div class="flex flex-col pb-3">
            <DrawerHeader
              title={
                <span class="flex items-center gap-2">
                  <RoutePlate
                    route={OPERATORS.lightRail.short[props.lang]}
                    co={["lightRail"]}
                    size="sm"
                  />
                  <span class="truncate">{OPERATORS.lightRail.name[props.lang]}</span>
                </span>
              }
              onClose={props.onClose}
              closeLabel={t("close", props.lang)}
            >
              <span class="tnum text-[0.75rem] font-medium text-subtle-foreground">
                {trams().length} {t("routes", props.lang)}
              </span>
            </DrawerHeader>
            <For each={trams()}>
              {(route) => (
                <a
                  {...useLinkProps(routeLink(route.key))}
                  class="mb-tap flex items-center gap-3 px-3.5 py-2"
                >
                  <RoutePlate route={route.route} co={route.co} size="sm" />
                  <span class="min-w-0 grow truncate text-[0.88rem] font-bold text-foreground">
                    {t("towards", props.lang)} {pick(route.dest, props.lang)}
                  </span>
                  <span class="shrink-0 text-faint-foreground">
                    <ChevronRightIcon size={14} />
                  </span>
                </a>
              )}
            </For>
          </div>
        </Show>
      }
    >
      {(l) => (
        <div class="flex flex-col pb-3">
          <DrawerHeader
            title={
              <span class="flex items-center gap-2">
                <RoutePlate route={props.code} co={["mtr"]} size="sm" />
                <span class="truncate">{pick(lineName(props.code), props.lang)}</span>
              </span>
            }
            onClose={props.onClose}
            closeLabel={t("close", props.lang)}
          >
            <span class="tnum text-[0.75rem] font-medium text-subtle-foreground">
              {stations().length} {t("stops", props.lang)}
            </span>
          </DrawerHeader>

          <For each={l().directions}>
            {(route) => {
              const span = () => serviceSpan(db(), route);
              return (
                <a
                  {...useLinkProps(routeLink(route.key))}
                  class="mb-tap flex items-center gap-3 px-3.5 py-2"
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
                          {t("firstTrain", props.lang)} {hours().first} ·{" "}
                          {t("lastTrain", props.lang)} {hours().last}
                        </span>
                      )}
                    </Show>
                  </div>
                  <span class="shrink-0 text-faint-foreground">
                    <ChevronRightIcon size={14} />
                  </span>
                </a>
              );
            }}
          </For>

          <div class="px-3.5 pb-1 pt-2">
            <SectionLabel>{t("lineStations", props.lang)}</SectionLabel>
          </div>

          <For each={stations()}>
            {(station, index) => (
              <button
                type="button"
                onClick={() => props.onStation(station.id)}
                class="mb-tap flex w-full items-center gap-3 px-3.5 py-2 text-left"
              >
                {/* The spine: the line drawn down the list, the way it is drawn
                    in every station. */}
                <div class="-my-2 flex w-3.5 shrink-0 flex-col items-center self-stretch">
                  <div
                    class="w-[3px] shrink-0"
                    style={{ height: "14px", background: index() === 0 ? "transparent" : colour() }}
                  />
                  <div
                    class="size-2.5 shrink-0 rounded-full"
                    style={{
                      background: props.here === station.id ? colour() : "var(--card)",
                      border: `3px solid ${colour()}`,
                    }}
                  />
                  <div
                    class="w-[3px] grow"
                    style={{
                      background: index() === stations().length - 1 ? "transparent" : colour(),
                    }}
                  />
                </div>
                <span class="min-w-0 grow truncate text-[0.88rem] font-bold text-foreground">
                  {pick(station.stop.name, props.lang)}
                </span>
                <Show when={station.interchanges.length > 0}>
                  <div class="flex shrink-0 items-center gap-1">
                    <For each={station.interchanges}>
                      {(other) => (
                        <span
                          class="flex h-[1.05rem] items-center rounded px-1 text-[0.69rem] font-extrabold"
                          style={{
                            background: plateStyle(["mtr"], other).background,
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
            )}
          </For>
        </div>
      )}
    </Show>
  );
}
