import { For, Show, createMemo } from "solid-js";
import { Card, EmptyState, Hairline, ScreenTitle, SectionLabel } from "~/components/Chrome";
import { ChevronRightIcon } from "~/components/Icons";
import { CardColumnItem, CardColumns, Page, Section } from "~/components/Layout";
import { RoutePlate } from "~/components/RoutePlate";
import { routeHref } from "~/components/RouteRow";
import { useDb } from "~/data/context";
import { lightRailRoutes, lineName, lineStations, railLines, type RailLine } from "~/data/rail";
import type { KeyedRoute } from "~/data/types";
import { pick, t, type Lang } from "~/lib/i18n";
import { OPERATORS, plateStyle } from "~/lib/operators";
import { settings } from "~/stores/settings";

/**
 * One line, with every direction it runs.
 *
 * A rider picks a line first and a direction second - "the red line, towards
 * Tsuen Wan" - so the card is the line, and the colour is how the line is
 * actually named out loud. The header opens the line itself, where the choice
 * is a station rather than a direction; the rows under it are the shortcut for
 * when the direction is already known.
 */
function LineCard(props: { line: RailLine; lang: Lang }) {
  const db = useDb();
  const colour = () => plateStyle(["mtr"], props.line.code).background;
  /** Stations on this line you can change trains at. */
  const interchanges = createMemo(
    () => lineStations(db(), props.line).filter((s) => s.interchanges.length > 0).length,
  );

  return (
    <Card>
      <div class="h-1 w-full" style={{ background: colour() }} aria-hidden="true" />

      <a
        href={`/rail/${encodeURIComponent(props.line.code)}`}
        class="mb-tap flex items-center gap-3 px-3.5 py-3"
      >
        <RoutePlate route={props.line.code} co={["mtr"]} size="md" />
        <div class="flex min-w-0 grow flex-col gap-0.5">
          <span class="truncate text-[0.94rem] font-bold tracking-[-0.01em] text-foreground">
            {pick(lineName(props.line.code), props.lang)}
          </span>
          <span class="tnum truncate text-[0.75rem] font-medium text-subtle-foreground">
            {props.line.stations} {t("stops", props.lang)}
            <Show when={interchanges() > 0}>
              {" · "}
              {interchanges()} {t("interchange", props.lang)}
            </Show>
          </span>
        </div>
        <span class="shrink-0 text-faint-foreground">
          <ChevronRightIcon size={15} />
        </span>
      </a>

      <For each={props.line.directions}>
        {(route) => (
          <>
            <Hairline />
            <a href={routeHref(route.key)} class="mb-tap flex items-center gap-2.5 px-3.5 py-2.5">
              <span
                class="size-2 shrink-0 rounded-full"
                style={{ background: colour() }}
                aria-hidden="true"
              />
              <span class="min-w-0 grow truncate text-[0.88rem] font-bold text-foreground">
                {t("towards", props.lang)} {pick(route.dest, props.lang)}
              </span>
              <span class="truncate text-[0.75rem] font-medium text-subtle-foreground">
                {pick(route.orig, props.lang)}
              </span>
            </a>
          </>
        )}
      </For>
    </Card>
  );
}

/** Light rail is genuinely route-numbered, so it stays a list of routes. */
function LightRailRow(props: { route: KeyedRoute; lang: Lang }) {
  return (
    <a href={routeHref(props.route.key)} class="mb-tap flex items-center gap-3 px-3.5 py-2.5">
      <RoutePlate route={props.route.route} co={props.route.co} size="sm" />
      <span class="min-w-0 grow truncate text-[0.88rem] font-bold text-foreground">
        {t("towards", props.lang)} {pick(props.route.dest, props.lang)}
      </span>
      <span class="shrink-0 text-faint-foreground">
        <ChevronRightIcon size={14} />
      </span>
    </a>
  );
}

/**
 * The railway, as a railway.
 *
 * It was reachable only as 50 entries in a category list sorted by route
 * number, which put all twenty-seven light rail routes above the ten MTR lines
 * - so the underground was, in practice, missing. Rail is a small, fixed,
 * memorised network and deserves to be shown as one.
 */
export default function Rail() {
  const db = useDb();
  const lang = settings.lang;

  const lines = createMemo(() => railLines(db()));
  const light = createMemo(() => lightRailRoutes(db()));

  return (
    <Page wide>
      <ScreenTitle title={t("rail", lang())} />

      <Show
        when={lines().length > 0 || light().length > 0}
        fallback={<EmptyState title={t("noResults", lang())} />}
      >
        <Show when={lines().length > 0}>
          <Section>
            <SectionLabel
              trailing={
                <span class="tnum text-[0.75rem] font-semibold text-faint-foreground">
                  {lines().length}
                </span>
              }
            >
              {OPERATORS.mtr.name[lang()]}
            </SectionLabel>

            <CardColumns>
              <For each={lines()}>
                {(line, index) => (
                  <CardColumnItem
                    class="motion-safe:mb-rise"
                    style={{ "animation-delay": `${Math.min(index(), 8) * 24}ms` }}
                  >
                    <LineCard line={line} lang={lang()} />
                  </CardColumnItem>
                )}
              </For>
            </CardColumns>
          </Section>
        </Show>

        <Show when={light().length > 0}>
          <Section>
            <SectionLabel
              trailing={
                <span class="tnum text-[0.75rem] font-semibold text-faint-foreground">
                  {light().length}
                </span>
              }
            >
              {OPERATORS.lightRail.name[lang()]}
            </SectionLabel>

            {/* A row is a row on any screen: the light rail list keeps the
                column width the rest of the app reads at rather than stretching
                a route number away from its terminus. */}
            <Card class="lg:max-w-[42rem]">
              <For each={light()}>
                {(route, index) => (
                  <>
                    <Show when={index() > 0}>
                      <Hairline />
                    </Show>
                    <LightRailRow route={route} lang={lang()} />
                  </>
                )}
              </For>
            </Card>
          </Section>
        </Show>
      </Show>
    </Page>
  );
}
