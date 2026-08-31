import { useParams } from "@tanstack/solid-router";
import { uniqBy } from "es-toolkit";
import { For, Show, createMemo } from "solid-js";
import { Chip, EmptyState, SectionLabel, StopCode } from "~/components/Chrome";
import { Page, RowCard, Section } from "~/components/Layout";
import { WalkIcon } from "~/components/Icons";
import { RouteLine } from "~/components/RouteRow";
import { useDb } from "~/data/context";
import { NotFound } from "~/routes/NotFound";
import { routesAtCluster } from "~/data/db";
import { useStopEtas } from "~/data/useStopEtas";
import { etaKey } from "~/data/eta/batch";
import { distanceM, formatDistance, walkMinutes } from "~/lib/geo";
import { pick, stripStopCode, t } from "~/lib/i18n";
import { useGeolocation } from "~/stores/geolocation";
import { settings } from "~/stores/settings";

export default function StopDetail() {
  const db = useDb();
  const params = useParams({ from: "/stop/$id" });
  const lang = settings.lang;
  const { position } = useGeolocation();

  const stopId = () => params().id;
  const stop = () => db().stopList[stopId()];

  /** Every operator's id for this kerb, so nothing is missed. */
  const memberIds = createMemo(() => {
    const ids = new Set<string>([stopId()]);
    for (const [, alias] of db().stopMap[stopId()] ?? []) ids.add(alias);
    return [...ids];
  });

  const routes = createMemo(() =>
    // The same route number can call here as several service types; to a
    // passenger waiting at the kerb they are one line.
    uniqBy(routesAtCluster(db(), memberIds()), (at) => `${at.route.route}/${at.route.dest.en}`),
  );

  const etas = useStopEtas(stopId, routes);

  const ordered = createMemo(() => {
    const map = etas();
    return routes()
      .map((at) => {
        const list = map?.get(etaKey(at.route.key)) ?? [];
        return { at, etas: list, next: list[0]?.at.getTime() ?? Number.POSITIVE_INFINITY };
      })
      .sort((a, b) => a.next - b.next);
  });

  const metres = () => {
    const here = position();
    const s = stop();
    return here && s ? distanceM(here, s.location) : null;
  };

  return (
    <Page>
      <Show when={stop()} fallback={<NotFound kind="stop" />}>
        {(entry) => (
          <>
            {/* The name in the language being read, and the pole code beside
                it. The same name in the other language was a translation
                exercise; the code is the thing printed on the flag you are
                standing at, and the one a rider can search for. */}
            <div class="flex flex-wrap items-center gap-2.5">
              <h1 class="text-[1.55rem] font-bold leading-[1.1] tracking-[-0.035em] text-foreground">
                {stripStopCode(pick(entry().name, lang()))}
              </h1>
              <StopCode name={entry().name} lang={lang()} class="text-[0.81rem]" />
            </div>

            <div class="-mt-3 flex flex-wrap items-center gap-2">
              <Show when={metres() !== null}>
                <Chip tone="accent">
                  <WalkIcon size={12} />
                  <span class="tnum">
                    {formatDistance(metres() as number)} · {walkMinutes(metres() as number)}{" "}
                    {t("minute", lang())}
                  </span>
                </Chip>
              </Show>
              <Chip>
                <span class="tnum">
                  {routes().length} {lang() === "zh" ? "條路線" : "routes"}
                </span>
              </Chip>
            </div>

            <Section>
              <SectionLabel
                trailing={
                  <span class="text-[0.75rem] font-semibold text-primary">
                    {lang() === "zh" ? "按時間排序" : "By arrival"}
                  </span>
                }
              >
                {t("routesHere", lang())}
              </SectionLabel>

              <Show
                when={ordered().length > 0}
                fallback={<EmptyState title={t("noService", lang())} />}
              >
                {/* Every line calling at this kerb, soonest first. A wide
                    window wraps them into columns: forty routes stretched one
                    per full-width row is a list you have to scroll to read. */}
                <RowCard>
                  <For each={ordered()}>
                    {(row) => (
                      <RouteLine
                        route={row.at.route}
                        seq={row.at.seq}
                        lang={lang()}
                        etas={row.etas}
                        plateSize="md"
                        countdownSize="lg"
                      />
                    )}
                  </For>
                </RowCard>
              </Show>
            </Section>
          </>
        )}
      </Show>
    </Page>
  );
}
