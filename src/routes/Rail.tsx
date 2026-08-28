import { For, Show, createMemo } from "solid-js";
import { Card, EmptyState, Hairline, ScreenTitle, SectionLabel } from "~/components/Chrome";
import { ChevronRightIcon } from "~/components/Icons";
import { CardColumnItem, CardColumns, Page, Section } from "~/components/Layout";
import { RoutePlate } from "~/components/RoutePlate";
import { routeHref } from "~/components/RouteRow";
import { useDb } from "~/data/context";
import { lightRailRoutes, railLines, type RailLine } from "~/data/rail";
import type { KeyedRoute } from "~/data/types";
import { pick, t, type Lang } from "~/lib/i18n";
import { OPERATORS } from "~/lib/operators";
import { settings } from "~/stores/settings";

/**
 * One line, with every direction it runs.
 *
 * A rider picks a line first and a direction second - "the red line, towards
 * Tsuen Wan" - so the card is the line and the rows inside it are the choice
 * that actually has to be made.
 */
function LineCard(props: { line: RailLine; lang: Lang }) {
  return (
    <Card>
      <div class="flex items-center gap-3 px-3.5 pb-2 pt-3">
        <RoutePlate route={props.line.code} co={["mtr"]} size="md" />
        <div class="flex min-w-0 grow flex-col gap-0.5">
          <span class="truncate text-[0.88rem] font-bold tracking-[-0.01em] text-foreground">
            {pick(props.line.name, props.lang)}
          </span>
          <span class="tnum truncate text-[0.63rem] font-medium text-subtle-foreground">
            {props.line.stations} {t("stops", props.lang)}
          </span>
        </div>
      </div>

      <For each={props.line.directions}>
        {(route, index) => (
          <>
            <Show when={index() === 0}>
              <Hairline />
            </Show>
            <a href={routeHref(route.key)} class="mb-tap flex items-center gap-3 px-3.5 py-2.5">
              <span class="min-w-0 grow truncate text-[0.82rem] font-bold text-foreground">
                {t("towards", props.lang)} {pick(route.dest, props.lang)}
              </span>
              <span class="truncate text-[0.63rem] font-medium text-subtle-foreground">
                {pick(route.orig, props.lang)}
              </span>
              <span class="shrink-0 text-faint-foreground">
                <ChevronRightIcon size={14} />
              </span>
            </a>
            <Show when={index() < props.line.directions.length - 1}>
              <Hairline />
            </Show>
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
      <span class="min-w-0 grow truncate text-[0.82rem] font-bold text-foreground">
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
      <ScreenTitle title={t("rail", lang())} subtitle="Rail" />

      <Show
        when={lines().length > 0 || light().length > 0}
        fallback={<EmptyState title={t("noResults", lang())} />}
      >
        <Show when={lines().length > 0}>
          <Section>
            <SectionLabel
              trailing={
                <span class="tnum text-[0.63rem] font-semibold text-faint-foreground">
                  {lines().length}
                </span>
              }
            >
              {`${OPERATORS.mtr.name[lang()]} MTR`}
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
                <span class="tnum text-[0.63rem] font-semibold text-faint-foreground">
                  {light().length}
                </span>
              }
            >
              {`${OPERATORS.lightRail.name[lang()]} Light Rail`}
            </SectionLabel>

            <Card>
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
