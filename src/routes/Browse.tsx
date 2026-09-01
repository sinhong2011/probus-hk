import { useLinkProps, useParams } from "@tanstack/solid-router";
import { For, Show, createMemo, createSignal } from "solid-js";
import { CategoryIcon } from "~/components/CategoryIcon";
import { EmptyState, ScreenTitle, SectionLabel, SpecialTag } from "~/components/Chrome";
import { Page, RowCard, Section } from "~/components/Layout";
import { ChevronRightIcon, SortIcon } from "~/components/Icons";
import { RoutePlate } from "~/components/RoutePlate";
import { VirtualRows } from "~/components/VirtualRows";
import { useDb } from "~/data/context";
import { isSpecialService } from "~/data/db";
import {
  CATEGORIES,
  categoryById,
  categoryCounts,
  pairDirections,
  routesInCategory,
  scenicGroups,
  type RoutePair,
} from "~/data/categories";
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
// A row is the route, both directions of it - so the sort keys read off the
// outward leg and the pair travels together whichever order is chosen.
const column = createColumnHelper<typeof features, RoutePair>();
const columns = column.columns([
  column.accessor((pair) => pair.out.route, { id: "route", sortFn: "alphanumeric" }),
  column.accessor((pair) => pair.out.fares?.[0] ?? undefined, {
    id: "fare",
    sortFn: (a, b) => Number(a.getValue("fare")) - Number(b.getValue("fare")),
    // A route with no published fare goes to the end, whichever way round.
    sortUndefined: "last",
  }),
  column.accessor((pair) => pair.out.co[0] ?? "", { id: "operator", sortFn: "text" }),
]);

type SortId = "route" | "fare" | "operator";
const SORTS: { id: SortId; label: MessageKey }[] = [
  { id: "route", label: "sortRoute" },
  { id: "fare", label: "sortFare" },
  { id: "operator", label: "sortOperator" },
];

/**
 * The strip of chips an order is chosen from. Every chip says what it is
 * doing - the one in charge carries an arrow for its direction - so nothing
 * has to be hovered to be understood. Pressing the one in charge turns it
 * round; pressing another hands the order to it, ascending.
 */
function SortStrip(props: {
  lang: Lang;
  sorted: (id: SortId) => false | "asc" | "desc";
  onToggle: (id: SortId) => void;
}) {
  return (
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
          const on = () => props.sorted(sort.id) !== false;
          return (
            <button
              type="button"
              aria-pressed={on() ? "true" : "false"}
              onClick={() => props.onToggle(sort.id)}
              class={[
                "app-press flex h-8 items-center gap-1 rounded-full px-3 text-[0.81rem] font-bold leading-none transition-colors duration-state",
                {
                  "bg-primary text-primary-foreground": on(),
                  "bg-secondary text-muted-foreground hover:text-foreground": !on(),
                },
              ]}
            >
              {t(sort.label, props.lang)}
              {/* Held even while off, or lighting a sort grew the chip and
                  the row wrapped under it. */}
              <span aria-hidden="true" class={["tnum w-3 text-center", { invisible: !on() }]}>
                {props.sorted(sort.id) === "desc" ? "↓" : "↑"}
              </span>
            </button>
          );
        }}
      </For>
    </div>
  );
}

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
                  {/* The category's glyph, in its own colour on a wash of
                      it. Seventeen cards of identical shape were told apart
                      only by reading each title; a picture is read first. */}
                  <span
                    class="flex size-9 items-center justify-center rounded-lg"
                    style={{
                      background: `color-mix(in srgb, ${item.accent} 14%, transparent)`,
                      color: item.accent,
                    }}
                  >
                    <CategoryIcon id={item.id} size={18} />
                  </span>
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

          {/* `createTable` reads its data during construction, outside any
              tracking scope - on a direct load that read arrives while the
              route database is still streaming in and throws. The `when`
              is a tracked read, so the wait lands on the loading boundary
              and the table is only built once there is data to build from. */}
          <Show when={routes()}>
            {(rows) => (
              <Show
                when={chosen().id === "tourism"}
                fallback={<CategoryTable routes={rows()} lang={lang()} />}
              >
                <ScenicTable lang={lang()} />
              </Show>
            )}
          </Show>
        </Page>
      )}
    </Show>
  );
}

/**
 * The sightseeing category, told by theme instead of by number.
 *
 * A flat table answers "what is in here" but not the question a rider brings
 * to this screen - which of these are the sea views, which climb the Peak -
 * so every curated series gets its own labelled card, in the curated order.
 */
const COMPARE: Record<SortId, (a: KeyedRoute, b: KeyedRoute) => number> = {
  route: (a, b) => a.route.localeCompare(b.route, "en", { numeric: true }),
  fare: (a, b) => Number(a.fares?.[0]) - Number(b.fares?.[0]),
  operator: (a, b) => (a.co[0] ?? "").localeCompare(b.co[0] ?? ""),
};

function ScenicTable(props: { lang: Lang }) {
  const db = useDb();
  const groups = createMemo(() => scenicGroups(db()));
  const [sort, setSort] = createSignal<{ id: SortId; desc: boolean }>({ id: "route", desc: false });

  const sorted = (id: SortId) => (sort().id === id ? (sort().desc ? "desc" : "asc") : false);
  const toggle = (id: SortId) =>
    setSort((current) => ({ id, desc: current.id === id && !current.desc }));

  // The chosen order holds within each series; the series themselves keep
  // the curated sequence, which is the point of the grouping.
  const ordered = (routes: KeyedRoute[]) => {
    const { id, desc } = sort();
    const unfared = (route: KeyedRoute) => id === "fare" && route.fares?.[0] === undefined;
    return [...routes].sort((a, b) => {
      // A route with no published fare goes to the end, whichever way round.
      if (unfared(a) !== unfared(b)) return unfared(a) ? 1 : -1;
      const order = COMPARE[id](a, b);
      return desc ? -order : order;
    });
  };

  return (
    <>
      <SortStrip lang={props.lang} sorted={sorted} onToggle={toggle} />
      <For each={groups()}>
        {(group) => (
          <Section>
            <SectionLabel
              trailing={
                <span class="tnum text-[0.75rem] font-semibold text-faint-foreground">
                  {group.routes.length} {t("routesCount", props.lang)}
                </span>
              }
            >
              {pick(group.series.name, props.lang)}
            </SectionLabel>
            {/* `single`: each pair is already the full row - the card's own
                column flow would fold pairs into quarter-width cells. */}
            <RowCard single>
              <For each={pairDirections(ordered(group.routes))}>
                {(pair) => <PairRow pair={pair} lang={props.lang} />}
              </For>
            </RowCard>
          </Section>
        )}
      </For>
    </>
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
  const pairs = createMemo(() => pairDirections(props.routes));
  const table = createTable({
    features,
    columns,
    get data() {
      return pairs();
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
        <SortStrip
          lang={props.lang}
          sorted={sorted}
          onToggle={(id) => table.getColumn(id)?.toggleSorting()}
        />

        {/* `single`: the virtual list is one full-width child; the card's
            column flow would hand it two of three columns and stop. */}
        <RowCard single>
          <VirtualRows items={table.getRowModel().rows} estimate={58} divided>
            {(row) => <PairRow pair={row.original} lang={props.lang} />}
          </VirtualRows>
        </RowCard>
      </Show>
    </Section>
  );
}

/**
 * One route, both ways. A wide window seats the return leg beside the outward
 * one - the pair reads as a single line, the way a rider thinks of it - and a
 * route with only one direction keeps the whole width. On a phone the legs
 * stack, divided, as any two rows are.
 */
function PairRow(props: { pair: RoutePair; lang: Lang }) {
  return (
    <Show
      when={props.pair.back}
      fallback={<RouteRowItem route={props.pair.out} lang={props.lang} />}
    >
      {(back) => (
        <div class="flex flex-col lg:grid lg:grid-cols-[1fr_1px_1fr]">
          <RouteRowItem route={props.pair.out} lang={props.lang} />
          {/* One divider, worn two ways: a hairline under the outward leg
              where the legs stack, the thin middle column where they sit
              side by side. */}
          <div aria-hidden="true" class="ml-3.5 h-px bg-border lg:ml-0 lg:h-auto lg:w-px" />
          <RouteRowItem route={back()} lang={props.lang} />
        </div>
      )}
    </Show>
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
