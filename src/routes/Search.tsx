import { useLinkProps, useNavigate, useSearch } from "@tanstack/solid-router";
import { For, Show, createEffect, createMemo, createSignal } from "solid-js";
import type { JSX } from "@solidjs/web";
import { Card, EmptyState, FareTag, Hairline, SectionLabel, StopCode } from "~/components/Chrome";
import { CategoryIcon } from "~/components/CategoryIcon";
import { Page } from "~/components/Layout";
import { ModeSwitch } from "~/components/ModeSwitch";
import { VirtualRows } from "~/components/VirtualRows";
import { Drawer } from "~/components/Drawer";
import {
  BackspaceIcon,
  ChevronRightIcon,
  CloseIcon,
  DialpadIcon,
  HistoryIcon,
  SearchIcon,
  TrashIcon,
} from "~/components/Icons";
import { RoutePlate } from "~/components/RoutePlate";
import { browseLink, routeLink, stopLink } from "~/lib/links";
import { createWide } from "~/lib/wide";
import { useDb } from "~/data/context";
import { CATEGORIES, categoryCounts } from "~/data/categories";
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
import { searches } from "~/stores/searches";
import { settings } from "~/stores/settings";

/**
 * The search screen reads top to bottom: what a search is made *with* first -
 * the field, its dial, and the categories for when the trip is known by kind
 * rather than by number - and then, across the full width beneath them, what
 * the search *found*.
 *
 * The two halves used to be side by side, with the categories buried under
 * however long the recent list had grown. Now the ways in keep the head of
 * the screen at every width and the results get the whole width to spread
 * into, which is what a list of routes wants: more rows, not wider rows.
 *
 * The tabs over the list are the list's mode, not a filter on a result:
 * 最近搜尋 is what you opened recently, 全部 is every route there is, and the
 * kinds are that list cut to buses, minibuses, rail or ferries. All of them
 * are browsable with nothing typed, and all of them narrow as you type.
 */

/**
 * The list's modes, in the order the tabs run.
 *
 * The kinds cut the routes down; `stops` and `dest` are the other two things a
 * typed word can be, promoted from blocks buried under the routes to modes of
 * their own. A rider who types 旺角 means a place, and the routes numbered near
 * it were standing between them and the twelve stops called that.
 */
type Tab = "all" | Kind | "stops" | "dest";

const TABS: { id: Tab; label: MessageKey }[] = [
  { id: "all", label: "allKinds" },
  { id: "bus", label: "kindBus" },
  { id: "minibus", label: "kindMinibus" },
  { id: "rail", label: "kindRail" },
  { id: "ferry", label: "kindFerry" },
  { id: "stops", label: "stopsMatched" },
  { id: "dest", label: "toLabel" },
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
 * The categories this screen puts in its window - the first six of the
 * catalogue, whose order is the shop window. The rest are a tap away under
 * 睇晒.
 */
const SHOWN_CATEGORIES = CATEGORIES.slice(0, 6);

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
          "app-tap flex min-w-0 grow items-center gap-3 py-2.5 pl-3.5",
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
            class="app-press mr-1.5 flex size-9 shrink-0 items-center justify-center rounded-lg text-subtle-foreground transition-colors duration-state hover:bg-secondary hover:text-foreground"
          >
            <CloseIcon size={14} />
          </button>
        )}
      </Show>
    </div>
  );
}

/**
 * The rows of a list of routes, hairlined - and nothing else. The frame around
 * them belongs to whoever is drawing the list: the results and the field's own
 * history are two lists inside two different cards, and a list that brought its
 * own card could not be either of them.
 */
function RouteList(props: { routes: KeyedRoute[]; lang: Lang; onRemove?: (key: string) => void }) {
  return (
    <VirtualRows items={props.routes} estimate={64} divided>
      {(route) => (
        <RouteItem
          route={route}
          lang={props.lang}
          onRemove={props.onRemove ? () => props.onRemove?.(route.key) : undefined}
        />
      )}
    </VirtualRows>
  );
}

/**
 * The same rows without the virtualiser.
 *
 * Two virtualisers cannot share a scroller. Each one measures where it starts
 * inside that scroller and then places its rows absolutely from there, so the
 * second measures its own offset before the first has finished measuring its
 * rows - and draws four hundred pixels of routes on top of the stops between
 * them. The list that needs a virtualiser is the one with four thousand rows
 * in it; the destination matches are capped at twenty and can simply be rows.
 */
function RouteRows(props: { routes: KeyedRoute[]; lang: Lang; onRemove?: (key: string) => void }) {
  return (
    <For each={props.routes}>
      {(route, index) => (
        <>
          <Show when={index() > 0}>
            <Hairline />
          </Show>
          <RouteItem
            route={route}
            lang={props.lang}
            onRemove={props.onRemove ? () => props.onRemove?.(route.key) : undefined}
          />
        </>
      )}
    </For>
  );
}

/**
 * A seam inside the results card, naming the block under it.
 *
 * The blocks used to be separate cards with a `SectionLabel` on the page
 * between them. Inside one frame that label has to carry the join itself, so
 * it takes the rule above it - except at the very top of the card, where there
 * is nothing to be joined to.
 */
function SeamLabel(props: { children: JSX.Element; first?: boolean }) {
  return (
    <div
      class={[
        "bg-secondary/40 px-3.5 py-1.5 text-[0.69rem] font-bold uppercase tracking-[0.08em] text-faint-foreground",
        props.first ? "" : "border-t border-border",
      ]}
    >
      {props.children}
    </div>
  );
}

export default function Search() {
  const db = useDb();
  const lang = settings.lang;
  const params = useSearch({ from: "/search" });
  const navigate = useNavigate();

  /*
   * The field is the source of truth while a thumb is on the dial - a signal
   * takes two presses in one frame, a router round-trip might not - and the
   * URL follows it, so a reload lands on the same list and a search can be
   * sent to someone. The field follows the URL right back, which is what
   * makes the back button and a shared link type into it.
   */
  const urlQuery = () => (params().q === undefined ? "" : String(params().q));
  const [query, setQuery] = createSignal(urlQuery());
  const tab = (): Tab => params().tab ?? "all";
  const setTab = (id: Tab) =>
    void navigate({
      to: "/search",
      search: (prev) => {
        const { tab: _, ...rest } = prev;
        return id === "all" ? rest : { ...rest, tab: id };
      },
      replace: true,
    });

  createEffect(
    () => query(),
    (q) => {
      if (urlQuery() === q) return;
      void navigate({
        to: "/search",
        search: (prev) => {
          const { q: _, ...rest } = prev;
          if (q === "") return rest;
          // As a number when it is all digits, so the address reads ?q=290
          // rather than a JSON-quoted %22290%22.
          return { ...rest, q: /^\d+$/.test(q) ? Number(q) : q };
        },
        replace: true,
      });
    },
  );
  createEffect(
    () => urlQuery(),
    (q) => {
      if (q !== query()) setQuery(q);
    },
  );

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
  /*
   * Which chips are on the row. The kinds this database has at all, and the
   * two query-shaped ones only while the query has actually found some: a
   * 車站 chip that answers nothing is a chip a rider presses once and learns
   * to distrust.
   */
  const tabs = () =>
    TABS.filter((entry) => {
      // The two query-shaped chips are there for any typed query, empty answer
      // or not: a row that grows a chip the moment a stop happens to match is
      // a row that moves under the thumb aiming at it. On the blank screen
      // there is nothing for them to be about, so they stay away.
      if (entry.id === "stops" || entry.id === "dest") return !empty();
      return entry.id === "all" || kinds().has(entry.id);
    });

  /** The routes the typed number matches - or all of them, when nothing is typed. */
  const matched = createMemo(() =>
    empty() ? everything() : searchRoutes(db(), query(), Number.POSITIVE_INFINITY),
  );

  const listed = createMemo<KeyedRoute[]>(() => {
    const mode = tab();
    if (mode === "all" || mode === "stops" || mode === "dest") return matched();
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

  /* What the pressed chip is showing. `all` is everything the query found; a
     kind cuts the routes and drops the other two blocks, because a rider who
     asked for 巴士 did not ask for a list of stops. */
  const showRoutes = () => tab() !== "stops" && tab() !== "dest";
  const showStops = () => tab() === "all" || tab() === "stops";
  const showDest = () => tab() === "all" || tab() === "dest";

  /** How many the pressed chip found - the number at the end of its row. */
  const found = () =>
    tab() === "stops" ? stops().length : tab() === "dest" ? destinations().length : listed().length;

  /** Nothing under the chip that is pressed - which is not the same as nothing at all. */
  const nothing = () =>
    (!showRoutes() || listed().length === 0) &&
    (!showStops() || stops().length === 0) &&
    (!showDest() || destinations().length === 0);

  const allowed = createMemo(() => nextRouteChars(db(), query()));
  const letters = createMemo(() => keypadLetters(db()));

  const press = (key: string) => setQuery((q) => q + key);
  const clear = () => setQuery("");

  const keypad = () => (
    <Keypad
      lang={lang()}
      letters={letters()}
      keyEnabled={(key) => allowed().has(key)}
      canClear={!empty()}
      onPress={press}
      onBackspace={() => setQuery((q) => q.slice(0, -1))}
      onClear={clear}
    />
  );

  /* The phone's dial rides in a sheet of its own: up when the screen opens,
     because dialling a number is what this screen is for, and pushed down
     when the rider wants the list - the sheet replaces the tab bar as the
     thing the thumb is using, the way the app's other sheets do. */
  /*
   * Both live in the address rather than in a signal, so that a sheet is a
   * place the back button leaves and a screen sent to somebody arrives in the
   * state it was sent in - the same rule the route screen's map and timetable
   * follow. Opening one pushes; closing one replaces, so Back never walks
   * forward into a sheet a rider has just shut.
   */
  const dialOpen = () => params().dial !== false;
  const setDialOpen = (open: boolean) =>
    void navigate({
      to: "/search",
      search: (prev) => {
        const { dial: _, ...rest } = prev;
        return open ? rest : { ...rest, dial: false as const };
      },
      // The dial is furniture rather than a place: it comes and goes with the
      // keyboard, and a history entry for each of those would make the back
      // button a keypad toggle.
      replace: true,
    });

  /** Which sheet is up, if any. */
  const sheet = () => params().sheet;
  const setSheet = (id: "recent" | "categories" | undefined) =>
    void navigate({
      to: "/search",
      search: (prev) => {
        const { sheet: _, ...rest } = prev;
        return id ? { ...rest, sheet: id } : rest;
      },
      replace: id === undefined,
    });

  /*
   * What was actually opened, newest first - a list of real rows, not of
   * words. The two histories answer different questions: `searches` is what a
   * rider asked, and this is where they ended up.
   */
  const recentRoutes = createMemo(() =>
    frequent.recent(20).flatMap((key) => {
      const route = routeAt(db(), key);
      return route ? [route] : [];
    }),
  );

  /*
   * A search the rider stopped on is a search they meant.
   *
   * Tapping a result records the words that found it, but plenty of searches
   * end without a tap: a rider dials 118, reads the three of them, and goes
   * back to the road. That is still a question they asked and will ask again,
   * so a query that has been left alone for a couple of seconds and has found
   * something goes into the history too. The delay is what keeps 1 and 11 out
   * of it on the way to 118 - each is replaced long before it settles.
   */
  createEffect(
    () => [query(), listed().length + stops().length + destinations().length] as const,
    ([q, hits]) => {
      if (q.trim() === "" || hits === 0) return;
      const timer = window.setTimeout(() => searches.remember(q), 2000);
      return () => window.clearTimeout(timer);
    },
  );

  /*
   * Whether the field is being used. The history hangs off the field the way
   * any search box's does - it appears when a rider is in the box with nothing
   * typed, and the first keystroke replaces it with what that keystroke found.
   */
  const [typing, setTyping] = createSignal(false);
  const historyOpen = () => typing() && empty() && searches.recent().length > 0;

  return (
    <Page
      /* A wide window holds the head of the screen still - field, dial and
         categories - and scrolls the results underneath them. A phone has no
         room for that: there the page scrolls as one, and the head simply
         scrolls away above the list. */
      fill
      dock={
        /* With the dial's sheet away, the way back to it: one glass button
           above the tab bar, where the thumb just left. It only exists while
           the sheet is down, so the dock measures nothing the rest of the
           time and the list keeps its room. */
        <Show when={!dialOpen()}>
          <div class="app-rise flex justify-end px-4 pb-3">
            <button
              type="button"
              aria-label={t("routeNumber", lang())}
              onClick={() => setDialOpen(true)}
              class="app-press app-glass flex size-12 items-center justify-center rounded-full text-foreground"
            >
              <DialpadIcon size={20} />
            </button>
          </div>
        </Show>
      }
    >
      {/* One child, so that the page's own generous gap between blocks - set
          for screens whose blocks are separate subjects - does not open up
          between the ways in and what they found. Those two belong close: a
          keystroke on the dial changes the list, and a band of empty page
          between the two made them read as unrelated. */}
      <div class="flex min-h-0 grow flex-col gap-3 lg:gap-4">
        {/* The head of the screen: the ways in. On a wide window the field and
          its dial hold a column of their own - a dial wider than a thumb's
          reach is not a dial - and the categories stand beside them, filling
          that column's height.

          A phone has one column, and there the categories come second, right
          under the 搜尋/規劃 switch and above the field: a row of chips read
          in the first glance, before a rider decides to type at all. `order`
          rather than a second copy of the markup - the same three blocks,
          rearranged. */}
        <div class="grid shrink-0 gap-3 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] lg:grid-rows-[auto_minmax(0,1fr)] lg:gap-x-10 lg:gap-y-6">
          {/* The switch IS the title, at every width - 搜尋/規劃 says what the
            screen is better than a heading above it could. Full width, so
            it lines up with the field under it. */}
          <div class="order-1 min-w-0 lg:col-start-1 lg:row-start-1">
            <ModeSwitch lang={lang()} />
          </div>

          <Categories
            lang={lang()}
            class="order-2 lg:col-start-2 lg:row-span-2 lg:row-start-1"
            allOpen={sheet() === "categories"}
            onAllOpen={(open) => setSheet(open ? "categories" : undefined)}
          />

          <div class="order-3 flex min-w-0 flex-col gap-3 lg:col-start-1 lg:row-start-2 lg:gap-6">
            <div class="relative">
              <div class="flex h-11 items-center gap-3 rounded-2xl border border-border bg-card px-3.5 shadow-card">
                <span class="text-primary">
                  <SearchIcon size={17} />
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
                        if (!window.matchMedia("(min-width: 64rem)").matches) return;
                        el.focus();
                        /* The screen opening is not a rider reaching for the
                           field, so this focus does not bring the history up
                           over the dial. A click on the field does. */
                        setTyping(false);
                      },
                    );
                  }}
                  value={query()}
                  onInput={(e) => setQuery(e.currentTarget.value)}
                  /* The field takes real typing at every width - stop names and
                   places, not just numbers - so on a phone it raises the
                   keyboard like any field. The dial sheet steps aside for it:
                   two keyboards at once is one too many, and the dock's button
                   brings the dial back when the number is the way in. */
                  onFocus={() => {
                    setTyping(true);
                    if (!wide()) setDialOpen(false);
                  }}
                  /* Clicking a field that already has the caret raises no
                     focus event, and on a wide window the field has held it
                     since the screen opened - so the click is the gesture
                     that asks for the history there. */
                  onClick={() => setTyping(true)}
                  /* A beat's grace before the history goes: a tap on one of its
                     rows blurs the field before the link is followed, and a
                     panel that vanished on the blur took the tap with it. */
                  onBlur={() => window.setTimeout(() => setTyping(false), 150)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") setTyping(false);
                    if (e.key === "Enter") {
                      searches.remember(query());
                      setTyping(false);
                    }
                  }}
                  placeholder={t("searchAnything", lang())}
                  aria-label={t("searchAnything", lang())}
                  enterkeyhint="search"
                  autocomplete="off"
                  autocorrect="off"
                  spellcheck={false}
                  class="tnum grow bg-transparent text-[1.1rem] font-bold tracking-[-0.02em] text-foreground outline-none placeholder:text-[0.94rem] placeholder:font-medium placeholder:tracking-normal placeholder:text-subtle-foreground"
                />
                {/* One slot at the end of the field, holding whichever of the
                    two is the useful one. With something typed that is the
                    clear; with nothing typed the clear has nothing to do and
                    the slot is dead space, so it carries the way back to what
                    was opened before - which is the same reach as "what am I
                    looking for", and needs no chrome of its own to get there. */}
                <Show
                  when={query()}
                  fallback={
                    <Show when={recentRoutes().length > 0}>
                      <button
                        type="button"
                        aria-label={t("recent", lang())}
                        onClick={() => setSheet("recent")}
                        class="app-press flex size-7 shrink-0 items-center justify-center rounded-full text-subtle-foreground transition-colors duration-state hover:bg-secondary hover:text-foreground"
                      >
                        <HistoryIcon size={16} />
                      </button>
                    </Show>
                  }
                >
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

              {/* What was looked up last, hanging off the field the way any
                  search box's history does - which is what it is. It used to
                  be a tab over the results, which put a rider's own list in
                  the same rack as 巴士 and 鐵路 and made "what did I look at
                  yesterday" a filter on a search nobody had typed yet.

                  Floating rather than in the column: in flow it pushed the
                  dial half a screen down on a wide window and left the
                  category tiles stretched around a hole. Over the page it
                  costs the layout nothing and behaves like the autocomplete
                  it is - open while the field is in use and empty, gone at
                  the first keystroke or the first tap elsewhere. */}
              <Show when={historyOpen()}>
                <div
                  data-recent
                  class="app-rise absolute inset-x-0 top-[calc(100%+0.5rem)] z-30 flex flex-col gap-1 rounded-2xl border border-border bg-card p-1.5 shadow-lg"
                >
                  <span class="px-2 pt-1 text-[0.69rem] font-bold uppercase tracking-[0.08em] text-faint-foreground">
                    {t("recent", lang())}
                  </span>
                  <div class="app-scroll flex max-h-[13.5rem] flex-col overflow-y-auto overscroll-contain">
                    <For each={searches.recent()}>
                      {(term) => (
                        <div class="flex items-center">
                          {/* The words go back into the field rather than
                              anywhere else: a history entry is a question
                              asked again, and the answer is whatever the
                              question finds today - which is not necessarily
                              what it found last week. */}
                          <button
                            type="button"
                            onClick={() => {
                              setQuery(term);
                              setTyping(false);
                            }}
                            class="app-tap flex min-w-0 grow items-center gap-2.5 rounded-lg px-2 py-2 text-left"
                          >
                            <span class="shrink-0 text-faint-foreground">
                              <SearchIcon size={14} />
                            </span>
                            <span class="tnum truncate text-[0.88rem] font-semibold text-foreground">
                              {term}
                            </span>
                          </button>
                          <button
                            type="button"
                            aria-label={t("removeRecent", lang())}
                            onClick={() => searches.forget(term)}
                            class="app-press flex size-8 shrink-0 items-center justify-center rounded-lg text-subtle-foreground transition-colors duration-state hover:bg-secondary hover:text-foreground"
                          >
                            <CloseIcon size={13} />
                          </button>
                        </div>
                      )}
                    </For>
                  </div>
                </div>
              </Show>
            </div>

            {/* The same dial as the phone's, in the same frame: a desktop is a
              window a rider looks up a route number in too, and a strip of
              small shortcuts made them aim at a different pad on every
              screen. */}
            <div class="-mt-1 hidden flex-col gap-2 lg:flex">
              <SectionLabel>{t("routeNumber", lang())}</SectionLabel>
              <div class="rounded-2xl border border-border bg-card p-3 shadow-card">{keypad()}</div>
            </div>
          </div>
        </div>

        {/* What the search found, across the full width - and one card for
            all of it, the filter included.

            It used to be a chip row on the page, then a card of routes, then
            a labelled block of stops on the page again, then another card:
            four surfaces for one answer, and the eye had to work out each
            time whether it had crossed into something new. One frame with
            seams inside it says the same thing in one shape - the filter is
            part of the result, because it is what the result is a result of. */}
        <Card class="flex min-w-0 flex-col lg:min-h-0 lg:grow">
          {/* The list's mode, and at the far end of the row how many the mode
              found. The count used to head the list on a line of its own with
              the tab's own name repeated beside it - a heading that said what
              the pressed chip already says. On the row, it reads as the answer
              to the chip: 巴士 · 1383. */}
          <div class="flex shrink-0 items-center gap-2 border-b border-border px-2.5 py-1.5">
            <div
              role="tablist"
              aria-label={t("routes", lang())}
              data-search-tabs
              class="app-scroll flex min-w-0 grow gap-1 overflow-x-auto lg:flex-wrap"
            >
              <For each={tabs()}>
                {(entry) => {
                  const on = () => tab() === entry.id;
                  return (
                    <button
                      type="button"
                      role="tab"
                      aria-selected={on() ? "true" : "false"}
                      onClick={() => setTab(entry.id)}
                      class={[
                        "app-press flex h-7 shrink-0 items-center rounded-full px-2.5 text-[0.75rem] font-bold transition-colors duration-state",
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
            <Show when={found() > 0}>
              <span class="tnum shrink-0 pr-1.5 text-[0.75rem] font-semibold text-faint-foreground">
                {found()}
              </span>
            </Show>
          </div>

          {/* Everything the query answered, in the order a rider means it:
              the routes, then the stops whose name it is, then the places it
              is the destination of. Inside the frame they are seamed rather
              than boxed - the card is the box. */}
          {/* `[&>*]:shrink-0` is load-bearing: the virtualiser's own container
              is a box of a stated height with nothing in flow inside it - its
              rows are placed absolutely - so a flex column is free to squash
              it to nothing, and the rows it holds then spill over the stops
              below. */}
          <div
            class="app-scroll flex flex-col lg:min-h-0 lg:grow lg:overflow-y-auto [&>*]:shrink-0"
            /* A search a rider acted on is a search worth keeping: opening
               anything from these results is what turns the words in the field
               into history. Typing alone is not - "1", "11", "11X" on the way
               to 11X is three questions nobody asked. */
            onClick={(event) => {
              if (!empty() && (event.target as HTMLElement).closest("a")) {
                searches.remember(query());
              }
            }}
          >
            <Show
              when={!nothing()}
              fallback={
                <div class="py-6">
                  <EmptyState title={t("noResults", lang())} />
                </div>
              }
            >
              <Show when={showRoutes() && listed().length > 0}>
                <RouteList routes={listed()} lang={lang()} />
              </Show>

              <Show when={showStops() && stops().length > 0}>
                <SeamLabel first={!showRoutes() || listed().length === 0}>
                  {t("stopsMatched", lang())}
                </SeamLabel>
                <For each={stops()}>
                  {(match, index) => (
                    <>
                      <Show when={index() > 0}>
                        <Hairline />
                      </Show>
                      <a
                        {...useLinkProps(stopLink(match.stopId))}
                        class="app-tap flex items-center gap-3 px-3.5 py-2.5"
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
              </Show>

              <Show when={showDest() && destinations().length > 0}>
                <SeamLabel
                  first={
                    (!showRoutes() || listed().length === 0) &&
                    (!showStops() || stops().length === 0)
                  }
                >
                  {t("toLabel", lang())}
                </SeamLabel>
                <RouteRows routes={destinations()} lang={lang()} />
              </Show>
            </Show>
          </div>
        </Card>
      </div>
      {/* The dial itself, in the house sheet: handle, drag, and the drawer
          ground its keys step up from. Non-modal, so the list above it stays
          live, and dismissible - pushed down it is gone until the dock's
          button asks for it back. It rests above the tab bar rather than
          over it: the tabs are the way off this screen and stay pressable
          under the sheet, so the card keeps its corners and the bar keeps
          its safe-area inset. A phone matter only: a wide window keeps the
          dial in its panel.

          The clearance over the bar is the sheet's own bottom padding and
          not a `bottom` offset, so that the sheet's "off screen" - a
          translate of its full height - is off the window rather than a
          card's width short of it. Held short, a push to the floor went
          further than the sheet had to travel, and the drawer sprang back
          up that far on release before it went; and what it went to was a
          band of card still over the bar, so the last of the dismissal was
          a disappearance rather than a slide. That padding lies over the
          tab bar, so it takes no pointer: the card inside it does, and the
          strip below the card is the bar's again. */}
      {/* What was opened before, as the rows themselves rather than as words:
          a route a rider recognises by its plate and where it is going, not by
          the digits they happened to type to find it. It is a list to look at
          rather than a list to complete a field from, so it comes up as a
          sheet - at every width, because a desktop rider has the same question
          and the drawer is the app's answer to "show me this over what I am
          looking at". */}
      <Drawer
        open={sheet() === "recent"}
        onClose={() => setSheet(undefined)}
        label={t("recent", lang())}
        /* A dialog: it is a list to pick from, so it takes the scrim, the
           Escape and the tap outside. */
        modal
        /* `z-50`, because on a phone the dial is already up in a sheet of its
           own at `z-40` and this one is asked for from above it - a history
           opened behind the keypad it was reached from is a history nobody
           can see. */
        class="z-50 max-w-[32rem] !pb-[calc(var(--tabbar-height)+0.25rem)] lg:!pb-4"
      >
        <div class="flex flex-col gap-2.5 px-3.5 pb-4 pt-1">
          <div class="flex items-center justify-between gap-3">
            <SectionLabel>{t("recent", lang())}</SectionLabel>
            <button
              type="button"
              onClick={() => {
                frequent.clear();
                setSheet(undefined);
              }}
              class="app-press rounded-lg px-2 py-1 text-[0.75rem] font-bold text-primary"
            >
              {t("clearQuery", lang())}
            </button>
          </div>
          <Card>
            <RouteRows
              routes={recentRoutes()}
              lang={lang()}
              onRemove={(key) => frequent.forget(key)}
            />
          </Card>
        </div>
      </Drawer>

      <Show when={!wide()}>
        <Drawer
          open={dialOpen()}
          onClose={() => setDialOpen(false)}
          scroll={false}
          /* The pad is not one fixed slab: letters that can follow the typed
             digits come and go, and the sheet glides to each height instead
             of jumping - the library animates the resize itself. */
          transitionResize
          class="pointer-events-none max-w-[27.5rem] !pb-[calc(var(--tabbar-height)+0.25rem)] [&>*]:pointer-events-auto"
          label={t("routeNumber", lang())}
        >
          {/* Clear of the grab handle above it: the pad is what the thumb is
              aiming at, and the top row of keys sat close enough to the bar
              to catch a drag meant for the sheet. */}
          <div class="mx-auto mt-[10px] w-full px-4 pb-3 pt-1">{keypad()}</div>
        </Drawer>
      </Show>
    </Page>
  );
}

/**
 * The categories, at the head of the screen: the way in when the trip is known
 * by its kind rather than by its number, and the only thing here worth reading
 * before anything has been typed. They used to sit below the recent list,
 * where thirty remembered routes pushed them off the bottom of the phone.
 *
 * They are two different things at the two widths, because they have two
 * different jobs. On a phone they are a strip of chips the thumb swipes -
 * glyph and name, nothing else - sat between the switch and the field, where
 * they cost the list beneath them a single row. On a wide window there is a
 * column standing empty beside the dial, so they become tiles: the same
 * glyph, the name, and the line that says what is in the category.
 */
function Categories(props: {
  lang: Lang;
  class?: string;
  /** Whether the whole catalogue is up, which the address is the record of. */
  allOpen: boolean;
  onAllOpen: (open: boolean) => void;
}) {
  const db = useDb();
  const allOpen = () => props.allOpen;
  const setAllOpen = (open: boolean) => props.onAllOpen(open);
  /* How many routes are in each, counted from the database rather than written
     down. It used to be three of the numbers themselves, which said what the
     category holds but not how much of it - and three plates beside a name
     read as the answer rather than as a sample of it. Only the six that are
     shown are counted; the other eleven would be paid for and never read. */
  const counts = createMemo(() => categoryCounts(db(), SHOWN_CATEGORIES));
  /* The whole catalogue's counts, and only once the sheet that shows them is
     open: seventeen categories over four thousand routes is a pass nobody
     should pay for on a screen they may never open. */
  const allCounts = createMemo(() => (allOpen() ? categoryCounts(db()) : null));

  /* The way to the other eleven, in the same shape at both widths: a chip at
     the end of the phone's row, and the same chip where the heading's link
     used to be on a desktop. It used to be a text link there, which meant one
     word did two different things depending on the window - and reading as a
     link, it promised to leave the screen. */
  const viewAll = () => (
    <button
      type="button"
      onClick={() => setAllOpen(true)}
      class="app-press flex shrink-0 items-center gap-0.5 self-center rounded-full bg-secondary py-1 pl-2.5 pr-1.5 text-[0.69rem] font-bold text-muted-foreground transition-colors duration-state hover:text-foreground"
    >
      {t("viewAll", props.lang)}
      <ChevronRightIcon size={12} />
    </button>
  );

  return (
    /* `min-w-0`: the strip below is a flex line of chips that do not shrink,
       and a grid column sized to `auto` would take their whole sum - which on
       a phone is twice the window, and the page slides sideways with it. */
    <section class={`flex min-w-0 flex-col gap-1.5 lg:gap-2.5 ${props.class ?? ""}`}>
      {/* The heading is a wide window's. On a phone the row is six coloured
          chips with names in them, which says 路線分類 more plainly than the
          words would, and the words were costing a line of a screen whose job
          is the list underneath. The chip at the end of the row is where 睇晒
          went. */}
      <div class="hidden lg:block">
        <SectionLabel trailing={viewAll()}>{t("categories", props.lang)}</SectionLabel>
      </div>

      {/* Six of them, three across and two down at every wide width. Sized
          from a minimum tile instead, the block re-flowed to four columns and
          one orphan on a big monitor and to two on a small laptop - a shop
          window whose shape changed with the furniture. Three by two is the
          shape the six of them have.

          The two rows share whatever height the dial beside them takes, so
          the block ends level with the keypad's panel rather than stopping
          halfway down and leaving a hand's width of nothing under it. */}
      <div class="app-scroll -mx-3.5 flex gap-1.5 overflow-x-auto px-3.5 lg:mx-0 lg:grid lg:grow lg:grid-cols-3 lg:grid-rows-2 lg:gap-4 lg:overflow-visible lg:px-0">
        <For each={SHOWN_CATEGORIES}>
          {(item) => (
            /* A chip on a phone, a tile on a desktop. On the tile the glyph
               sits at the top and the words at the foot: given a tile taller
               than the words need, `justify-between` is what keeps them a
               caption rather than leaving them stranded in the middle of an
               empty card. */
            <a
              {...useLinkProps(browseLink(item.id))}
              class="app-press flex shrink-0 items-center gap-1 rounded-full bg-card py-0.5 pl-0.5 pr-2 shadow-card lg:items-stretch lg:gap-3 lg:rounded-xl lg:p-3.5"
            >
              <span class="flex min-w-0 items-center gap-2 lg:grow lg:flex-col lg:items-stretch lg:justify-between lg:gap-1.5">
                {/* The glyph in the category's own colour, on a wash of it -
                    the coloured bar this replaces marked the tile without
                    saying anything about what was in it. */}
                <span
                  class="flex size-6 shrink-0 items-center justify-center rounded-full lg:size-9 lg:rounded-lg"
                  style={{
                    background: `color-mix(in srgb, ${item.accent} 14%, transparent)`,
                    color: item.accent,
                  }}
                >
                  <CategoryIcon id={item.id} size={13} />
                </span>
                <span class="flex flex-col gap-1">
                  <span class="whitespace-nowrap text-[0.69rem] font-bold text-foreground lg:whitespace-normal lg:text-[0.88rem]">
                    {pick(item.name, props.lang)}
                  </span>
                  {/* The line of examples is what a wide tile has room for; a
                      chip is the name and the glyph, and nothing else. */}
                  <span class="hidden text-[0.75rem] font-medium leading-snug text-subtle-foreground lg:block">
                    {pick(item.hint, props.lang)}
                  </span>
                  {/* And how many there are, in the category's own colour -
                      the size of the answer, which three sample plates could
                      never give. */}
                  <span
                    class="tnum hidden text-[0.75rem] font-bold lg:block"
                    style={{ color: item.accent }}
                  >
                    {counts()[item.id]} {t("routesCount", props.lang)}
                  </span>
                </span>
              </span>
            </a>
          )}
        </For>

        {/* The rest of them, at the end of the row where a thumb arrives after
            swiping the six. A phone has no room for the other eleven and no
            heading to hang 睇晒 off, so this chip is both - and it opens them
            over the screen rather than navigating away from a search that is
            half typed. */}
        <span class="contents lg:hidden">{viewAll()}</span>
      </div>

      {/* Every category, as a sheet. The browse screen lists them too, but
          reaching it means leaving the search behind; this is the same list
          brought to the rider instead. */}
      <Drawer
        open={allOpen()}
        onClose={() => setAllOpen(false)}
        modal
        label={t("categories", props.lang)}
        class="z-50 max-w-[32rem] !pb-[calc(var(--tabbar-height)+0.25rem)] lg:!pb-4"
      >
        <div class="flex flex-col gap-2.5 px-3.5 pb-4 pt-1">
          <SectionLabel>{t("categories", props.lang)}</SectionLabel>
          <Card>
            <For each={CATEGORIES}>
              {(item, index) => (
                <>
                  <Show when={index() > 0}>
                    <Hairline />
                  </Show>
                  <a
                    {...useLinkProps(browseLink(item.id))}
                    class="app-tap flex items-center gap-3 px-3.5 py-2.5"
                  >
                    <span
                      class="flex size-8 shrink-0 items-center justify-center rounded-lg"
                      style={{
                        background: `color-mix(in srgb, ${item.accent} 14%, transparent)`,
                        color: item.accent,
                      }}
                    >
                      <CategoryIcon id={item.id} size={16} />
                    </span>
                    <span class="flex min-w-0 grow flex-col gap-0.5">
                      <span class="truncate text-[0.88rem] font-bold text-foreground">
                        {pick(item.name, props.lang)}
                      </span>
                      <span class="truncate text-[0.75rem] font-medium text-subtle-foreground">
                        {pick(item.hint, props.lang)}
                      </span>
                    </span>
                    {/* How big the category is, in its own colour - the one
                        thing a name and a line of examples do not say. */}
                    <span
                      class="tnum shrink-0 text-[0.75rem] font-bold"
                      style={{ color: item.accent }}
                    >
                      {allCounts()?.[item.id]} {t("routesCount", props.lang)}
                    </span>
                    <span class="shrink-0 text-faint-foreground">
                      <ChevronRightIcon size={14} />
                    </span>
                  </a>
                </>
              )}
            </For>
          </Card>
        </div>
      </Drawer>
    </section>
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
 * It is the same pad at both widths, down to the last key.
 *
 * A line under it used to explain the dimmed keys. A key that is grey and
 * will not press already says it, and the sentence was one more thing to read
 * on a pad whose whole point is that it needs none.
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
          "app-press flex items-center justify-center font-bold transition-colors duration-press",
          size,
          { "app-pop": order !== undefined },
          {
            "bg-raised text-foreground active:bg-primary active:text-primary-foreground": enabled(),
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
        "app-press flex items-center justify-center rounded-xl transition-colors duration-press",
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
    /* `app-seamless`: the pad draws its edge once, around itself - see the
       rule in app.css. Twenty-five hairlines in a grid read as graph paper. */
    <div class="app-seamless flex w-full flex-col gap-2">
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
          class="app-scroll grid w-[31%] shrink-0 grid-cols-2 content-start gap-2 overflow-y-auto"
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
    </div>
  );
}
