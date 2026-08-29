import { For, Show, createMemo, createSignal } from "solid-js";
import {
  Card,
  EmptyState,
  Hairline,
  ScreenTitle,
  SectionLabel,
  StopCode,
} from "~/components/Chrome";
import { SplitPage } from "~/components/Layout";
import { ModeSwitch } from "~/components/ModeSwitch";
import { BackspaceIcon, ChevronRightIcon, CloseIcon, SearchIcon } from "~/components/Icons";
import { RoutePlate } from "~/components/RoutePlate";
import { routeHref } from "~/components/RouteRow";
import { useDb } from "~/data/context";
import { CATEGORIES } from "~/data/categories";
import { nextRouteChars, routeAt, searchDestinations, searchRoutes, searchStops } from "~/data/db";
import type { KeyedRoute, RouteDb } from "~/data/types";
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
/**
 * The keys, taken from the route numbers that exist.
 *
 * They used to be a hand-written list, and it was missing D, E, F, G, H, I, L,
 * T, U and W - which between them are every MTR line code. Ten lines of railway
 * were unreachable from the keypad and nothing said so.
 */
function keypadKeys(db: RouteDb): string[] {
  const letters = new Set<string>();
  for (const key in db.routeList) {
    for (const char of db.routeList[key]?.route ?? "") {
      if (/[A-Z]/.test(char)) letters.add(char);
    }
  }
  return ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0", ...[...letters].sort()];
}

const MAX_RESULTS = 40;

function RouteResult(props: { route: KeyedRoute; lang: "zh" | "en" }) {
  return (
    <a href={routeHref(props.route.key)} class="mb-tap flex items-center gap-3 px-3.5 py-2.5">
      <RoutePlate route={props.route.route} co={props.route.co} size="sm" />
      <div class="flex min-w-0 grow flex-col gap-0.5">
        <span class="truncate text-[0.88rem] font-bold tracking-[-0.01em] text-foreground">
          {pick(props.route.orig, props.lang)} → {pick(props.route.dest, props.lang)}
        </span>
        <span class="truncate text-[0.75rem] font-medium text-subtle-foreground">
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
  const keys = createMemo(() => keypadKeys(db()));
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
                keys={keys()}
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
          <ScreenTitle title={t("searchRoutes", lang())} pinned={false} />

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
              ref={(el: HTMLInputElement) => {
                field = el;
                /* A window with a real keyboard should not ask for a click
                   before it will take a letter. Focusing raises no keyboard on
                   a phone because no phone is this wide. */
                if (window.matchMedia("(min-width: 64rem)").matches) {
                  requestAnimationFrame(() => el.focus());
                }
              }}
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
              class="tnum grow bg-transparent text-[1.1rem] font-bold tracking-[-0.02em] text-foreground outline-none placeholder:text-[0.94rem] placeholder:font-medium placeholder:tracking-normal placeholder:text-subtle-foreground"
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

          <div class="-mt-1 hidden flex-col gap-2 lg:flex">
            <SectionLabel>{t("routeNumber", lang())}</SectionLabel>
            <Keypad
              compact
              lang={lang()}
              keys={keys()}
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
                    <span class="tnum text-[0.75rem] font-semibold text-faint-foreground">
                      {routes().length}
                    </span>
                  }
                >
                  {t("routes", lang())}
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
                <SectionLabel>{t("stopsMatched", lang())}</SectionLabel>
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
                          {/* The name once, in the language being read, and the
                              pole code beside it - which is both what tells two
                              stops of one name apart and what a rider can search
                              for directly. */}
                          <div class="flex min-w-0 grow items-center gap-1.5">
                            <span class="truncate text-[0.88rem] font-bold text-foreground">
                              {stripStopCode(pick(match.stop.name, lang()))}
                            </span>
                            <StopCode name={match.stop.name} lang={lang()} />
                          </div>
                          <span class="tnum shrink-0 text-[0.75rem] font-bold text-subtle-foreground">
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
                <SectionLabel>{t("towards", lang())}</SectionLabel>
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
          <SectionLabel>{t("frequent", props.lang)}</SectionLabel>
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
            <a href="/browse" class="text-[0.75rem] font-bold text-primary">
              {t("viewAll", props.lang)}
            </a>
          }
        >
          {t("categories", props.lang)}
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
                <span class="text-[0.88rem] font-bold text-foreground">
                  {pick(item.name, props.lang)}
                </span>
                <span class="text-[0.75rem] font-medium leading-snug text-subtle-foreground">
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
 *
 * `compact` is the desktop cut. A thumb-sized dialer under a machine with a
 * real keyboard reads as a phone app someone stretched: the keys are still
 * there, because tapping 1-0-2 beats typing it, but they are a strip of
 * shortcuts rather than the thing the screen is about.
 */
function Keypad(props: {
  lang: Lang;
  keys: string[];
  keyEnabled: (key: string) => boolean;
  onPress: (key: string) => void;
  onBackspace: () => void;
  onType: () => void;
  compact?: boolean;
}) {
  return (
    /* Keys are sized for a thumb, so the pad keeps its width on a tablet
       instead of stretching each key to a couple of hundred pixels. */
    <div class="flex w-full flex-col gap-2">
      <div class={props.compact ? "grid grid-cols-8 gap-1.5" : "grid grid-cols-5 gap-2"}>
        <For each={props.keys}>
          {(key) => {
            const enabled = () => props.keyEnabled(key);
            return (
              <button
                type="button"
                disabled={!enabled()}
                onClick={() => props.onPress(key)}
                class={[
                  // Digits carry most of Hong Kong's route numbers and keep the
                  // thumb-sized row; the twenty letters behind them would
                  // otherwise take half a phone screen.
                  "mb-press flex items-center justify-center rounded-xl font-bold transition-colors duration-press",
                  props.compact
                    ? "h-9 rounded-lg text-[0.94rem]"
                    : /\d/.test(key)
                      ? "h-12 text-[1.05rem]"
                      : "h-10 text-[1rem]",
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
          class={[
            "flex items-center justify-center rounded-lg bg-secondary text-muted-foreground active:bg-destructive active:text-white",
            props.compact ? "col-span-8 h-9" : "col-span-5 h-11",
          ]}
        >
          <BackspaceIcon size={props.compact ? 15 : 18} />
        </button>
      </div>

      <div class="flex items-center justify-between pt-0.5">
        <span class="text-[0.75rem] font-medium text-faint-foreground">
          {t("dimmedKeys", props.lang)}
        </span>
        <Show when={!props.compact}>
          {/* The way out of the keypad and into free text, made to look like the
            control it is rather than a stray line of coloured text. */}
          <button
            type="button"
            onClick={props.onType}
            class="mb-press flex h-7 shrink-0 items-center gap-1.5 rounded-full bg-primary-muted px-3 text-[0.75rem] font-bold text-primary"
          >
            <SearchIcon size={12} />
            {t("searchAnything", props.lang)}
          </button>
        </Show>
      </div>
    </div>
  );
}
