import { useLinkProps, useLocation, useNavigate } from "@tanstack/solid-router";
import { For, Show, createEffect, getOwner, lazy, runWithOwner } from "solid-js";
import { Loading } from "@solidjs/web";
import type { JSX } from "@solidjs/web";
import { t, type Lang, type MessageKey } from "~/lib/i18n";
import { trail } from "~/stores/trail";
import { settings, type ThemeChoice } from "~/stores/settings";
import { pointerOrigin, swapTheme } from "~/lib/themeSwap";
import {
  createHotkey,
  createHotkeys,
  formatForDisplay,
  type RegisterableHotkey,
} from "~/lib/tanstack/hotkeys";
import { AppMark } from "./AppMark";
import { Segmented } from "./Chrome";
import { MoreSheet } from "./MoreSheet";
import { SlidingPill } from "./SlidingPill";
import { sheets } from "~/stores/sheets";
import {
  BookmarkIcon,
  MegaphoneIcon,
  MoreIcon,
  PinIcon,
  SearchIcon,
  MoonIcon,
  SidebarIcon,
  SunIcon,
  SwapIcon,
  SystemIcon,
  TrainIcon,
  SettingsIcon,
  type IconProps,
} from "./Icons";

/**
 * The keys, named the way the machine in front of the rider names them: ⌘K
 * on a Mac, Ctrl+K elsewhere. Read once - the platform cannot change while
 * the page is open.
 */
const SEARCH_KEY = "Mod+K";
const SEARCH_SHORTCUT = formatForDisplay(SEARCH_KEY);

/** The tab at this position in the navigation is reached with this key. */
const tabKey = (index: number): RegisterableHotkey => `Alt+${index + 1}` as RegisterableHotkey;

/** The places the navigation itself can take you, and nowhere else. */
type TabPath = "/" | "/saved" | "/search" | "/rail" | "/notices";

interface Destination {
  href: TabPath;
  label: MessageKey;
  Icon: (p: IconProps) => JSX.Element;
}

/** Where the app can take you. Settings is not one of these; it is the drawer. */
const TABS: Destination[] = [
  { href: "/", label: "home", Icon: PinIcon },
  { href: "/saved", label: "saved", Icon: BookmarkIcon },
  { href: "/search", label: "search", Icon: SearchIcon },
  { href: "/rail", label: "rail", Icon: TrainIcon },
  { href: "/notices", label: "notices", Icon: MegaphoneIcon },
];

/** The sidebar lists these; search is the box above them, not a row in them. */
const SIDEBAR_TABS = TABS.filter((tab) => tab.href !== "/search");

/**
 * A thumb reaches five things comfortably at the foot of a phone, and the bar
 * was asking it to reach six. The screens a rider lives in keep their tabs;
 * the railway and the notices ride behind "more", with settings.
 */
const PHONE_TABS = TABS.filter((tab) => tab.href !== "/rail" && tab.href !== "/notices");

/** The settings drawer's code, fetched the first time it is asked for. */
const SettingsSheet = lazy(() => import("./SettingsSheet"));
/** The search-range sheet carries the map library, so it too waits its turn. */
const RangeSheet = lazy(() => import("./RangeSheet"));

/**
 * A bottom bar on a phone; a sidebar on a desktop.
 *
 * They are written as two things rather than one bar with a pile of `lg:`
 * overrides, because they are two things: a thumb reaching six icons at the
 * bottom of a 390px screen, and a pointer reading a labelled list down the side
 * of a 1440px window. The phone bar rotated ninety degrees was neither.
 */
export function TabBar(props: { lang: Lang }) {
  const location = useLocation();
  /*
   * A route or a stop page is not a tab, so nothing here used to light up once
   * you drilled into one - the whole bar went dark and the screen you were on
   * belonged to nothing. A detail screen is owned by the tab you reached it
   * from, and that tab stays lit while you are inside it.
   */
  const isActive = (href: string) => trail.owns(href, location().pathname);

  /*
   * A keyboard reaches every tab without a pointer: ⌥ and a digit, in the
   * order the sidebar lists them. Alt rather than ⌘, because ⌘1 to ⌘9 are
   * the browser's own tabs and it will not give them up.
   */
  const navigate = useNavigate();
  createHotkeys([
    ...TABS.map((tab, index) => ({
      hotkey: tabKey(index),
      callback: () => void navigate({ to: tab.href }),
    })),
    // ⌥6 still reaches settings, which is now a sheet rather than a place.
    { hotkey: tabKey(TABS.length), callback: () => sheets.openSettings() },
  ]);

  return (
    <>
      <PhoneBar lang={props.lang} isActive={isActive} />
      <Sidebar lang={props.lang} isActive={isActive} />
      <MoreSheet lang={props.lang} />
      {/* Not mounted until first asked for: the drawer's code is its own
          chunk, and a session that never opens settings never fetches it. */}
      <Show when={sheets.settingsWanted()} keyed>
        <Loading fallback={null}>
          <SettingsSheet />
        </Loading>
      </Show>
      <Show when={sheets.rangeWanted()} keyed>
        <Loading fallback={null}>
          <RangeSheet />
        </Loading>
      </Show>
    </>
  );
}

/**
 * Sets `aria-current` from an effect: bound in the markup it never updated.
 *
 * The router calls a link's ref from outside any owner, so an effect created
 * there would never be disposed. The owner is taken where the ref is made -
 * inside the component - and the effect is put under it when the element
 * arrives.
 */
function current(el: HTMLAnchorElement, active: () => boolean, owner = getOwner()) {
  runWithOwner(owner, () =>
    createEffect(active, (on) => el.setAttribute("aria-current", on ? "page" : "false")),
  );
}

function PhoneBar(props: { lang: Lang; isActive: (href: string) => boolean }) {
  /* "More" owns whatever it holds: the sheet while it is up, and the railway
     or notices screens whose tabs it swallowed. */
  const moreActive = () =>
    sheets.moreOpen() || props.isActive("/rail") || props.isActive("/notices");
  /* While one of the app's own sheets is up the bar withdraws below the edge:
     the sheet replaces it as the thing the thumb is using, and a dimmed bar
     peeking around a scrim only says "you cannot press this". */
  const sheetUp = () => sheets.moreOpen() || sheets.settingsOpen();

  return (
    <nav
      aria-label={t("navigation", props.lang)}
      class={[
        "pb-safe-bottom fixed inset-x-0 bottom-0 z-30 border-t border-border px-1 pt-2.5 lg:hidden",
        "transition-transform duration-state ease-[var(--ease-spring)]",
        { "translate-y-full": sheetUp() },
      ]}
      style={{
        background: "color-mix(in srgb, var(--background) 94%, transparent)",
        "backdrop-filter": "blur(18px)",
        // Safari still needs the prefix, and this bar sits over live content on
        // every screen - unprefixed it is simply a flat panel on an iPhone.
        "-webkit-backdrop-filter": "blur(18px)",
      }}
    >
      <div class="mx-auto flex w-full max-w-[46rem] items-start gap-0.5">
        <For each={PHONE_TABS}>
          {(tab) => (
            <a
              {...useLinkProps({
                to: tab.href,
                ref: (
                  (owner) => (el: HTMLAnchorElement) =>
                    current(el, () => props.isActive(tab.href), owner)
                )(getOwner()),
              })}
              class={[
                "app-press relative flex h-12 min-w-0 flex-1 flex-col items-center justify-start gap-[5px] transition-colors duration-state",
                {
                  "text-primary": props.isActive(tab.href),
                  "text-subtle-foreground": !props.isActive(tab.href),
                },
              ]}
            >
              <span
                class={[
                  "flex items-center justify-center rounded-xl transition-transform duration-state ease-[var(--ease-spring)]",
                  { "scale-110": props.isActive(tab.href) },
                ]}
              >
                <tab.Icon size={19} />
              </span>
              <span
                class={[
                  "truncate text-[0.69rem]",
                  {
                    "font-bold": props.isActive(tab.href),
                    "font-semibold": !props.isActive(tab.href),
                  },
                ]}
              >
                {t(tab.label, props.lang)}
              </span>
            </a>
          )}
        </For>

        <button
          type="button"
          onClick={() => sheets.openMore()}
          aria-expanded={sheets.moreOpen() ? "true" : "false"}
          aria-current={moreActive() ? "page" : "false"}
          class={[
            "app-press relative flex h-12 min-w-0 flex-1 flex-col items-center justify-start gap-[5px] transition-colors duration-state",
            {
              "text-primary": moreActive(),
              "text-subtle-foreground": !moreActive(),
            },
          ]}
        >
          <span
            class={[
              "flex items-center justify-center rounded-xl transition-transform duration-state ease-[var(--ease-spring)]",
              { "scale-110": moreActive() },
            ]}
          >
            <MoreIcon size={19} />
          </span>
          <span class={["truncate text-[0.69rem]", moreActive() ? "font-bold" : "font-semibold"]}>
            {t("more", props.lang)}
          </span>
        </button>
      </div>
    </nav>
  );
}

/**
 * The desktop sidebar: a panel that floats over the page rather than a wall
 * welded to its edge - identity and a way to search at the top, the
 * destinations under a heading, and the things set once pinned to the bottom.
 *
 * Collapsed it is an icon rail for people who already know the app; open it
 * names every destination. Search is the box rather than another row: it is the
 * one place in the app you arrive at by typing, and ⌘K puts it a key away.
 */
function Sidebar(props: { lang: Lang; isActive: (href: string) => boolean }) {
  const open = () => settings.railOpen();
  /** -1 while a screen outside the list is up, which parks the pill. */
  const activeIndex = () => SIDEBAR_TABS.findIndex((tab) => props.isActive(tab.href));
  const searching = () => props.isActive("/search");
  let searchLink!: HTMLAnchorElement;

  /*
   * ⌘K is where a pointer-and-keyboard user reaches for search without
   * thinking, and `/` is where the rest of the web has taught them to look.
   * The link is clicked rather than the router called directly, so the
   * keystroke and the box take exactly the same path. A bare `/` typed into a
   * field is a `/`, not a shortcut; the registry knows to leave those alone.
   */
  createHotkey(SEARCH_KEY, () => searchLink.click());
  createHotkey("/", () => searchLink.click());

  return (
    <nav
      aria-label={t("navigation", props.lang)}
      class="fixed inset-y-3 left-3 z-30 hidden flex-col rounded-2xl border border-border bg-card p-3 shadow-card transition-[width] duration-state ease-[var(--ease-spring)] lg:flex"
      style={{ width: open() ? "15rem" : "4.5rem" }}
    >
      <div class={["flex items-center gap-2.5", { "flex-col gap-2": !open() }]}>
        <a
          {...useLinkProps({ to: "/" })}
          aria-label={t("appName", props.lang)}
          class="app-press flex shrink-0 items-center gap-2.5 rounded-xl px-0.5 py-1"
        >
          <AppMark size={26} />
          <Show when={open()}>
            <span class="whitespace-nowrap text-[1rem] font-bold tracking-[-0.02em] text-foreground">
              {t("appName", props.lang)}
            </span>
          </Show>
        </a>

        <button
          type="button"
          onClick={() => settings.setRailOpen(!open())}
          aria-label={t(open() ? "collapseNav" : "expandNav", props.lang)}
          class={[
            "app-press flex size-8 shrink-0 items-center justify-center rounded-lg text-subtle-foreground transition-colors hover:bg-secondary hover:text-foreground",
            { "ml-auto": open() },
          ]}
        >
          {/* The panel itself, not an arrow: the button means "the sidebar",
              and it stays the same shape whichever way it is about to go. */}
          <SidebarIcon size={16} />
        </button>
      </div>

      {/* The way in by typing, which is how a route number is looked up. */}
      <a
        {...useLinkProps({
          to: "/search",
          ref: ((owner) => (el: HTMLAnchorElement) => {
            searchLink = el;
            current(el, searching, owner);
          })(getOwner()),
        })}
        class={[
          "app-press mt-3 flex h-9 shrink-0 items-center gap-2 rounded-lg transition-colors",
          {
            "bg-primary-muted text-primary": searching(),
            "bg-secondary text-subtle-foreground hover:text-foreground": !searching(),
            "justify-center px-0": !open(),
            "px-2.5": open(),
          },
        ]}
      >
        <SearchIcon size={15} />
        <Show when={open()}>
          <span class="min-w-0 grow truncate text-left text-[0.88rem] font-semibold">
            {t("searchRoutes", props.lang)}
          </span>
          <kbd class="shrink-0 rounded bg-secondary px-1.5 py-0.5 text-[0.75rem] font-bold text-faint-foreground">
            {SEARCH_SHORTCUT}
          </kbd>
        </Show>
      </a>

      <div class="app-scroll relative mt-4 flex min-h-0 grow flex-col gap-1 overflow-y-auto">
        <Show when={open()}>
          <span class="px-3 pb-1 text-[0.75rem] font-bold uppercase tracking-[0.16em] text-faint-foreground">
            {t("navigation", props.lang)}
          </span>
        </Show>

        {/* One pill down the rail, the same component the search/plan switch
            slides sideways. */}
        <div class="relative flex flex-col gap-1">
          <Show when={activeIndex() >= 0}>
            <SlidingPill
              active={activeIndex()}
              axis="y"
              class="inset-x-0 rounded-lg bg-primary-muted"
            />
          </Show>

          <For each={SIDEBAR_TABS}>
            {(tab) => (
              <Row
                tab={tab}
                lang={props.lang}
                isActive={props.isActive}
                open={open()}
                shortcut={formatForDisplay(tabKey(TABS.indexOf(tab)))}
              />
            )}
          </For>
        </div>
      </div>

      <div class="flex shrink-0 flex-col gap-1 pt-3">
        <SettingsRow
          lang={props.lang}
          open={open()}
          shortcut={formatForDisplay(tabKey(TABS.length))}
        />

        <div class="my-1 h-px bg-border" />

        <ThemeSwitch lang={props.lang} open={open()} />

        {/* A bilingual city reads a bus list in whichever language is in front
            of it, so the switch sits where an app usually keeps the account it
            is signed into - the last row, always in the same place. */}
        <button
          type="button"
          onClick={() => settings.setLang(props.lang === "zh" ? "en" : "zh")}
          class={[
            "app-press flex h-10 items-center gap-2.5 rounded-lg text-subtle-foreground transition-colors hover:bg-secondary hover:text-foreground",
            { "justify-center px-0": !open(), "px-2.5": open() },
          ]}
        >
          <span class="flex size-6 shrink-0 items-center justify-center rounded-md bg-secondary text-[0.75rem] font-bold text-foreground">
            {props.lang === "zh" ? "中" : "EN"}
          </span>
          <Show when={open()}>
            <span class="min-w-0 grow truncate text-left text-[0.88rem] font-semibold text-foreground">
              {props.lang === "zh" ? "繁體中文" : "English"}
            </span>
            <span class="shrink-0 text-faint-foreground">
              <SwapIcon size={13} />
            </span>
          </Show>
        </button>
      </div>
    </nav>
  );
}

interface ThemeOption {
  value: ThemeChoice;
  label: MessageKey;
  Icon: (p: IconProps) => JSX.Element;
}

/** Whatever the machine says, which is also what an unset preference means. */
const SYSTEM_THEME: ThemeOption = { value: "auto", label: "themeAuto", Icon: SystemIcon };

const THEMES: ThemeOption[] = [
  SYSTEM_THEME,
  { value: "light", label: "themeLight", Icon: SunIcon },
  { value: "dark", label: "themeDark", Icon: MoonIcon },
];

/**
 * Light or dark, without a trip to settings.
 *
 * Three icons in a track rather than one button that cycles: a rider who wants
 * dark should be able to press dark, not press twice and hope. Collapsed there
 * is no room for a track, so it becomes the one thing a single key can be - the
 * next choice along.
 */
function ThemeSwitch(props: { lang: Lang; open: boolean }) {
  const index = () =>
    Math.max(
      0,
      THEMES.findIndex((choice) => choice.value === settings.theme()),
    );
  const chosen = () => THEMES.find((choice) => choice.value === settings.theme()) ?? SYSTEM_THEME;
  const next = () => THEMES[(index() + 1) % THEMES.length] ?? SYSTEM_THEME;

  return (
    <Show
      when={props.open}
      fallback={
        <button
          type="button"
          title={t("theme", props.lang)}
          aria-label={`${t("theme", props.lang)} · ${t(chosen().label, props.lang)}`}
          onClick={(event) => swapTheme(next().value, pointerOrigin(event))}
          class="app-press flex h-10 items-center justify-center rounded-lg text-subtle-foreground transition-colors hover:bg-secondary hover:text-foreground"
        >
          {chosen().Icon({ size: 16 })}
        </button>
      }
    >
      {/* The app's own segmented control, wearing icons: three words would not
          fit a sidebar, and these three have pictures everyone already knows. */}
      <Segmented
        fill
        value={settings.theme()}
        options={THEMES.map((choice) => ({
          value: choice.value,
          label: t(choice.label, props.lang),
          Icon: choice.Icon,
        }))}
        onChange={(value, event) => swapTheme(value, pointerOrigin(event))}
        label={t("theme", props.lang)}
      />
    </Show>
  );
}

function Row(props: {
  tab: Destination;
  lang: Lang;
  isActive: (href: string) => boolean;
  open: boolean;
  /** Settings is a destination too, but it does not carry the travelling pill. */
  quiet?: boolean;
  /** The key that reaches this row, shown beside it when there is room. */
  shortcut?: string;
}) {
  const active = () => props.isActive(props.tab.href);

  return (
    <a
      {...useLinkProps({
        to: props.tab.href,
        ref: (
          (owner) => (el: HTMLAnchorElement) =>
            current(el, active, owner)
        )(getOwner()),
      })}
      data-pill-active={active() && !props.quiet ? "true" : "false"}
      title={props.open ? undefined : t(props.tab.label, props.lang)}
      class={[
        "app-press relative z-10 flex h-10 shrink-0 items-center gap-2.5 rounded-lg transition-colors duration-state",
        {
          "text-primary": active(),
          "text-subtle-foreground hover:bg-secondary hover:text-foreground": !active(),
          "bg-primary-muted": active() && Boolean(props.quiet),
          "justify-center px-0": !props.open,
          "px-2.5": props.open,
        },
      ]}
    >
      <span class="flex shrink-0 items-center justify-center">
        <props.tab.Icon size={19} />
      </span>
      <Show when={props.open}>
        <span
          class={[
            "min-w-0 grow truncate text-[0.88rem]",
            { "font-bold": active(), "font-semibold": !active() },
          ]}
        >
          {t(props.tab.label, props.lang)}
        </span>
        <Show when={props.shortcut}>
          <kbd class="shrink-0 rounded bg-secondary px-1.5 py-0.5 text-[0.69rem] font-bold text-faint-foreground">
            {props.shortcut}
          </kbd>
        </Show>
      </Show>
    </a>
  );
}

/**
 * The settings row: dressed as its neighbours are, but a button, because
 * settings is a drawer over the screen rather than a place the router goes.
 */
function SettingsRow(props: { lang: Lang; open: boolean; shortcut: string }) {
  const active = () => sheets.settingsOpen();

  return (
    <button
      type="button"
      onClick={() => sheets.openSettings()}
      title={props.open ? undefined : t("settings", props.lang)}
      class={[
        "app-press relative z-10 flex h-10 shrink-0 items-center gap-2.5 rounded-lg transition-colors duration-state",
        {
          "bg-primary-muted text-primary": active(),
          "text-subtle-foreground hover:bg-secondary hover:text-foreground": !active(),
          "justify-center px-0": !props.open,
          "px-2.5": props.open,
        },
      ]}
    >
      <span class="flex shrink-0 items-center justify-center">
        <SettingsIcon size={19} />
      </span>
      <Show when={props.open}>
        <span
          class={[
            "min-w-0 grow truncate text-left text-[0.88rem]",
            { "font-bold": active(), "font-semibold": !active() },
          ]}
        >
          {t("settings", props.lang)}
        </span>
        <kbd class="shrink-0 rounded bg-secondary px-1.5 py-0.5 text-[0.69rem] font-bold text-faint-foreground">
          {props.shortcut}
        </kbd>
      </Show>
    </button>
  );
}
