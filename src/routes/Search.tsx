import { useLinkProps } from "@tanstack/solid-router";
import { For, Show, createEffect, createMemo, createSignal } from "solid-js";
import {
  Card,
  EmptyState,
  FareTag,
  Hairline,
  ScreenTitle,
  SectionLabel,
  StopCode,
} from "~/components/Chrome";
import { SplitPage } from "~/components/Layout";
import { ModeSwitch } from "~/components/ModeSwitch";
import { VirtualRows } from "~/components/VirtualRows";
import {
  BackspaceIcon,
  ChevronRightIcon,
  CloseIcon,
  SearchIcon,
  TrashIcon,
} from "~/components/Icons";
import { RoutePlate } from "~/components/RoutePlate";
import { browseLink, routeLink, stopLink } from "~/lib/links";
import { createWide } from "~/lib/wide";
import { useDb } from "~/data/context";
import { CATEGORIES } from "~/data/categories";
import {
  allRoutes,
  nextRouteChars,
  routeAt,
  searchDestinations,
  searchRoutes,
  searchStops,
} from "~/data/db";
import type { KeyedRoute, RouteDb } from "~/data/types";
import { concessionFare, formatFare } from "~/lib/format";
import { pick, stripStopCode, t, type Lang, type MessageKey } from "~/lib/i18n";
import { kindOf, operatorShort, type Kind } from "~/lib/operators";
import { frequent } from "~/stores/frequent";
import { settings } from "~/stores/settings";

/**
 * The search screen is a list of routes with a field above it and a dial
 * below - in that order, because that is how it is used: glance at what you
 * looked up last, or thumb a number in and watch the list narrow.
 *
 * The tabs over the list are the list's mode, not a filter on a result:
 * 最近搜尋 is what you opened recently, 全部 is every route there is, and the
 * kinds are that list cut to buses, minibuses, rail or ferries. All of them
 * are browsable with nothing typed, and all of them narrow as you type.
 */

/** The list's modes, in the order the tabs run. */
type Tab = "recent" | "all" | Kind;

const TABS: { id: Tab; label: MessageKey }[] = [
  { id: "recent", label: "recent" },
  { id: "all", label: "allKinds" },
  { id: "bus", label: "kindBus" },
  { id: "minibus", label: "kindMinibus" },
  { id: "rail", label: "kindRail" },
  { id: "ferry", label: "kindFerry" },
];

/**
 * The letters, taken from the route numbers that exist.
 *
 * They used to be a hand-written list, and it was missing D, E, F, G, H, I, L,
 * T, U and W - which between them are every MTR line code. Ten lines of railway
 * were unreachable from the keypad and nothing said so.
 */
function keypadLetters(db: RouteDb): string[] {
  const letters = new Set<string>();
  for (const key in db.routeList) {
    for (const char of db.routeList[key]?.route ?? "") {
      if (/[A-Z]/.test(char)) letters.add(char);
    }
  }
  return [...letters].sort();
}

const DIGITS = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];

/**
 * One route on the list, in the shape a rider reads it: the number and who
 * runs it, then where it is going in bold - "42 往 青衣" is how a route is
 * named out loud - and where it starts underneath, smaller, with the fare.
 */
function RouteItem(props: {
  route: KeyedRoute;
  lang: Lang;
  /** Makes the row one a rider can take off the list it is on. */
  onRemove?: () => void;
}) {
  return (
    <div class="flex items-center">
      <a
        {...useLinkProps(routeLink(props.route.key))}
        class={[
          "mb-tap flex min-w-0 grow items-center gap-3 py-2.5 pl-3.5",
          props.onRemove ? "pr-1" : "pr-3.5",
        ]}
      >
        <div class="flex w-[4.5rem] shrink-0 flex-col items-start gap-[3px]">
          <RoutePlate route={props.route.route} co={props.route.co} size="sm" />
          <span class="max-w-full truncate text-[0.69rem] font-semibold text-subtle-foreground">
            {operatorShort(props.route.co, props.lang)}
          </span>
        </div>
        <div class="flex min-w-0 grow flex-col gap-0.5">
          <span class="truncate text-[0.94rem] font-bold tracking-[-0.01em] text-foreground">
            <span class="mr-1 text-[0.75rem] font-semibold text-subtle-foreground">
              {t("towards", props.lang)}
            </span>
            {pick(props.route.dest, props.lang)}
          </span>
          {/* Where it starts, and what it costs - the full fare and the
              two-dollar concession each in a tag, so the two amounts read as
              amounts and not as more of the place name. */}
          <span class="flex min-w-0 items-center gap-1 text-[0.75rem] font-medium text-subtle-foreground">
            <span class="truncate">{pick(props.route.orig, props.lang)}</span>
            <Show when={formatFare(props.route.fares?.[0])}>
              {(fare) => (
                <>
                  <FareTag>{fare()}</FareTag>
                  <Show when={concessionFare(props.route.fares?.[0])}>
                    {(amount) => <FareTag>{amount()}</FareTag>}
                  </Show>
                </>
              )}
            </Show>
          </span>
        </div>
        <Show when={!props.onRemove}>
          <span class="text-faint-foreground">
            <ChevronRightIcon size={15} />
          </span>
        </Show>
      </a>
      {/* Beside the link rather than inside it: a button in a link is
          reachable by neither a pointer nor a screen reader with any
          certainty about which of the two it is working. */}
      <Show when={props.onRemove}>
        {(remove) => (
          <button
            type="button"
            aria-label={t("removeRecent", props.lang)}
            title={t("removeRecent", props.lang)}
            onClick={() => remove()()}
            class="mb-press mr-1.5 flex size-9 shrink-0 items-center justify-center rounded-lg text-subtle-foreground transition-colors duration-state hover:bg-secondary hover:text-foreground"
          >
            <CloseIcon size={14} />
          </button>
        )}
      </Show>
    </div>
  );
}

/** A list of routes, one card, with a hairline between rows. */
function RouteList(props: { routes: KeyedRoute[]; lang: Lang; onRemove?: (key: string) => void }) {
  return (
    <Card>
      <VirtualRows items={props.routes} estimate={64} divided>
        {(route) => (
          <RouteItem
            route={route}
            lang={props.lang}
            onRemove={props.onRemove ? () => props.onRemove?.(route.key) : undefined}
          />
        )}
      </VirtualRows>
    </Card>
  );
}

export default function Search() {
  const db = useDb();
  const lang = settings.lang;
  const [query, setQuery] = createSignal("");
  const [tab, setTab] = createSignal<Tab>("recent");

  /*
   * Whether this is a window with a keyboard of its own. On a phone the dial
   * is the only way in and the field just shows what it typed; on a desktop
   * the field takes letters directly, because typing "102" beats clicking it.
   */
  const wide = createWide();

  const empty = () => query().trim() === "";

  /** Every route, once per database; the list every tab starts from. */
  const everything = createMemo(() => allRoutes(db()));

  /** Which kinds this database has at all - a ferry tab with no ferries is noise. */
  const kinds = createMemo(() => {
    const present = new Set<Kind>();
    for (const route of everything()) {
      const co = route.co[0];
      if (co) present.add(kindOf(co));
    }
    return present;
  });
  const tabs = () =>
    TABS.filter((entry) => entry.id === "recent" || entry.id === "all" || kinds().has(entry.id));

  /** The routes the typed number matches - or all of them, when nothing is typed. */
  const matched = createMemo(() =>
    empty() ? everything() : searchRoutes(db(), query(), Number.POSITIVE_INFINITY),
  );

  const recentRoutes = createMemo(() =>
    frequent.recent(30).flatMap((key) => {
      const route = routeAt(db(), key);
      return route ? [route] : [];
    }),
  );
  const recentMatched = createMemo(() => {
    if (empty()) return recentRoutes();
    const q = query().trim().toUpperCase();
    return recentRoutes().filter((route) => route.route.toUpperCase().startsWith(q));
  });

  /*
   * Typing while looking at recent searches narrows them, until nothing
   * recent matches - then the list falls through to everything, because a
   * rider typing a number wants that number, not an empty card. The tab
   * itself is left alone, so clearing the field brings the recents back.
   */
  const shownTab = (): Tab =>
    tab() === "recent" && !empty() && recentMatched().length === 0 ? "all" : tab();

  const listed = createMemo<KeyedRoute[]>(() => {
    const mode = shownTab();
    if (mode === "recent") return recentMatched();
    if (mode === "all") return matched();
    return matched().filter((route) => route.co[0] && kindOf(route.co[0]) === mode);
  });

  // The other things a typed string can be: a stop's name or code, a place.
  const stops = createMemo(() => (empty() ? [] : searchStops(db(), query())));
  const destinations = createMemo(() => {
    if (empty()) return [];
    const found = searchDestinations(db(), query());
    const already = new Set(matched().map((r) => r.key));
    return found.filter((r) => !already.has(r.key));
  });

  const nothing = () =>
    !empty() && listed().length === 0 && stops().length === 0 && destinations().length === 0;

  const allowed = createMemo(() => nextRouteChars(db(), query()));
  const letters = createMemo(() => keypadLetters(db()));

  const press = (key: string) => setQuery((q) => q + key);
  const clear = () => setQuery("");

  const keypad = (hint: boolean) => (
    <Keypad
      hint={hint}
      lang={lang()}
      letters={letters()}
      keyEnabled={(key) => allowed().has(key)}
      canClear={!empty()}
      onPress={press}
      onBackspace={() => setQuery((q) => q.slice(0, -1))}
      onClear={clear}
    />
  );

  return (
    <SplitPage
      dock={
        /* Always there, and nothing on the screen can put a keyboard over it:
           the dial is how a route number is typed here, and the field above
           it never asks the phone for a keyboard of its own. It used to, and a
           dial that vanished the moment you touched the field was a dial you
           could not trust to be where your thumb left it. A floating sheet
           rather than a slab welded to the bottom: the keys are thumb-sized
           and centred, and a full-bleed surface left stranded margins on a
           tablet. It rises into place with the page - the one thing on the
           screen that is not content, arriving as the fixture it is. */
        <div class="mb-rise px-3 pb-2">
          <div class="mx-auto w-full max-w-[27rem] rounded-2xl border border-border bg-card p-3 shadow-card">
            {keypad(false)}
          </div>
        </div>
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
                /* A window with a real keyboard should not ask for a click
                   before it will take a letter. Focusing raises no keyboard on
                   a phone because no phone is this wide. Once the database
                   is read, not on the next frame: on a cold start the ref
                   runs while the database is still loading and the screen is
                   held off the page, and focusing a node that is not in the
                   document does nothing. An effect that reads the database is
                   held with the screen and runs once it is on the page. */
                createEffect(
                  () => db(),
                  () => {
                    if (window.matchMedia("(min-width: 64rem)").matches) el.focus();
                  },
                );
              }}
              value={query()}
              onInput={(e) => setQuery(e.currentTarget.value)}
              /* On a phone this field shows the number the dial is typing; on
                 a desktop it also takes what the keyboard types. It says so:
                 a placeholder promising stops and places on a screen whose
                 only keys are digits was a promise the dial could not keep. */
              placeholder={wide() ? t("searchAnything", lang()) : t("routes", lang())}
              aria-label={t("searchAnything", lang())}
              enterkeyhint="search"
              autocomplete="off"
              autocorrect="off"
              spellcheck={false}
              /* Never a virtual keyboard: it would come up over the dial, and
                 on a phone the dial is the keyboard. A physical one is
                 unaffected, so the desktop field still takes letters. */
              inputmode="none"
              class="tnum grow bg-transparent text-[1.1rem] font-bold tracking-[-0.02em] text-foreground outline-none placeholder:text-[0.94rem] placeholder:font-medium placeholder:tracking-normal placeholder:text-subtle-foreground"
            />
            <Show when={query()}>
              <button
                type="button"
                aria-label="clear"
                onClick={clear}
                class="flex size-6.5 shrink-0 items-center justify-center rounded-full bg-secondary text-muted-foreground"
              >
                <CloseIcon size={13} />
              </button>
            </Show>
          </div>

          {/* The same dial as the phone's, in the same frame: a desktop is a
              window a rider looks up a route number in too, and a strip of
              small shortcuts made them aim at a different pad on every
              screen. */}
          <div class="-mt-1 hidden flex-col gap-2 lg:flex">
            <SectionLabel>{t("routeNumber", lang())}</SectionLabel>
            <div class="rounded-2xl border border-border bg-card p-3 shadow-card">
              {keypad(true)}
            </div>
          </div>
        </>
      }
    >
      <div class="flex flex-col gap-4">
        {/* The list's mode. One row that scrolls sideways on a phone rather
            than wrapping, so the list under it starts at the same height
            whichever tab is on. */}
        <div
          role="tablist"
          aria-label={t("routes", lang())}
          data-search-tabs
          class="mb-scroll -mx-3.5 flex gap-1.5 overflow-x-auto px-3.5 lg:mx-0 lg:flex-wrap lg:px-0"
        >
          <For each={tabs()}>
            {(entry) => {
              const on = () => shownTab() === entry.id;
              return (
                <button
                  type="button"
                  role="tab"
                  aria-selected={on() ? "true" : "false"}
                  onClick={() => setTab(entry.id)}
                  class={[
                    "mb-press flex h-8 shrink-0 items-center rounded-full px-3 text-[0.81rem] font-bold transition-colors duration-state",
                    {
                      "bg-primary text-primary-foreground": on(),
                      "bg-secondary text-muted-foreground hover:text-foreground": !on(),
                    },
                  ]}
                >
                  {t(entry.label, lang())}
                </button>
              );
            }}
          </For>
        </div>

        <Show when={!nothing()} fallback={<EmptyState title={t("noResults", lang())} />}>
          <Show
            when={shownTab() !== "recent"}
            fallback={
              <RecentView
                lang={lang()}
                routes={recentMatched()}
                onForget={(key) => frequent.forget(key)}
              />
            }
          >
            <Show when={listed().length > 0}>
              <section class="flex flex-col gap-2.5">
                <SectionLabel
                  trailing={
                    <span class="tnum text-[0.75rem] font-semibold text-faint-foreground">
                      {listed().length}
                    </span>
                  }
                >
                  {t("routes", lang())}
                </SectionLabel>
                <RouteList routes={listed()} lang={lang()} />
              </section>
            </Show>
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
                        {...useLinkProps(stopLink(match.stopId))}
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
              <RouteList routes={destinations()} lang={lang()} />
            </section>
          </Show>
        </Show>
      </div>
    </SplitPage>
  );
}

/**
 * The recent tab: what was opened last, each with a way off the list, and
 * under it the categories - the other way in when you know the kind of trip
 * rather than the number, and what the tab offers before anything has been
 * looked up at all.
 */
function RecentView(props: { lang: Lang; routes: KeyedRoute[]; onForget: (key: string) => void }) {
  return (
    <div class="flex flex-col gap-6">
      <Show
        when={props.routes.length > 0}
        fallback={
          <EmptyState title={t("noRecent", props.lang)} hint={t("noRecentHint", props.lang)} />
        }
      >
        <section class="flex flex-col gap-2.5" data-recent>
          <SectionLabel>{t("recent", props.lang)}</SectionLabel>
          <RouteList routes={props.routes} lang={props.lang} onRemove={props.onForget} />
        </section>
      </Show>

      <section class="flex flex-col gap-2.5">
        <SectionLabel
          trailing={
            <a {...useLinkProps({ to: "/browse" })} class="text-[0.75rem] font-bold text-primary">
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
                {...useLinkProps(browseLink(item.id))}
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
 * The route-number keypad: a phone dial, and beside it the letters that could
 * still follow what has been typed.
 *
 * Digits stay put and dim, because a dial the thumb has learned must not
 * rearrange itself; letters come and go, because there are twenty of them and
 * after "9" only a handful can follow. Showing all twenty dimmed spent half a
 * phone screen on keys that mostly did nothing, and the ones that did were
 * lost among them.
 *
 * It belongs at the bottom of the screen on a phone and directly under the
 * field on a desktop, which are different places in the reading order, so it
 * is rendered where each layout needs it - but it is the one pad either way.
 * A desktop once got a flattened strip of shortcuts instead, and a rider who
 * had learned where "6" was on the phone had to learn it again on the laptop.
 * `hint` is the only difference: the desktop has room for the line that says
 * what a dimmed key means.
 */
function Keypad(props: {
  lang: Lang;
  /** Every letter any route number uses; only the ones that can follow show. */
  letters: string[];
  keyEnabled: (key: string) => boolean;
  canClear: boolean;
  onPress: (key: string) => void;
  onBackspace: () => void;
  onClear: () => void;
  /** Show the line explaining the dimmed keys - only where there is room. */
  hint?: boolean;
}) {
  const live = () => props.letters.filter((letter) => props.keyEnabled(letter));

  /*
   * `order` is where the key sits in a column that comes and goes: a letter
   * that has just become possible pops in a beat after the one above it, so
   * the column reads as the keys arriving in sequence rather than the pad
   * changing shape. Digits never move, so they never take one.
   */
  const key = (value: string, size: string, order?: number) => {
    const enabled = () => props.keyEnabled(value);
    return (
      <button
        type="button"
        disabled={!enabled()}
        onClick={() => props.onPress(value)}
        style={
          order === undefined ? undefined : { "animation-delay": `${Math.min(order, 7) * 30}ms` }
        }
        class={[
          "mb-press flex items-center justify-center font-bold transition-colors duration-press",
          size,
          { "mb-pop": order !== undefined },
          {
            "bg-secondary text-foreground active:bg-primary active:text-primary-foreground":
              enabled(),
            "bg-background text-faint-foreground/50": !enabled(),
          },
        ]}
      >
        {value}
      </button>
    );
  };

  const control = (
    label: string,
    icon: () => ReturnType<typeof BackspaceIcon>,
    onClick: () => void,
    size: string,
    disabled = false,
  ) => (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      class={[
        "mb-press flex items-center justify-center rounded-xl transition-colors duration-press",
        size,
        {
          "bg-secondary text-muted-foreground active:bg-destructive active:text-white": !disabled,
          "bg-background text-faint-foreground/50": disabled,
        },
      ]}
    >
      {icon()}
    </button>
  );

  return (
    <div class="flex w-full flex-col gap-2">
      {/* The dial on the left - nine digits in a square, and under them
          clear, zero and backspace - and beside it the letters that could
          still follow: a column the thumb can scroll when there are more
          than fit, which after a blank field there are. */}
      <div class="flex gap-2">
        <div class="grid grow grid-cols-3 gap-2">
          <For each={DIGITS}>{(digit) => key(digit, "h-11 rounded-xl text-[1.05rem]")}</For>
          {control(
            t("clearQuery", props.lang),
            () => (
              <TrashIcon size={17} />
            ),
            props.onClear,
            "h-11",
            !props.canClear,
          )}
          {key("0", "h-11 rounded-xl text-[1.05rem]")}
          {control(
            "backspace",
            () => (
              <BackspaceIcon size={20} />
            ),
            props.onBackspace,
            "h-11",
          )}
        </div>
        <div
          class="mb-scroll grid w-[31%] shrink-0 grid-cols-2 content-start gap-2 overflow-y-auto"
          style={{ "max-height": "calc(4 * 2.75rem + 3 * 0.5rem)" }}
          data-keypad-letters
        >
          <For each={live()}>
            {(letter, index) =>
              key(letter, "size-11 justify-self-center rounded-full text-[1rem]", index())
            }
          </For>
        </div>
      </div>

      {/* The one line of explanation, and only where there is room for it.
          On a phone a dimmed key explains itself the first time it is
          pressed, and the line was a row of the list. */}
      <Show when={props.hint}>
        <span class="pt-0.5 text-[0.75rem] font-medium text-faint-foreground">
          {t("dimmedKeys", props.lang)}
        </span>
      </Show>
    </div>
  );
}
