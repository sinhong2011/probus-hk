import { useParams } from "@solidjs/router";
import { For, Show, createMemo, createSignal } from "solid-js";
import { Card, Chip, EmptyState, Hairline, Reveal, SectionLabel } from "~/components/Chrome";
import { Trail } from "~/components/Breadcrumb";
import { ChevronRightIcon, PinIcon } from "~/components/Icons";
import { EtaCountdown } from "~/components/EtaCountdown";
import { Page, Section } from "~/components/Layout";
import { RoutePlate } from "~/components/RoutePlate";
import { routeHref } from "~/components/RouteRow";
import { useDb } from "~/data/context";
import { lineName, lineStations, railLine, type RailLine, type RailStation } from "~/data/rail";
import { serviceSpan } from "~/data/schedule";
import type { KeyedRoute } from "~/data/types";
import { useEta } from "~/data/useEta";
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
  const params = useParams<{ code: string }>();
  const lang = settings.lang;
  const { position } = useGeolocation();

  const code = () => decodeURIComponent(params.code).toUpperCase();
  const line = createMemo(() => railLine(db(), code()));
  const stations = createMemo(() => {
    const l = line();
    return l ? lineStations(db(), l) : [];
  });

  const [openId, setOpenId] = createSignal<string | null>(null);

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
    <Page wide>
      <Trail extra={[{ href: "/rail", label: t("rail", lang()) }]} />

      <Show when={line()} fallback={<EmptyState title={t("noResults", lang())} />}>
        {(l) => (
          <>
            <LineHeader line={l()} lang={lang()} count={stations().length} />

            <Section>
              <SectionLabel
                trailing={
                  <span class="text-[0.75rem] font-semibold text-faint-foreground">
                    {t("tapStation", lang())}
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
                      open={openId() === station.id}
                      onToggle={() =>
                        setOpenId((current) => (current === station.id ? null : station.id))
                      }
                    />
                  )}
                </For>
              </Card>
            </Section>
          </>
        )}
      </Show>
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
              <a href={routeHref(route.key)} class="mb-tap flex items-center gap-3 px-3.5 py-2.5">
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

/**
 * A station on the spine.
 *
 * Closed it is a name, the lines you can change to, and where you are. Open it
 * is both directions' next trains - which is one request, not two: the feed
 * answers per line and station, and the two directions come out of the same
 * response.
 */
function StationRow(props: {
  station: RailStation;
  line: RailLine;
  lang: Lang;
  first: boolean;
  last: boolean;
  here: boolean;
  open: boolean;
  onToggle: () => void;
}) {
  const colour = () => lineColor(props.line.code);

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
        class="mb-tap flex w-full items-center gap-3 px-3.5 py-2.5 text-left"
      >
        {/* The line, drawn. The negative margin cancels the row's padding so
            one row's spine meets the next one's rather than stopping short. */}
        <div class="-my-2.5 flex w-3.5 shrink-0 flex-col items-center self-stretch">
          <div
            class="w-[3px] shrink-0"
            style={{ height: "18px", background: props.first ? "transparent" : colour() }}
          />
          <div
            class={["shrink-0 rounded-full", props.here ? "size-3" : "size-2.5"]}
            style={{
              background: props.here ? colour() : "var(--card)",
              border: `3px solid ${colour()}`,
              "box-shadow": props.here
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
    </div>
  );
}

/** One direction's next trains from this station, with its platform. */
function DirectionTrains(props: {
  route: KeyedRoute;
  stationId: string;
  lang: Lang;
  active: boolean;
}) {
  /** 1-based position of the station along this direction, or 0 if it is not on it. */
  const seq = createMemo(() => (props.route.stops.mtr?.indexOf(props.stationId) ?? -1) + 1);

  const etas = useEta(() =>
    // Closed rows ask for nothing: a thirty-station line would otherwise poll
    // sixty feeds to fill a screen showing none of them.
    props.active && seq() > 0
      ? { route: props.route, seq: seq(), stopIdByCo: { mtr: props.stationId } }
      : null,
  );

  return (
    <Show when={seq() > 0}>
      <div class="flex items-center gap-2.5 rounded-lg bg-secondary px-3 py-2">
        <div class="flex min-w-0 grow flex-col gap-0.5">
          <span class="truncate text-[0.88rem] font-bold text-foreground">
            {t("towards", props.lang)} {pick(props.route.dest, props.lang)}
          </span>
          <span class="truncate text-[0.75rem] font-medium text-subtle-foreground">
            {t("nextTrains", props.lang)}
          </span>
        </div>
        <EtaCountdown etas={etas()} lang={props.lang} size="sm" limit={3} />
      </div>
    </Show>
  );
}
