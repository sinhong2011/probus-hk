import { useLocation } from "@solidjs/router";
import { For, createEffect } from "solid-js";
import type { JSX } from "@solidjs/web";
import { t, type Lang, type MessageKey } from "~/lib/i18n";
import { trail } from "~/stores/trail";
import { AppMark } from "./AppMark";
import {
  BookmarkIcon,
  MegaphoneIcon,
  PinIcon,
  SearchIcon,
  TrainIcon,
  SettingsIcon,
  type IconProps,
} from "./Icons";

const TABS: { href: string; label: MessageKey; Icon: (p: IconProps) => JSX.Element }[] = [
  { href: "/", label: "nearby", Icon: PinIcon },
  { href: "/saved", label: "saved", Icon: BookmarkIcon },
  { href: "/search", label: "search", Icon: SearchIcon },
  { href: "/rail", label: "rail", Icon: TrainIcon },
  { href: "/notices", label: "notices", Icon: MegaphoneIcon },
  { href: "/settings", label: "settings", Icon: SettingsIcon },
];

/**
 * A bottom bar on a phone; a side rail on a wide screen.
 *
 * Six destinations pinned to the bottom of a 1400px window leave a thin strip
 * of controls marooned under a very empty page. A vertical rail puts them where
 * a pointer expects them and gives the labels room to breathe.
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
  const activeIndex = () => Math.max(0, TABS.findIndex((tab) => isActive(tab.href)));

  return (
    <nav
      aria-label={t("navigation", props.lang)}
      class="mb-safe-bottom fixed inset-x-0 bottom-0 z-30 border-t border-border px-1 pt-2.5
             lg:inset-y-0 lg:right-auto lg:w-22 lg:border-r lg:border-t-0 lg:px-2 lg:pb-6 lg:pt-8"
      style={{
        background: "color-mix(in srgb, var(--background) 94%, transparent)",
        "backdrop-filter": "blur(18px)",
        // Safari still needs the prefix, and this bar sits over live content on
        // every screen - unprefixed it is simply a flat panel on an iPhone.
        "-webkit-backdrop-filter": "blur(18px)",
      }}
    >
      {/* The rail is the only chrome a desktop window shows, so it is where the
          app says its own name. The phone bar has the whole screen for that. */}
      <a href="/" aria-label="MotherBus" class="mb-press mb-6 hidden justify-center lg:flex">
        <AppMark size={34} />
      </a>

      <div class="relative mx-auto flex w-full max-w-[46rem] items-start gap-0.5 lg:mx-0 lg:max-w-none lg:flex-col lg:items-stretch lg:gap-0">
        {/*
         * One pill that travels down the rail, the same idea as the search and
         * plan switch. It needs every item to be the same height, which is why
         * the rail fixes theirs.
         */}
        <div
          class="pointer-events-none absolute inset-x-0 top-0 hidden lg:block"
          style={{ height: `${100 / TABS.length}%` }}
          aria-hidden="true"
        >
          <div
            class="mx-1 h-full rounded-2xl bg-primary-muted transition-transform duration-state ease-[var(--ease-spring)]"
            style={{ transform: `translateY(${activeIndex() * 100}%)` }}
          />
        </div>

        <For each={TABS}>
          {(tab) => (
            <a
              href={tab.href}
              /*
               * Set from an effect rather than bound in the markup: the bound
               * form paints the colour correctly but leaves the attribute at
               * whatever it was on first render, so the lit tab announced
               * nothing to a screen reader after a navigation.
               */
              ref={(el: HTMLAnchorElement) => {
                createEffect(
                  () => isActive(tab.href),
                  (active) => el.setAttribute("aria-current", active ? "page" : "false"),
                );
              }}
              class={[
                "mb-press relative z-10 flex h-12 min-w-0 flex-1 flex-col items-center justify-start gap-[5px] transition-colors duration-state",
                "lg:h-[4.5rem] lg:flex-none lg:justify-center lg:gap-1.5 lg:rounded-2xl",
                { "text-primary": isActive(tab.href), "text-subtle-foreground": !isActive(tab.href) },
              ]}
            >
              <span
                class={[
                  "flex items-center justify-center rounded-xl transition-transform duration-state ease-[var(--ease-spring)]",
                  { "scale-110": isActive(tab.href) },
                ]}
              >
                <tab.Icon size={19} />
              </span>
              <span
                class={[
                  "truncate text-[0.55rem] lg:text-[0.62rem]",
                  { "font-bold": isActive(tab.href), "font-semibold": !isActive(tab.href) },
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
