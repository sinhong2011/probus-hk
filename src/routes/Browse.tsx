import { useParams } from "@solidjs/router";
import { For, Show, createMemo } from "solid-js";
import { Card, EmptyState, Hairline, ScreenTitle, SectionLabel } from "~/components/Chrome";
import { Trail } from "~/components/Breadcrumb";
import { Page, Section } from "~/components/Layout";
import { ChevronRightIcon } from "~/components/Icons";
import { RoutePlate } from "~/components/RoutePlate";
import { routeHref } from "~/components/RouteRow";
import { useDb } from "~/data/context";
import { CATEGORIES, categoryById, categoryCounts, routesInCategory } from "~/data/categories";
import { fareLabel } from "~/lib/format";
import { pick, t } from "~/lib/i18n";
import { operatorLabel } from "~/lib/operators";
import { settings } from "~/stores/settings";

/**
 * Hong Kong riders already think in categories - "an N route", "an A bus" - so
 * this turns that into a browsable index for the times you know the kind of
 * journey you want but not the number.
 */
export default function Browse() {
  const db = useDb();
  const params = useParams<{ id?: string }>();
  const lang = settings.lang;

  const category = () => (params.id ? categoryById(params.id) : undefined);
  const counts = createMemo(() => categoryCounts(db()));
  const routes = createMemo(() => {
    const chosen = category();
    return chosen ? routesInCategory(db(), chosen) : [];
  });

  return (
    <Show
      when={category()}
      fallback={
        <Page wide>
          <ScreenTitle title={t("categories", lang())} subtitle="Categories" />

          <div class="grid grid-cols-2 gap-2.5 lg:grid-cols-4 lg:gap-4 2xl:grid-cols-5">
            <For each={CATEGORIES}>
              {(item) => (
                <a
                  href={`/browse/${item.id}`}
                  class="mb-press flex flex-col justify-between gap-3 rounded-xl border border-border bg-card p-3.5 shadow-card motion-safe:mb-rise"
                >
                  <span
                    class="h-1 w-8 rounded-full"
                    style={{ background: item.accent }}
                    aria-hidden="true"
                  />
                  <div class="flex flex-col gap-1">
                    <span class="text-[0.86rem] font-bold tracking-[-0.01em] text-foreground">
                      {pick(item.name, lang())}
                    </span>
                    <span class="text-[0.63rem] font-medium leading-snug text-subtle-foreground">
                      {pick(item.hint, lang())}
                    </span>
                  </div>
                  <span class="tnum text-[0.63rem] font-bold" style={{ color: item.accent }}>
                    {counts()[item.id]} {t("routesCount", lang())}
                  </span>
                </a>
              )}
            </For>
          </div>
        </Page>
      }
    >
      {(chosen) => (
        <Page>
          <div class="flex flex-col gap-3">
            <Trail extra={[{ href: "/browse", label: t("categories", lang()) }]} />
            <ScreenTitle
              title={pick(chosen().name, lang())}
              subtitle={pick(chosen().hint, lang())}
            />
          </div>

          <Section>
            <SectionLabel
              trailing={
                <span class="tnum text-[0.63rem] font-semibold text-faint-foreground">
                  {routes().length} {t("routesCount", lang())}
                </span>
              }
            >
              {`${t("routes", lang())} Routes`}
            </SectionLabel>

            <Show
              when={routes().length > 0}
              fallback={<EmptyState title={t("noResults", lang())} />}
            >
              <Card>
                <For each={routes()}>
                  {(route, index) => (
                    <>
                      <Show when={index() > 0}>
                        <Hairline />
                      </Show>
                      <a
                        href={routeHref(route.key)}
                        class="mb-tap flex items-center gap-3 px-3.5 py-2.5"
                      >
                        <RoutePlate route={route.route} co={route.co} size="sm" />
                        <div class="flex min-w-0 grow flex-col gap-0.5">
                          <span class="truncate text-[0.82rem] font-bold tracking-[-0.01em] text-foreground">
                            {pick(route.orig, lang())} → {pick(route.dest, lang())}
                          </span>
                          <span class="truncate text-[0.63rem] font-medium text-subtle-foreground">
                            {[operatorLabel(route.co, lang()), fareLabel(route.fares?.[0])]
                              .filter(Boolean)
                              .join(" · ")}
                          </span>
                        </div>
                        <span class="text-faint-foreground">
                          <ChevronRightIcon size={15} />
                        </span>
                      </a>
                    </>
                  )}
                </For>
              </Card>
            </Show>
          </Section>
        </Page>
      )}
    </Show>
  );
}
