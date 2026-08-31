import { useLinkProps, useParams } from "@tanstack/solid-router";
import { For, Show, createMemo } from "solid-js";
import { EmptyState, ScreenTitle, SectionLabel, SpecialTag } from "~/components/Chrome";
import { Page, RowCard, Section } from "~/components/Layout";
import { ChevronRightIcon, SortIcon } from "~/components/Icons";
import { RoutePlate } from "~/components/RoutePlate";
import { VirtualRows } from "~/components/VirtualRows";
import { useDb } from "~/data/context";
import { isSpecialService } from "~/data/db";
import { CATEGORIES, categoryById, categoryCounts, routesInCategory } from "~/data/categories";
import type { KeyedRoute } from "~/data/types";
import { fareLabel } from "~/lib/format";
import { pick, t, type Lang, type MessageKey } from "~/lib/i18n";
import { browseLink, routeLink } from "~/lib/links";
import { operatorLabel } from "~/lib/operators";
import { settings } from "~/stores/settings";
import {
  createColumnHelper,
  createSortedRowModel,
  createTable,
  rowSortingFeature,
  sortFns,
  tableFeatures,
} from "~/lib/tanstack/table";

/*
 * The shape of the category table, built once. A route in a category is a
 * row with three things worth ordering it by: its number, read the way a
 * rider reads it (1, 2, 10 - not 1, 10, 2), what it costs, and who runs it.
 */
const features = tableFeatures({
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
  sortFns,
});
const column = createColumnHelper<typeof features, KeyedRoute>();
const columns = column.columns([
  column.accessor("route", { id: "route", sortFn: "alphanumeric" }),
  column.accessor((route) => route.fares?.[0] ?? undefined, {
    id: "fare",
    sortFn: (a, b) => Number(a.getValue("fare")) - Number(b.getValue("fare")),
    // A route with no published fare goes to the end, whichever way round.
    sortUndefined: "last",
  }),
  column.accessor((route) => route.co[0] ?? "", { id: "operator", sortFn: "text" }),
]);

const SORTS: { id: "route" | "fare" | "operator"; label: MessageKey }[] = [
  { id: "route", label: "sortRoute" },
  { id: "fare", label: "sortFare" },
  { id: "operator", label: "sortOperator" },
];

/**
 * Hong Kong riders already think in categories - "an N route", "an A bus" - so
 * this turns that into a browsable index for the times you know the kind of
 * journey you want but not the number.
 */
export default function Browse() {
  const db = useDb();
  const params = useParams({ strict: false });
  const lang = settings.lang;

  const category = () => {
    const id = params().id;
    return id ? categoryById(id) : undefined;
  };
  const counts = createMemo(() => categoryCounts(db()));
  const routes = createMemo(() => {
    const chosen = category();
    return chosen ? routesInCategory(db(), chosen) : [];
  });

  return (
    <Show
      when={category()}
      fallback={
        <Page>
          <ScreenTitle title={t("categories", lang())} />

          <div class="grid grid-cols-2 gap-2.5 lg:grid-cols-4 lg:gap-4 2xl:grid-cols-5">
            <For each={CATEGORIES}>
              {(item) => (
                <a
                  {...useLinkProps(browseLink(item.id))}
                  class="app-press flex flex-col justify-between gap-3 rounded-xl bg-card p-3.5 shadow-card motion-safe:app-rise"
                >
                  <span
                    class="h-1 w-8 rounded-full"
                    style={{ background: item.accent }}
                    aria-hidden="true"
                  />
                  <div class="flex flex-col gap-1">
                    <span class="text-[0.94rem] font-bold tracking-[-0.01em] text-foreground">
                      {pick(item.name, lang())}
                    </span>
                    <span class="text-[0.75rem] font-medium leading-snug text-subtle-foreground">
                      {pick(item.hint, lang())}
                    </span>
                  </div>
                  <span class="tnum text-[0.75rem] font-bold" style={{ color: item.accent }}>
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
          <ScreenTitle title={pick(chosen().name, lang())} subtitle={pick(chosen().hint, lang())} />

          <CategoryTable routes={routes()} lang={lang()} />
        </Page>
      )}
    </Show>
  );
}

/**
 * The routes in one category, as a table that reads as a list.
 *
 * On a phone it is rows; on a wide window the same rows with the order
 * chosen from a strip of chips rather than column headings. Every chip says
 * what it is doing - the one in charge carries an arrow for its direction -
 * so nothing has to be hovered to be understood. Pressing the one in charge
 * turns it round; pressing another hands the order to it, ascending.
 */
function CategoryTable(props: { routes: KeyedRoute[]; lang: Lang }) {
  const table = createTable({
    features,
    columns,
    get data() {
      return props.routes;
    },
    initialState: { sorting: [{ id: "route", desc: false }] },
  });

  const sorted = (id: string) => table.getColumn(id)?.getIsSorted() ?? false;

  return (
    <Section>
      <SectionLabel
        trailing={
          <span class="tnum text-[0.75rem] font-semibold text-faint-foreground">
            {props.routes.length} {t("routesCount", props.lang)}
          </span>
        }
      >
        {t("routes", props.lang)}
      </SectionLabel>

      <Show
        when={props.routes.length > 0}
        fallback={<EmptyState title={t("noResults", props.lang)} />}
      >
        <div
          role="group"
          aria-label={t("sortBy", props.lang)}
          class="flex flex-wrap items-center gap-1.5"
        >
          <span class="mr-1 flex items-center gap-1 text-[0.75rem] font-bold text-faint-foreground">
            <SortIcon size={12} />
            {t("sortBy", props.lang)}
          </span>
          <For each={SORTS}>
            {(sort) => {
              const on = () => sorted(sort.id) !== false;
              return (
                <button
                  type="button"
                  aria-pressed={on() ? "true" : "false"}
                  onClick={() => table.getColumn(sort.id)?.toggleSorting()}
                  class={[
                    "app-press flex h-8 items-center gap-1 rounded-full px-3 text-[0.81rem] font-bold transition-colors duration-state",
                    {
                      "bg-primary text-primary-foreground": on(),
                      "bg-secondary text-muted-foreground hover:text-foreground": !on(),
                    },
                  ]}
                >
                  {t(sort.label, props.lang)}
                  <Show when={on()}>
                    <span aria-hidden="true" class="tnum">
                      {sorted(sort.id) === "desc" ? "↓" : "↑"}
                    </span>
                  </Show>
                </button>
              );
            }}
          </For>
        </div>

        <RowCard>
          <VirtualRows items={table.getRowModel().rows} estimate={58} divided>
            {(row) => <RouteRowItem route={row.original} lang={props.lang} />}
          </VirtualRows>
        </RowCard>
      </Show>
    </Section>
  );
}

function RouteRowItem(props: { route: KeyedRoute; lang: Lang }) {
  return (
    <a
      {...useLinkProps(routeLink(props.route.key))}
      class="app-tap flex items-center gap-3 px-3.5 py-2.5"
    >
      <RoutePlate route={props.route.route} co={props.route.co} size="sm" />
      <div class="flex min-w-0 grow flex-col gap-0.5">
        <span class="flex min-w-0 items-center gap-1.5">
          <span class="truncate text-[0.88rem] font-bold tracking-[-0.01em] text-foreground">
            {pick(props.route.orig, props.lang)} → {pick(props.route.dest, props.lang)}
          </span>
          <Show when={isSpecialService(props.route)}>
            <SpecialTag lang={props.lang} />
          </Show>
        </span>
        <span class="truncate text-[0.75rem] font-medium text-subtle-foreground">
          {[operatorLabel(props.route.co, props.lang), fareLabel(props.route.fares?.[0])]
            .filter(Boolean)
            .join(" · ")}
        </span>
      </div>
      <span class="text-faint-foreground">
        <ChevronRightIcon size={15} />
      </span>
    </a>
  );
}
