import { For, Show, createMemo, createSignal } from "solid-js";
import { Card, EmptyState, Hairline, ScreenTitle, SectionLabel } from "~/components/Chrome";
import { SplitPage } from "~/components/Layout";
import { ModeSwitch } from "~/components/ModeSwitch";
import { BackspaceIcon, ChevronRightIcon, CloseIcon, SearchIcon } from "~/components/Icons";
import { RoutePlate } from "~/components/RoutePlate";
import { routeHref } from "~/components/RouteRow";
import { useDb } from "~/data/context";
import { CATEGORIES } from "~/data/categories";
import { nextRouteChars, routeAt, searchDestinations, searchRoutes, searchStops } from "~/data/db";
import type { KeyedRoute } from "~/data/types";
import { fareLabel } from "~/lib/format";
import { pick, stripStopCode, t, type Lang } from "~/lib/i18n";
import { operatorLabel } from "~/lib/operators";
import { frequent } from "~/stores/frequent";
import { settings } from "~/stores/settings";

/**
 * Hong Kong route numbers are short and alphanumeric, so a purpose-built keypad
 * beats the system keyboard: fewer keys, bigger targets, and keys that cannot
 * lead anywhere are dimmed rather than left to fail silently.
 *
 * The system keyboard is still one tap away, because stop and place names are
 * the other way people search and those need real text entry.
 */
const KEYS = [
  "1",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "0",
  "A",
  "B",
  "C",
  "K",
  "M",
  "N",
  "P",
  "R",
  "S",
  "X",
];

const MAX_RESULTS = 40;

function RouteResult(props: { route: KeyedRoute; lang: "zh" | "en" }) {
  return (
    <a href={routeHref(props.route.key)} class="mb-tap flex items-center gap-3 px-3.5 py-2.5">
      <RoutePlate route={props.route.route} co={props.route.co} size="sm" />
      <div class="flex min-w-0 grow flex-col gap-0.5">
        <span class="truncate text-[0.82rem] font-bold tracking-[-0.01em] text-foreground">
          {pick(props.route.orig, props.lang)} → {pick(props.route.dest, props.lang)}
        </span>
        <span class="truncate text-[0.63rem] font-medium text-subtle-foreground">
          {[
            operatorLabel(props.route.co, props.lang),
            fareLabel(props.route.fares?.[0]),
            props.route.jt ? `${props.route.jt} ${t("minute", props.lang)}` : null,
          ]
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

export default function Search() {
  const db = useDb();
  const lang = settings.lang;
  const [query, setQuery] = createSignal("");
  const [typing, setTyping] = createSignal(false);
  let field!: HTMLInputElement;

  const routes = createMemo(() => searchRoutes(db(), query(), MAX_RESULTS));
  const stops = createMemo(() => searchStops(db(), query()));
  const destinations = createMemo(() => {
    // Only worth showing when the query is not simply a route number.
    const found = searchDestinations(db(), query());
    const already = new Set(routes().map((r) => r.key));
    return found.filter((r) => !already.has(r.key));
  });

  const allowed = createMemo(() => nextRouteChars(db(), query()));
  const empty = () => query().trim() === "";
  const nothing = () =>
    !empty() && routes().length === 0 && stops().length === 0 && destinations().length === 0;

  const frequentRoutes = createMemo(() =>
    frequent.top(4).flatMap((key) => {
      const route = routeAt(db(), key);
      return route ? [route] : [];
    }),
  );

  const press = (key: string) => setQuery((q) => q + key);

  return (
    <SplitPage
      dock={
        <Show when={!typing()}>
          {/* A floating sheet rather than a slab welded to the bottom: the keys
              are thumb-sized and centred, and a full-bleed surface around them
              left stranded margins on a tablet. */}
          <div class="px-3 pb-2">
            <div class="mx-auto w-full max-w-[27rem] rounded-2xl border border-border bg-card p-3 shadow-card">
              <Keypad
                lang={lang()}
                keyEnabled={(key) => empty() || allowed().has(key)}
                onPress={press}
                onBackspace={() => setQuery((q) => q.slice(0, -1))}
                onType={() => {
                  setTyping(true);
                  field.focus();
                }}
              />
            </div>
          </div>
        </Show>
      }
      aside={
        <>
          <ScreenTitle title={t("searchRoutes", lang())} subtitle="Search" />

          <div class="-mt-2.5">
            <ModeSwitch lang={lang()} />
          </div>

          <div
            class="-mt-2.5 flex h-13 items-center gap-3 rounded-2xl border-[1.5px] bg-card px-3.5"
            style={{ "border-color": query() ? "var(--primary-border)" : "var(--border)" }}
          >
            <span class="text-primary">
              <SearchIcon size={19} />
            </span>
            <input
              ref={field}
              value={query()}
              onInput={(e) => setQuery(e.currentTarget.value)}
              /* Switch before focus lands, so the tap that opens the field is
               also the tap that raises the system keyboard. */
              onPointerDown={() => setTyping(true)}
              onFocus={() => setTyping(true)}
              placeholder={t("searchAnything", lang())}
              aria-label={t("searchAnything", lang())}
              enterkeyhint="search"
              autocomplete="off"
              autocorrect="off"
              spellcheck={false}
              /* In keypad mode the field stays fully editable but asks the OS not
               to raise a keyboard, so the tuned keypad does the typing without
               a second one covering the results. */
              inputmode={typing() ? "search" : "none"}
              class="tnum grow bg-transparent text-[1.1rem] font-bold tracking-[-0.02em] text-foreground outline-none placeholder:text-[0.85rem] placeholder:font-medium placeholder:tracking-normal placeholder:text-subtle-foreground"
            />
            <Show when={query()}>
              <button
                type="button"
                aria-label="clear"
                onClick={() => {
                  setQuery("");
                  setTyping(false);
                }}
                class="flex size-6.5 shrink-0 items-center justify-center rounded-full bg-secondary text-muted-foreground"
              >
                <CloseIcon size={13} />
              </button>
            </Show>
          </div>

          <div class="-mt-2 hidden lg:block">
            <Keypad
              lang={lang()}
              keyEnabled={(key) => empty() || allowed().has(key)}
              onPress={press}
              onBackspace={() => setQuery((q) => q.slice(0, -1))}
              onType={() => field.focus()}
            />
          </div>
        </>
      }
    >
      <Show when={!empty()} fallback={<EmptyView lang={lang()} routes={frequentRoutes()} />}>
        <Show when={!nothing()} fallback={<EmptyState title={t("noResults", lang())} />}>
          <div class="flex flex-col gap-5">
            <Show when={routes().length > 0}>
              <section class="flex flex-col gap-2.5">
                <SectionLabel
                  trailing={
                    <span class="tnum text-[0.63rem] font-semibold text-faint-foreground">
                      {routes().length}
                    </span>
                  }
                >
                  {`${t("routes", lang())} Routes`}
                </SectionLabel>
                <Card>
                  <For each={routes()}>
                    {(route, index) => (
                      <>
                        <Show when={index() > 0}>
                          <Hairline />
                        </Show>
                        <RouteResult route={route} lang={lang()} />
                      </>
                    )}
                  </For>
                </Card>
              </section>
            </Show>

            <Show when={stops().length > 0}>
              <section class="flex flex-col gap-2.5">
                <SectionLabel>{`${t("stopsMatched", lang())} Stops`}</SectionLabel>
                <Card>
                  <For each={stops()}>
                    {(match, index) => (
                      <>
                        <Show when={index() > 0}>
                          <Hairline />
                        </Show>
                        <a
                          href={`/stop/${encodeURIComponent(match.stopId)}`}
                          class="mb-tap flex items-center gap-3 px-3.5 py-2.5"
                        >
                          <div class="flex min-w-0 grow flex-col gap-0.5">
                            <span class="truncate text-[0.82rem] font-bold text-foreground">
                              {stripStopCode(pick(match.stop.name, lang()))}
                            </span>
                            <span class="truncate text-[0.63rem] font-medium text-subtle-foreground">
                              {stripStopCode(pick(match.stop.name, lang() === "zh" ? "en" : "zh"))}
                            </span>
                          </div>
                          <span class="tnum shrink-0 text-[0.63rem] font-bold text-subtle-foreground">
                            {match.routeCount} {t("routesCount", lang())}
                          </span>
                        </a>
                      </>
                    )}
                  </For>
                </Card>
              </section>
            </Show>

            <Show when={destinations().length > 0}>
              <section class="flex flex-col gap-2.5">
                <SectionLabel>{`${t("towards", lang())} Destination`}</SectionLabel>
                <Card>
                  <For each={destinations()}>
                    {(route, index) => (
                      <>
                        <Show when={index() > 0}>
                          <Hairline />
                        </Show>
                        <RouteResult route={route} lang={lang()} />
                      </>
                    )}
                  </For>
                </Card>
              </section>
            </Show>
          </div>
        </Show>
      </Show>
    </SplitPage>
  );
}

/** What the screen offers before you have typed anything. */
function EmptyView(props: { lang: "zh" | "en"; routes: KeyedRoute[] }) {
  return (
    <div class="flex flex-col gap-6">
      <Show when={props.routes.length > 0}>
        <section class="flex flex-col gap-2.5">
          <SectionLabel>{`${t("frequent", props.lang)} Frequent`}</SectionLabel>
          <Card>
            <For each={props.routes}>
              {(route, index) => (
                <>
                  <Show when={index() > 0}>
                    <Hairline />
                  </Show>
                  <RouteResult route={route} lang={props.lang} />
                </>
              )}
            </For>
          </Card>
        </section>
      </Show>

      <section class="flex flex-col gap-2.5">
        <SectionLabel
          trailing={
            <a href="/browse" class="text-[0.63rem] font-bold text-primary">
              {t("viewAll", props.lang)}
            </a>
          }
        >
          {`${t("categories", props.lang)} Categories`}
        </SectionLabel>

        <div class="grid grid-cols-2 gap-2.5">
          <For each={CATEGORIES.slice(0, 6)}>
            {(item) => (
              <a
                href={`/browse/${item.id}`}
                class="mb-press flex flex-col gap-1.5 rounded-xl border border-border bg-card p-3 shadow-card"
              >
                <span
                  class="h-1 w-7 rounded-full"
                  style={{ background: item.accent }}
                  aria-hidden="true"
                />
                <span class="text-[0.8rem] font-bold text-foreground">
                  {pick(item.name, props.lang)}
                </span>
                <span class="text-[0.6rem] font-medium leading-snug text-subtle-foreground">
                  {pick(item.hint, props.lang)}
                </span>
              </a>
            )}
          </For>
        </div>
      </section>
    </div>
  );
}

/**
 * The route-number keypad. It belongs at the bottom of the screen on a phone
 * and directly under the field on a desktop, which are different places in the
 * reading order, so it is rendered where each layout needs it.
 */
function Keypad(props: {
  lang: Lang;
  keyEnabled: (key: string) => boolean;
  onPress: (key: string) => void;
  onBackspace: () => void;
  onType: () => void;
}) {
  return (
    /* Keys are sized for a thumb, so the pad keeps its width on a tablet
       instead of stretching each key to a couple of hundred pixels. */
    <div class="flex w-full flex-col gap-2">
      <div class="grid grid-cols-5 gap-2">
        <For each={KEYS}>
          {(key) => {
            const enabled = () => props.keyEnabled(key);
            return (
              <button
                type="button"
                disabled={!enabled()}
                onClick={() => props.onPress(key)}
                class={[
                  "flex h-11 items-center justify-center rounded-lg text-[1.05rem] font-bold transition-colors duration-100",
                  {
                    "bg-secondary text-foreground active:bg-primary active:text-primary-foreground":
                      enabled(),
                    "bg-background text-faint-foreground/50": !enabled(),
                  },
                ]}
              >
                {key}
              </button>
            );
          }}
        </For>
        <button
          type="button"
          aria-label="backspace"
          onClick={props.onBackspace}
          class="col-span-5 flex h-11 items-center justify-center rounded-lg bg-secondary text-muted-foreground active:bg-destructive active:text-white"
        >
          <BackspaceIcon size={18} />
        </button>
      </div>

      <div class="flex items-center justify-between pt-0.5">
        <span class="text-[0.6rem] font-medium text-faint-foreground">
          {t("dimmedKeys", props.lang)}
        </span>
        {/* The way out of the keypad and into free text, made to look like the
            control it is rather than a stray line of coloured text. */}
        <button
          type="button"
          onClick={props.onType}
          class="mb-press flex h-7 shrink-0 items-center gap-1.5 rounded-full bg-primary-muted px-3 text-[0.63rem] font-bold text-primary"
        >
          <SearchIcon size={12} />
          {t("searchAnything", props.lang)}
        </button>
      </div>
    </div>
  );
}
