import { useLocation } from "@solidjs/router";
import { For } from "solid-js";
import { SlidingPill } from "./SlidingPill";
import { t, type Lang, type MessageKey } from "~/lib/i18n";

const MODES: { href: string; label: MessageKey }[] = [
  { href: "/search", label: "search" },
  { href: "/plan", label: "plan" },
];

/**
 * Searching and planning are one place, not two.
 *
 * Both answer "how do I get somewhere", and both start by typing a
 * destination - keeping them in separate tabs made a rider decide which kind of
 * question they were asking before they were allowed to ask it. They share a
 * tab now, and this picks which half of it you are looking at.
 *
 * Each half keeps its own URL, so a link to a plan is still a link to a plan.
 */
export function ModeSwitch(props: { lang: Lang }) {
  const location = useLocation();

  const activeIndex = () =>
    Math.max(
      0,
      MODES.findIndex((m) => m.href === location.pathname),
    );

  return (
    <div
      role="tablist"
      aria-label={t("search", props.lang)}
      class="relative flex items-center rounded-full bg-secondary p-[3px]"
    >
      {/* One pill that travels, rather than two that blink on and off. The
          navigation rail slides the same component down its own side. */}
      <SlidingPill active={activeIndex()} class="inset-y-[3px] rounded-full bg-card shadow-card" />

      <For each={MODES}>
        {(mode) => {
          const current = () => location.pathname === mode.href;
          return (
            <a
              href={mode.href}
              role="tab"
              aria-selected={current() ? "true" : "false"}
              data-pill-active={current() ? "true" : "false"}
              class={[
                "mb-press relative z-10 flex h-8 grow items-center justify-center rounded-full text-[0.88rem] transition-colors duration-state",
                {
                  "font-bold text-foreground": current(),
                  "font-semibold text-subtle-foreground": !current(),
                },
              ]}
            >
              {t(mode.label, props.lang)}
            </a>
          );
        }}
      </For>
    </div>
  );
}
