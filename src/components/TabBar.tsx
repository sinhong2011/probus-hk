import { useLocation } from "@solidjs/router";
import { For, Show, createEffect, onCleanup } from "solid-js";
import type { JSX } from "@solidjs/web";
import { t, type Lang, type MessageKey } from "~/lib/i18n";
import { trail } from "~/stores/trail";
import { settings, type ThemeChoice } from "~/stores/settings";
import { pointerOrigin, swapTheme } from "~/lib/themeSwap";
import { AppMark } from "./AppMark";
import { Segmented } from "./Chrome";
import { SlidingPill } from "./SlidingPill";
import {
  BookmarkIcon,
  MegaphoneIcon,
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
 * The key that opens search, named the way the machine in front of the rider
 * names it. Read once: it cannot change while the page is open.
 */
const SHORTCUT =
  typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.userAgent) ? "⌘K" : "Ctrl K";

interface Destination {
  href: string;
  label: MessageKey;
  Icon: (p: IconProps) => JSX.Element;
}

/** Where the app can take you. Settings is not one of these; it is the drawer. */
const TABS: Destination[] = [
  { href: "/", label: "nearby", Icon: PinIcon },
  { href: "/saved", label: "saved", Icon: BookmarkIcon },
  { href: "/search", label: "search", Icon: SearchIcon },
  { href: "/rail", label: "rail", Icon: TrainIcon },
  { href: "/notices", label: "notices", Icon: MegaphoneIcon },
];

/** The sidebar lists these; search is the box above them, not a row in them. */
const SIDEBAR_TABS = TABS.filter((tab) => tab.href !== "/search");

const SETTINGS: Destination = { href: "/settings", label: "settings", Icon: SettingsIcon };

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
  const isActive = (href: string) => trail.owns(href, location.pathname);

  return (
    <>
      <PhoneBar lang={props.lang} isActive={isActive} />
      <Sidebar lang={props.lang} isActive={isActive} />
    </>
  );
}

/** Sets `aria-current` from an effect: bound in the markup it never updated. */
function current(el: HTMLAnchorElement, active: () => boolean) {
  createEffect(active, (on) => el.setAttribute("aria-current", on ? "page" : "false"));
}

function PhoneBar(props: { lang: Lang; isActive: (href: string) => boolean }) {
  const items = () => [...TABS, SETTINGS];

  return (
    <nav
      aria-label={t("navigation", props.lang)}
      class="mb-safe-bottom fixed inset-x-0 bottom-0 z-30 border-t border-border px-1 pt-2.5 lg:hidden"
      style={{
        background: "color-mix(in srgb, var(--background) 94%, transparent)",
        "backdrop-filter": "blur(18px)",
        // Safari still needs the prefix, and this bar sits over live content on
        // every screen - unprefixed it is simply a flat panel on an iPhone.
        "-webkit-backdrop-filter": "blur(18px)",
      }}
    >
      <div class="mx-auto flex w-full max-w-[46rem] items-start gap-0.5">
        <For each={items()}>
          {(tab) => (
            <a
              href={tab.href}
              ref={(el: HTMLAnchorElement) => current(el, () => props.isActive(tab.href))}
              class={[
                "mb-press relative flex h-12 min-w-0 flex-1 flex-col items-center justify-start gap-[5px] transition-colors duration-state",
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
   * thinking. The link is clicked rather than the router called directly, so
   * the keystroke and the box take exactly the same path.
   */
  createEffect(
    () => null,
    () => {
      const onKey = (event: KeyboardEvent) => {
        if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "k") return;
        event.preventDefault();
        searchLink.click();
      };
      document.addEventListener("keydown", onKey);
      onCleanup(() => document.removeEventListener("keydown", onKey));
    },
  );

  return (
    <nav
      aria-label={t("navigation", props.lang)}
      class="fixed inset-y-3 left-3 z-30 hidden flex-col rounded-2xl border border-border bg-card p-3 shadow-card transition-[width] duration-state ease-[var(--ease-spring)] lg:flex"
      style={{ width: open() ? "15rem" : "4.5rem" }}
    >
      <div class={["flex items-center gap-2.5", { "flex-col gap-2": !open() }]}>
        <a
          href="/"
          aria-label="MotherBus"
          class="mb-press flex shrink-0 items-center gap-2.5 rounded-xl px-0.5 py-1"
        >
          <AppMark size={26} />
          <Show when={open()}>
            <span class="whitespace-nowrap text-[1rem] font-bold tracking-[-0.02em] text-foreground">
              MotherBus
            </span>
          </Show>
        </a>

        <button
          type="button"
          onClick={() => settings.setRailOpen(!open())}
          aria-label={t(open() ? "collapseNav" : "expandNav", props.lang)}
          class={[
            "mb-press flex size-8 shrink-0 items-center justify-center rounded-lg text-subtle-foreground transition-colors hover:bg-secondary hover:text-foreground",
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
        ref={(el: HTMLAnchorElement) => {
          searchLink = el;
          current(el, searching);
        }}
        href="/search"
        class={[
          "mb-press mt-3 flex h-9 shrink-0 items-center gap-2 rounded-lg border border-border transition-colors",
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
          <kbd class="shrink-0 rounded border border-border bg-card px-1.5 py-0.5 text-[0.75rem] font-bold text-faint-foreground">
            {SHORTCUT}
          </kbd>
        </Show>
      </a>

      <div class="mb-scroll relative mt-4 flex min-h-0 grow flex-col gap-1 overflow-y-auto">
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
            {(tab) => <Row tab={tab} lang={props.lang} isActive={props.isActive} open={open()} />}
          </For>
        </div>
      </div>

      <div class="flex shrink-0 flex-col gap-1 pt-3">
        <Row tab={SETTINGS} lang={props.lang} isActive={props.isActive} open={open()} quiet />

        <div class="my-1 h-px bg-border" />

        <ThemeSwitch lang={props.lang} open={open()} />

        {/* A bilingual city reads a bus list in whichever language is in front
            of it, so the switch sits where an app usually keeps the account it
            is signed into - the last row, always in the same place. */}
        <button
          type="button"
          onClick={() => settings.setLang(props.lang === "zh" ? "en" : "zh")}
          class={[
            "mb-press flex h-10 items-center gap-2.5 rounded-lg text-subtle-foreground transition-colors hover:bg-secondary hover:text-foreground",
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
          class="mb-press flex h-10 items-center justify-center rounded-lg text-subtle-foreground transition-colors hover:bg-secondary hover:text-foreground"
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
}) {
  const active = () => props.isActive(props.tab.href);

  return (
    <a
      href={props.tab.href}
      ref={(el: HTMLAnchorElement) => current(el, active)}
      data-active={active() && !props.quiet ? "true" : "false"}
      title={props.open ? undefined : t(props.tab.label, props.lang)}
      class={[
        "mb-press relative z-10 flex h-10 shrink-0 items-center gap-2.5 rounded-lg transition-colors duration-state",
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
          class={["truncate text-[0.88rem]", { "font-bold": active(), "font-semibold": !active() }]}
        >
          {t(props.tab.label, props.lang)}
        </span>
      </Show>
    </a>
  );
}
