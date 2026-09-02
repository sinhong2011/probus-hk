import { useLinkProps, useNavigate, useSearch } from "@tanstack/solid-router";
import { For, Show, createEffect, createMemo, createSignal } from "solid-js";
import { Chip, SectionLabel } from "~/components/Chrome";
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
  railLines,
  type RailLine,
} from "~/data/rail";
import { LIGHT_RAIL, MAP_STATIONS } from "~/data/railMap";
import { serviceSpan } from "~/data/schedule";
import { distanceM } from "~/lib/geo";
import { pick, stripStopCode, t, type Lang } from "~/lib/i18n";
import { appTitle, usePageHead } from "~/lib/documentHead";
import { routeLink, stopLink } from "~/lib/links";
import { createWide } from "~/lib/wide";
import { OPERATORS, plateStyle } from "~/lib/operators";
import { useGeolocation } from "~/stores/geolocation";
import { settings } from "~/stores/settings";

/** Past this you are not at the station, you are near it. Matches the line page. */
const AT_STATION_M = 500;

/** What a sheet shows: a station or a line. Nothing open is `null`. */
type Sheet =
  | { kind: "station"; id: string }
  | { kind: "line"; code: string }
  | { kind: "lines" }
  | null;

const same = (a: Sheet, b: Sheet) => {
  if (a === null || b === null || a.kind !== b.kind) return false;
  if (a.kind === "station") return a.id === (b as { id: string }).id;
  if (a.kind === "line") return a.code === (b as { code: string }).code;
  return true;
};

/**
 * Where a sheet rests: folded to its title, at reading height, or nearly the
 * whole window. The fold is a floor, not a way out: a sheet is put away by
 * its cross, never by a swipe that meant to fold it and went a little far.
 * Pixels for the fold because it is the height of a header, and a header is
 * the same height on any screen.
 */
const SNAP_POINTS = ["88px", 0.44, 0.9];
/** The list of every line is denser than a station, and rests a fifth lower. */
const LINES_SNAP_POINTS = ["88px", 0.35, 0.72];
const READING = 1;

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
 *
 * What is opened from inside a sheet opens over it, the way a phone stacks
 * its own: a station's line rises over the station, which draws back under
 * it and is there again when the line is closed. Two deep and no deeper -
 * from the top sheet, the next thing takes the top sheet's place.
 */
export default function RailMap() {
  const db = useDb();
  const lang = settings.lang;
  const { position } = useGeolocation();

  /*
   * The top sheet is the URL's, not the screen's: a station or a line in the
   * search, so a link to "the map at Admiralty" is a link, a reload comes
   * back to it, and the back button leaves the map. Replaced rather than
   * pushed - reading three stations in a row is one visit to the map, not
   * three screens to come back through.
   */
  const search = useSearch({ from: "/rail/map" });
  const navigate = useNavigate();
  const sheet = (): Sheet => {
    const s = search();
    if (s.station) return { kind: "station", id: s.station };
    if (s.line) return { kind: "line", code: s.line };
    if (s.lines) return { kind: "lines" };
    return null;
  };
  const setSheet = (next: Sheet) =>
    navigate({
      to: "/rail/map",
      search:
        next === null
          ? {}
          : next.kind === "station"
            ? { station: next.id }
            : next.kind === "line"
              ? { line: next.code }
              : { lines: true },
      replace: true,
    });

  /*
   * What the top sheet is stacked on, when it is stacked on something: the
   * station a line was opened from, the line a station was. The screen's,
   * not the URL's - a link is to one thing, and comes back to that one thing
   * on its own. The bottom sheet shows this, or the URL's when there is
   * nothing under it; the top shows the URL's when it differs from what it
   * is over, so the URL settling on the sheet under it is what closes it.
   */
  const [under, setUnder] = createSignal<Sheet>(null);
  const bottom = (): Sheet => under() ?? sheet();
  const top = (): Sheet => {
    const u = under();
    const s = sheet();
    return u !== null && s !== null && !same(u, s) ? s : null;
  };
  /** Picked on the map: the one sheet, whatever was stacked before. */
  const openOnMap = (next: Sheet) => {
    setUnder(null);
    setSheet(next);
  };
  /** Picked inside the bottom sheet: opens over it. */
  const openOver = (next: Sheet) => {
    setUnder(bottom());
    setSheet(next);
  };
  /** Picked inside the top sheet: takes its place. */
  const openOnTop = (next: Sheet) => setSheet(next);
  const closeTop = () => setSheet(under());
  const closeAll = () => {
    setUnder(null);
    setSheet(null);
  };
  /* Each sheet keeps its last contents while it slides away, or it would
     empty itself the moment the close began and the exit would be a blank
     card. */
  const bottomShown = retained(bottom);
  const topShown = retained(top);
  /* Where the bottom sheet rests, as an index: its rest positions differ by
     what it shows, and an index survives the list changing under it where a
     value would not. */
  const [bottomSnap, setBottomSnap] = createSignal(READING);
  const bottomSnaps = () => (bottomShown()?.kind === "lines" ? LINES_SNAP_POINTS : SNAP_POINTS);

  /*
   * On a wide screen the sheets are panels from the right, full height beside
   * the map rather than over the foot of it, and a panel has no rest
   * positions: it is there, or its cross has put it away. A panel lays its
   * contents out itself, so the part that scrolls is marked here.
   */
  const wide = createWide();
  const side = () => (wide() ? "right" : "bottom") as "right" | "bottom";
  const pane = () =>
    wide() ? "app-scroll min-h-0 grow touch-pan-y overflow-y-auto overscroll-contain" : "contents";

  const selected = () => {
    const s = sheet();
    return s?.kind === "station" ? s.id : null;
  };
  const focus = () => {
    const s = sheet();
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

  const pickStation = (id: string | null) => openOnMap(id ? { kind: "station", id } : null);
  const pickLine = (code: string | null) => openOnMap(code ? { kind: "line", code } : null);

  usePageHead(() => {
    const s = sheet();
    if (s?.kind === "station") {
      const stop = db().stopList[s.id];
      const name = stripStopCode(pick(stop?.name, lang())) || s.id;
      return appTitle(name, lang());
    }
    if (s?.kind === "line") {
      return appTitle(pick(lineName(s.code), lang()), lang());
    }
    if (s?.kind === "lines") {
      return appTitle(t("wholeNetwork", lang()), lang());
    }
    return appTitle(t("networkMap", lang()), lang());
  });

  return (
    /* `always`, not `fill`: plain `fill` holds the page to the window only on
       a wide screen, and below that the map's SVG - which has an aspect ratio
       of its own - set the card's height. Portrait got away with it; a phone
       held sideways got a map taller than the window and a page of black
       under it. */
    <Page fill="always" flush>
      {/* The map takes the whole width, and what is picked on it rises from
          the foot of the window as a drawer over it - the window's, not the
          panel's, on every screen: a sheet is the page's, and lives with the
          page's other sheets rather than inside one card of it. The page is
          flush with the sidebar top and bottom, so the map's edges are level
          with the sidebar's. */}
      <div class="relative flex min-h-0 grow flex-col overflow-hidden rounded-xl border border-border">
        <RailDiagram
          lang={lang()}
          label={t("networkMap", lang())}
          selected={selected()}
          onSelect={pickStation}
          focus={focus()}
          onFocus={pickLine}
          onAll={() => openOnMap({ kind: "lines" })}
          here={here()}
          class="grow"
        />

        <Drawer
          open={bottom() !== null}
          onClose={closeAll}
          dismissible={false}
          flush
          side={side()}
          snapPoints={wide() ? undefined : bottomSnaps()}
          initialSnap={READING}
          snap={bottomSnap()}
          onSnapChange={setBottomSnap}
          label={t("networkMap", lang())}
          class="max-w-[26rem]"
        >
          <div class={pane()}>
            <SheetBody
              sheet={bottomShown()}
              lang={lang()}
              here={here()}
              onStation={(id) => openOver({ kind: "station", id })}
              onLine={(code) => openOver({ kind: "line", code })}
              onClose={closeAll}
            />
          </div>

          {/* What was opened from inside the bottom sheet, over it. Its own
              drawer, so it rises and leaves as a sheet does and the one under
              it is still there; inside that one's, so the two are stacked
              rather than merely overlapping. */}
          <Drawer
            nested
            open={top() !== null}
            onClose={closeTop}
            dismissible={false}
            flush
            side={side()}
            snapPoints={wide() ? undefined : SNAP_POINTS}
            initialSnap={READING}
            label={t("rail", lang())}
            class="max-w-[26rem]"
          >
            <div class={pane()}>
              <SheetBody
                sheet={topShown()}
                lang={lang()}
                here={here()}
                onStation={(id) => openOnTop({ kind: "station", id })}
                onLine={(code) => openOnTop({ kind: "line", code })}
                onClose={closeTop}
              />
            </div>
          </Drawer>
        </Drawer>
      </div>
    </Page>
  );
}

/**
 * A sheet's contents as they were last non-empty: what it shows while it
 * slides away, when what it was showing is already gone.
 */
function retained(source: () => Sheet): () => Sheet {
  const [kept, setKept] = createSignal<Sheet>(null);
  createEffect(
    () => source(),
    (s) => {
      if (s) setKept(s);
    },
  );
  return kept;
}

/** What a sheet holds: the station, or the line. */
function SheetBody(props: {
  sheet: Sheet;
  lang: Lang;
  here: string | null;
  onStation: (id: string) => void;
  onLine: (code: string) => void;
  onClose: () => void;
}) {
  const station = () => (props.sheet?.kind === "station" ? props.sheet.id : null);
  const line = () => (props.sheet?.kind === "line" ? props.sheet.code : null);
  const lines = () => props.sheet?.kind === "lines";
  return (
    <>
      <Show when={station()}>
        {(id) => (
          <StationSheet
            id={id()}
            lang={props.lang}
            here={props.here === id()}
            onLine={props.onLine}
            onClose={props.onClose}
          />
        )}
      </Show>
      <Show when={lines()}>
        <LinesSheet lang={props.lang} onLine={props.onLine} onClose={props.onClose} />
      </Show>
      <Show when={line()}>
        {(code) => (
          <LineSheet
            code={code()}
            lang={props.lang}
            here={props.here}
            onStation={props.onStation}
            onClose={props.onClose}
          />
        )}
      </Show>
    </>
  );
}

/**
 * Every line, for "all" in the key: in the order the railway's own map lists
 * them, each a row that opens the line - over this list, so the list is
 * still there when the line is closed. The same list the key is, made into
 * something to read rather than something to decode a colour by.
 */
function LinesSheet(props: { lang: Lang; onLine: (code: string) => void; onClose: () => void }) {
  const db = useDb();
  const lines = createMemo(() => railLines(db()));
  const trams = createMemo(() => lightRailRoutes(db()));
  /* Four fifths of a station sheet's row: eleven of these are a list to scan,
     not eleven things to read, and the sheet they fill is a fifth lower. */
  const row = "app-tap flex w-full items-center gap-2.5 px-3.5 py-1.5 text-left";
  const name = "min-w-0 grow truncate text-[0.7rem] font-bold text-foreground";
  const count = "tnum shrink-0 text-[0.6rem] font-medium text-subtle-foreground";

  return (
    <div class="flex flex-col pb-2.5">
      <DrawerHeader title={t("allLines", props.lang)}>
        <span class="text-[0.75rem] font-medium text-subtle-foreground">
          {t("networkMap", props.lang)}
        </span>
      </DrawerHeader>

      <For each={lines()}>
        {(line) => (
          <button type="button" onClick={() => props.onLine(line.code)} class={row}>
            <RoutePlate route={line.code} co={["mtr"]} size="xs" />
            <span class={name}>{pick(line.name, props.lang)}</span>
            <span class={count}>
              {line.stations} {t("stops", props.lang)}
            </span>
            <span class="shrink-0 text-faint-foreground">
              <ChevronRightIcon size={11} />
            </span>
          </button>
        )}
      </For>

      <Show when={trams().length > 0}>
        <button type="button" onClick={() => props.onLine(LIGHT_RAIL)} class={row}>
          <RoutePlate route={OPERATORS.lightRail.short[props.lang]} co={["lightRail"]} size="xs" />
          <span class={name}>{OPERATORS.lightRail.name[props.lang]}</span>
          <span class={count}>
            {trams().length} {t("routes", props.lang)}
          </span>
          <span class="shrink-0 text-faint-foreground">
            <ChevronRightIcon size={11} />
          </span>
        </button>
      </Show>
    </div>
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
      <DrawerHeader title={name()}>
        <Show when={props.here}>
          <Chip tone="accent" class="shrink-0">
            <PinIcon size={11} />
            {t("youAreHere", props.lang)}
          </Chip>
        </Show>
      </DrawerHeader>

      <For each={lines()}>
        {(line) => (
          <div class="flex flex-col gap-2 px-4 pb-3">
            <button
              type="button"
              onClick={() => props.onLine(line.code)}
              class="app-press flex items-center gap-3 rounded-lg py-1 text-left"
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
        <div class="flex flex-col gap-2 px-4 pb-3">
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

      <div class="mx-4 h-px bg-border" />
      <a {...useLinkProps(stopLink(props.id))} class="app-tap flex items-center gap-3 px-4 py-2.5">
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
            >
              <span class="tnum text-[0.75rem] font-medium text-subtle-foreground">
                {trams().length} {t("routes", props.lang)}
              </span>
            </DrawerHeader>
            <For each={trams()}>
              {(route) => (
                <a
                  {...useLinkProps(routeLink(route.key))}
                  class="app-tap flex items-center gap-3 px-4 py-2"
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
                  class="app-tap flex items-center gap-3 px-4 py-2"
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

          <div class="px-4 pb-1 pt-2">
            <SectionLabel>{t("lineStations", props.lang)}</SectionLabel>
          </div>

          <For each={stations()}>
            {(station, index) => (
              <button
                type="button"
                onClick={() => props.onStation(station.id)}
                class="app-tap flex w-full items-center gap-3 px-4 py-2 text-left"
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
