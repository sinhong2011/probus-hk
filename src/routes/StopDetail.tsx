import { useParams } from "@solidjs/router";
import { uniqBy } from "es-toolkit";
import { For, Show, createMemo } from "solid-js";
import { Card, Chip, EmptyState, Hairline, SectionLabel } from "~/components/Chrome";
import { Trail } from "~/components/Breadcrumb";
import { Page, Section } from "~/components/Layout";
import { WalkIcon } from "~/components/Icons";
import { RouteLine } from "~/components/RouteRow";
import { useDb } from "~/data/context";
import { routesAtCluster } from "~/data/db";
import { etaKey, fetchStopEtas } from "~/data/eta/batch";
import { createAsyncMemo } from "~/lib/async";
import { distanceM, formatDistance, walkMinutes } from "~/lib/geo";
import { pick, stopCode, stripStopCode, t } from "~/lib/i18n";
import { etaTick } from "~/stores/clock";
import { useGeolocation } from "~/stores/geolocation";
import { settings } from "~/stores/settings";

export default function StopDetail() {
  const db = useDb();
  const params = useParams<{ id: string }>();
  const lang = settings.lang;
  const { position } = useGeolocation();

  const stopId = () => decodeURIComponent(params.id);
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

  const etas = createAsyncMemo(async () => {
    etaTick();
    const list = routes();
    if (list.length === 0) return new Map<string, never[]>();
    try {
      return await fetchStopEtas(db(), stopId(), list);
    } catch {
      return new Map<string, never[]>();
    }
  });

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
      <Trail />

      <Show when={stop()} fallback={<EmptyState title={t("noResults", lang())} />}>
        {(entry) => (
          <>
            <div class="flex flex-col gap-1.5">
              <h1 class="text-[1.55rem] font-bold leading-[1.1] tracking-[-0.035em] text-foreground">
                {stripStopCode(pick(entry().name, lang()))}
              </h1>
              <span class="text-[0.75rem] font-semibold text-subtle-foreground">
                {stripStopCode(pick(entry().name, lang() === "zh" ? "en" : "zh"))}
              </span>
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
              <Show when={stopCode(pick(entry().name, "en"))}>
                {(code) => (
                  <Chip>
                    <span class="tnum">{code()}</span>
                  </Chip>
                )}
              </Show>
            </div>

            <Section>
              <SectionLabel
                trailing={
                  <span class="text-[0.63rem] font-semibold text-primary">
                    {lang() === "zh" ? "按時間排序" : "By arrival"}
                  </span>
                }
              >
                {`${t("routesHere", lang())} Routes here`}
              </SectionLabel>

              <Show
                when={ordered().length > 0}
                fallback={<EmptyState title={t("noService", lang())} />}
              >
                <Card>
                  <For each={ordered()}>
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
                          plateSize="md"
                          countdownSize="lg"
                        />
                      </>
                    )}
                  </For>
                </Card>
              </Show>
            </Section>
          </>
        )}
      </Show>
    </Page>
  );
}
