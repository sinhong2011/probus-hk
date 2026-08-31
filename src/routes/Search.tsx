import { useLinkProps, useNavigate, useSearch } from "@tanstack/solid-router";
import { For, Show, createEffect, createMemo, createSignal } from "solid-js";
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
  SearchIcon,
  TrashIcon,
} from "~/components/Icons";
import { RoutePlate } from "~/components/RoutePlate";
import { browseLink, routeLink, stopLink } from "~/lib/links";
import { createWide } from "~/lib/wide";
import { useDb } from "~/data/context";
import { CATEGORIES, categorySamples } from "~/data/categories";
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

/** A list of routes, one card, with a hairline between rows. */
function RouteList(props: {
  routes: KeyedRoute[];
  lang: Lang;
  onRemove?: (key: string) => void;
  /**
   * On a wide window, take the height the pane gives and scroll the rows
   * inside the card rather than letting the card run past the window.
   *
   * A card whose own top and bottom edges scroll out of view stops reading as
   * a card - the list simply bleeds off both ends of the screen. Held to the
   * pane, the frame stays put and only its contents move, which is also what
   * keeps the tabs above it in reach of a rider halfway down four thousand
   * routes. A phone has no pane to hold it to: there the page scrolls.
   */
  fills?: boolean;
}) {
  return (
    <Card class={props.fills ? "lg:flex lg:min-h-0 lg:flex-1 lg:flex-col" : ""}>
      <div
        class={
          props.fills
            ? "app-scroll lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:overscroll-contain"
            : ""
        }
      >
        <VirtualRows items={props.routes} estimate={64} divided>
          {(route) => (
            <RouteItem
              route={route}
              lang={props.lang}
              onRemove={props.onRemove ? () => props.onRemove?.(route.key) : undefined}
            />
          )}
        </VirtualRows>
      </div>
    </Card>
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
  const tab = (): Tab => params().tab ?? "recent";
  const setTab = (id: Tab) =>
    void navigate({
      to: "/search",
      search: (prev) => {
        const { tab: _, ...rest } = prev;
        return id === "recent" ? rest : { ...rest, tab: id };
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
  const [dialOpen, setDialOpen] = createSignal(true);

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

          <Categories lang={lang()} class="order-2 lg:col-start-2 lg:row-span-2 lg:row-start-1" />

          <div class="order-3 flex min-w-0 flex-col gap-3 lg:col-start-1 lg:row-start-2 lg:gap-6">
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
                      if (window.matchMedia("(min-width: 64rem)").matches) el.focus();
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
                  if (!wide()) setDialOpen(false);
                }}
                placeholder={t("searchAnything", lang())}
                aria-label={t("searchAnything", lang())}
                enterkeyhint="search"
                autocomplete="off"
                autocorrect="off"
                spellcheck={false}
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
              <div class="rounded-2xl border border-border bg-card p-3 shadow-card">{keypad()}</div>
            </div>
          </div>
        </div>

        {/* What the search found, across the full width. On a wide window this
          is the half that scrolls; on a phone it is simply the rest of the
          page. */}
        <div class="flex min-w-0 flex-col gap-4 lg:min-h-0 lg:grow">
          {/* The list's mode, and at the far end of the row how many the mode
            found. The count used to head the list on a line of its own with
            the tab's own name repeated beside it - a heading that said what
            the pressed chip already says. On the row, it reads as the answer
            to the chip: 巴士 · 1383. */}
          <div class="flex shrink-0 items-center gap-3">
            <div
              role="tablist"
              aria-label={t("routes", lang())}
              data-search-tabs
              class="app-scroll flex min-w-0 grow gap-1.5 overflow-x-auto lg:flex-wrap"
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
                        "app-press flex h-8 shrink-0 items-center rounded-full px-3 text-[0.81rem] font-bold transition-colors duration-state",
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
            <Show when={listed().length > 0}>
              <span class="tnum shrink-0 text-[0.75rem] font-semibold text-faint-foreground">
                {listed().length}
              </span>
            </Show>
          </div>

          {/* The blocks the search found. On a wide window the route list
              fills this space and scrolls inside its own card; the stop and
              destination blocks that a typed place adds sit under it and are
              given the height they need, and if the three together outgrow
              the pane, the pane scrolls as well. On a phone the page scrolls
              and none of that applies. */}
          <div class="app-scroll flex flex-col gap-4 lg:min-h-0 lg:grow lg:overflow-y-auto">
            <Show when={!nothing()} fallback={<EmptyState title={t("noResults", lang())} />}>
              {/* The recent tab's rows are the same rows, with a way off the list
              on each: 最近搜尋 is a list a rider owns, not a result. */}
              <Show
                when={listed().length > 0}
                fallback={
                  <Show when={shownTab() === "recent"}>
                    <EmptyState title={t("noRecent", lang())} hint={t("noRecentHint", lang())} />
                  </Show>
                }
              >
                {/* No heading of its own: the pressed chip above names the
                    list and the count beside it sizes it.

                    On a wide window it takes the pane's height and scrolls
                    inside its own card - with a floor, so that a query which
                    also matched stops and places leaves this list a few rows
                    rather than a sliver. */}
                <section
                  class="flex flex-col lg:min-h-56 lg:flex-1"
                  data-recent={shownTab() === "recent" || undefined}
                >
                  <RouteList
                    fills
                    routes={listed()}
                    lang={lang()}
                    onRemove={shownTab() === "recent" ? (key) => frequent.forget(key) : undefined}
                  />
                </section>
              </Show>

              <Show when={stops().length > 0}>
                <section class="flex flex-col gap-2.5 lg:shrink-0">
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
                  </Card>
                </section>
              </Show>

              <Show when={destinations().length > 0}>
                <section class="flex flex-col gap-2.5 lg:shrink-0">
                  <SectionLabel>{t("towards", lang())}</SectionLabel>
                  <RouteList routes={destinations()} lang={lang()} />
                </section>
              </Show>
            </Show>
          </div>
        </div>
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
function Categories(props: { lang: Lang; class?: string }) {
  const db = useDb();
  /* Three numbers per tile, taken from the database rather than written down:
     a category whose sample is stale is worse than one with none. Three is a
     sample; a fourth was a list starting to compete with the name. */
  const samples = createMemo(() => categorySamples(db(), SHOWN_CATEGORIES, 3));

  return (
    /* `min-w-0`: the strip below is a flex line of chips that do not shrink,
       and a grid column sized to `auto` would take their whole sum - which on
       a phone is twice the window, and the page slides sideways with it. */
    <section class={`flex min-w-0 flex-col gap-2.5 ${props.class ?? ""}`}>
      <SectionLabel
        trailing={
          <a {...useLinkProps({ to: "/browse" })} class="text-[0.75rem] font-bold text-primary">
            {t("viewAll", props.lang)}
          </a>
        }
      >
        {t("categories", props.lang)}
      </SectionLabel>

      {/* Six of them, three across and two down at every wide width. Sized
          from a minimum tile instead, the block re-flowed to four columns and
          one orphan on a big monitor and to two on a small laptop - a shop
          window whose shape changed with the furniture. Three by two is the
          shape the six of them have.

          The two rows share whatever height the dial beside them takes, so
          the block ends level with the keypad's panel rather than stopping
          halfway down and leaving a hand's width of nothing under it. */}
      <div class="app-scroll -mx-3.5 flex gap-2 overflow-x-auto px-3.5 lg:mx-0 lg:grid lg:grow lg:grid-cols-3 lg:grid-rows-2 lg:gap-4 lg:overflow-visible lg:px-0">
        <For each={SHOWN_CATEGORIES}>
          {(item) => (
            /* A chip on a phone, a tile on a desktop. On the tile the glyph
               sits at the top and the words at the foot: given a tile taller
               than the words need, `justify-between` is what keeps them a
               caption rather than leaving them stranded in the middle of an
               empty card. */
            <a
              {...useLinkProps(browseLink(item.id))}
              class="app-press flex shrink-0 items-center gap-2 rounded-full bg-card py-1.5 pl-1.5 pr-3.5 shadow-card lg:items-stretch lg:gap-3 lg:rounded-xl lg:p-3.5"
            >
              <span class="flex min-w-0 items-center gap-2 lg:grow lg:flex-col lg:items-stretch lg:justify-between lg:gap-1.5">
                {/* The glyph in the category's own colour, on a wash of it -
                    the coloured bar this replaces marked the tile without
                    saying anything about what was in it. */}
                <span
                  class="flex size-8 shrink-0 items-center justify-center rounded-full lg:size-9 lg:rounded-lg"
                  style={{
                    background: `color-mix(in srgb, ${item.accent} 14%, transparent)`,
                    color: item.accent,
                  }}
                >
                  <CategoryIcon id={item.id} size={17} />
                </span>
                <span class="flex flex-col gap-1">
                  <span class="whitespace-nowrap text-[0.81rem] font-bold text-foreground lg:whitespace-normal lg:text-[0.88rem]">
                    {pick(item.name, props.lang)}
                  </span>
                  {/* The line of examples is what a wide tile has room for; a
                      chip is the name and the glyph, and nothing else. */}
                  <span class="hidden text-[0.75rem] font-medium leading-snug text-subtle-foreground lg:block">
                    {pick(item.hint, props.lang)}
                  </span>
                </span>
              </span>

              {/* A few of the routes inside, down the tile's right-hand edge.
                  "過海路線" is an abstraction; 101 is the thing a rider
                  actually knows, and three of them say what the category
                  holds faster than the line of prose beneath the name does.

                  On their operators' own plates, not on a wash of the
                  category's accent: a route number in this app is red for
                  九巴 and yellow for 城巴 everywhere else it appears, and a
                  sample that recoloured them by category would be teaching
                  the wrong thing in the one place a rider is learning what
                  the category holds. */}
              <span class="hidden shrink-0 flex-col items-end gap-1 lg:flex">
                <For each={samples()[item.id] ?? []}>
                  {(sample) => <RoutePlate route={sample.route} co={sample.co} size="xs" />}
                </For>
              </span>
            </a>
          )}
        </For>
      </div>
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
