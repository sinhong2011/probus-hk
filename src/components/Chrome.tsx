import { For, Show } from "solid-js";
import type { JSX } from "@solidjs/web";
import type { IconProps } from "./Icons";
import { SlidingPill } from "./SlidingPill";
import type { Bilingual } from "~/data/types";
import { pick, stopCode, t, type Lang } from "~/lib/i18n";

/**
 * The pole code printed on the stop itself - "WT916".
 *
 * Stop lists used to carry the name twice, once in each language, which cost a
 * line per row to say something the rider already knew. What the second line
 * was actually good for is telling two poles of the same name apart, and the
 * code does that in five characters: it is the one on the flag you are looking
 * for, and it is what a rider types when they know exactly which stop they
 * mean.
 */
export function StopCode(props: { name: Bilingual | undefined; lang: Lang; class?: string }) {
  // The code is appended to both languages, but only one of them is certain to
  // be present for every operator's data.
  const code = () => stopCode(pick(props.name, props.lang)) ?? stopCode(pick(props.name, "en"));

  return (
    <Show when={code()}>
      {(value) => (
        <span
          class={[
            // Set well under the name it follows: the code is what a rider
            // checks once they are already at the right row, so it only has
            // to be legible, not weigh the same as the name.
            "tnum shrink-0 rounded bg-secondary px-1 py-px text-[0.55rem] font-bold tracking-[0.06em] text-faint-foreground",
            props.class ?? "",
          ]}
        >
          {value()}
        </span>
      )}
    </Show>
  );
}

/** Small-caps section heading used down the whole app. */
export function SectionLabel(props: {
  children: JSX.Element;
  /** Beside the title on the left - a count, a chip. */
  aside?: JSX.Element;
  trailing?: JSX.Element;
}) {
  return (
    <div class="flex items-center justify-between gap-2">
      <span class="flex min-w-0 items-center gap-2">
        <span class="shrink-0 text-[0.75rem] font-bold uppercase tracking-[0.16em] text-subtle-foreground">
          {props.children}
        </span>
        <Show when={props.aside}>{props.aside}</Show>
      </span>
      <Show when={props.trailing}>{props.trailing}</Show>
    </div>
  );
}

/**
 * Rounded surface that groups rows, with hairlines drawn between them.
 *
 * `raised` lifts it one step above the surface it sits on - for a card
 * inside a sheet, where `bg-card` would vanish into the ground. The step is
 * the secondary tone, except inside a drawer, whose lighter ground re-points
 * `--raised` a full step further up - see `.bg-drawer` in app.css.
 */
export function Card(props: { children: JSX.Element; class?: string; raised?: boolean }) {
  return (
    <div
      class={[
        /* The hairline, not the shadow, is what draws the card's edge: in the
           dark `--shadow-card` is `none`, and a card one step off the page
           tone needs an edge of its own to read as lifted. */
        "overflow-hidden rounded-xl border border-border shadow-card",
        props.raised ? "bg-raised" : "bg-card",
        props.class ?? "",
      ]}
    >
      {props.children}
    </div>
  );
}

/**
 * Something arriving or leaving, animated both ways.
 *
 * `Show` cannot animate an exit - the node is gone before a transition can
 * run - so the content stays mounted and the wrapper collapses its own grid
 * row instead. Nothing inside should be doing work while closed.
 */
export function Reveal(props: { open: boolean; children: JSX.Element; class?: string }) {
  return (
    <div
      class={`app-reveal ${props.class ?? ""}`}
      data-open={props.open ? "true" : "false"}
      /* Closed content stays in the DOM so the exit can play, which would
         otherwise leave its buttons and links tabbable and readable by a
         screen reader. `inert` takes the whole subtree out of reach. */
      inert={!props.open}
    >
      <div>{props.children}</div>
    </div>
  );
}

/** Inset divider matching the card's left padding. */
/**
 * One fare, on the line that names it.
 *
 * A number, not a chip: an amount already looks like an amount - it wears a
 * dollar sign and it is the only figure on the line - and boxing it made a
 * pair of them the loudest thing on a row whose answer is the countdown at
 * the other end. What is left is the difference that matters: lining figures,
 * a heavier weight, and the ink a step up from the words that name them.
 */
export function FareTag(props: { children: JSX.Element }) {
  return <span class="tnum shrink-0 font-bold text-muted-foreground">{props.children}</span>;
}

/**
 * Marks a special-pattern entry apart from the main service it shadows.
 *
 * The route database keys every service pattern separately, and a variant
 * that starts and ends where the main one does reads as its exact double -
 * same number, same ends, same fare. This is the one word that tells them
 * apart, worn by every pattern that is not the main one, as the reference
 * app wears it.
 */
export function SpecialTag(props: { lang: Lang }) {
  return (
    <span class="shrink-0 self-center rounded bg-warning/12 px-1 py-px text-[0.66rem] font-bold leading-[1.5] text-warning">
      {t("specialDepartures", props.lang)}
    </span>
  );
}

export function Hairline() {
  return <div class="ml-3.5 h-px bg-border" />;
}

export function Chip(props: {
  children: JSX.Element;
  /** `card` is `plain` for a chip on a raised (`bg-secondary`) surface,
      where the plain tone would vanish into its own background. */
  tone?: "plain" | "accent" | "warn" | "card";
  /** For the flex behaviour of the row it sits in, e.g. `shrink-0`. */
  class?: string;
  /** When the chip is only a numeral or icon, say what it counts. */
  label?: string;
}) {
  return (
    <span
      aria-label={props.label}
      /* `whitespace-nowrap`, because the chip is a fixed height: a value that
         wraps does not make the chip taller, it spills out of it. "52 m" broke
         across two lines the moment a long stop name claimed the row. */
      class={[
        "inline-flex h-[1.6rem] w-fit items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 text-[0.75rem] font-bold",
        props.class ?? "",
        {
          "border-border bg-secondary text-muted-foreground": (props.tone ?? "plain") === "plain",
          "border-border bg-card text-muted-foreground": props.tone === "card",
          /* A toned chip takes its edge from its own colour, not the neutral
             hairline: a grey ring around a primary or amber ground reads as a
             second, unrelated shape drawn over it. */
          "border-primary-border bg-primary-muted text-primary": props.tone === "accent",
          // The last bus of the night is the one piece of timetable that is
          // urgent, and it shares its colour with an arrival that is imminent.
          "border-warning/25 bg-warning/12 text-warning": props.tone === "warn",
        },
      ]}
    >
      {props.children}
    </span>
  );
}

/** The live-data pill with its pulsing dot. */
export function LivePill(props: { label: string }) {
  return (
    <span class="inline-flex items-center gap-[7px] rounded-full bg-primary-muted py-[5px] pl-[9px] pr-[11px]">
      <span
        class="size-1.5 rounded-full bg-primary motion-safe:animate-[app-pulse_2s_ease-in-out_infinite]"
        style={{
          "box-shadow": "0 0 0 3px color-mix(in srgb, var(--primary) 15%, transparent)",
        }}
      />
      <span class="text-[0.81rem] font-semibold text-primary">{props.label}</span>
    </span>
  );
}

/**
 * The screen's own header: context on one side, the screen's controls on the
 * other, held to the top of a wide window while the list scrolls under it.
 *
 * One line at every width. The title is spoken but not drawn, so stacking the
 * context over the controls on a phone spent a whole row saying nothing - an
 * empty half above a lonely chip - and the two halves of one band read as two
 * unrelated ones. The context takes the room that is left and truncates; the
 * controls keep their size.
 *
 * The controls belong here rather than on a row of their own below: a desktop
 * window is short and wide, and a second band of chips pushed the first card
 * of every screen further down a window that already had height to spare.
 */
export function ScreenTitle(props: {
  title: string;
  /**
   * A second line under the title, where it says something the title does not.
   * Never the same words in the other language: the app is read in one language
   * at a time, and printing both is a translation exercise, not a heading.
   */
  subtitle?: string;
  /**
   * Context for the screen - where you are, what the list is cut to - at the
   * head of the band. It gets the room the controls do not use, so anything
   * that can outgrow it should truncate or scroll on its own.
   */
  trailing?: JSX.Element;
  /**
   * A row above the title, in practice the breadcrumb. It belongs inside the
   * bar rather than above it: a pinned bar is pulled up over the page's top
   * padding, and anything left sitting there is what it covers.
   */
  lead?: JSX.Element;
  /** The screen's controls, at the far end of the band and never squeezed. */
  controls?: JSX.Element;
  /**
   * Held to the top of a wide window while the page scrolls. Off inside a
   * split screen, whose panes scroll on their own and whose left column is
   * short enough that a pinned header would only crowd it.
   */
  pinned?: boolean;
}) {
  const pinned = () => props.pinned !== false;

  return (
    <div
      class={[
        "flex flex-col gap-3",
        {
          "lg:sticky lg:top-0 lg:z-20 lg:-mx-8 lg:-mt-8 lg:border-b lg:border-border lg:px-8 lg:pb-4 lg:pt-8":
            pinned(),
        },
      ]}
      style={
        pinned()
          ? {
              background: "color-mix(in srgb, var(--background) 88%, transparent)",
              "backdrop-filter": "blur(14px)",
              "-webkit-backdrop-filter": "blur(14px)",
            }
          : undefined
      }
    >
      {props.lead}

      <div class="flex items-center justify-between gap-3 lg:gap-6">
        <div class="flex min-w-0 flex-1 items-center gap-2.5 lg:items-baseline">
          {/* The name stays for screen readers; visually the tab bar and
              the sidebar already say where you are, and the heading
              repeating them was the tallest thing on every screen. */}
          <h1 class="sr-only">{props.title}</h1>
          <Show when={props.subtitle}>
            <span class="truncate text-[0.88rem] font-semibold tracking-[0.02em] text-subtle-foreground lg:text-[0.81rem] lg:uppercase lg:tracking-[0.14em]">
              {props.subtitle}
            </span>
          </Show>
          <Show when={props.trailing}>
            <div class="flex min-w-0 flex-1">{props.trailing}</div>
          </Show>
        </div>

        <Show when={props.controls}>
          <div class="flex shrink-0 items-center gap-2 lg:justify-end">{props.controls}</div>
        </Show>
      </div>
    </div>
  );
}

/**
 * Segmented control. Kept local rather than pulled from a component library
 * because it is a plain single-choice control and this keeps the alpha
 * dependency off a high-traffic path.
 *
 * The chosen segment is a raised card on a sunken track, not a slightly
 * different grey on a slightly different grey: on a white card in light mode
 * the old pairing left the choice all but invisible. The track carries the one
 * travelling pill the rest of the app uses, which needs the segments to be
 * equal width - and a row of equal segments reads better anyway.
 */
export function Segmented<T extends string | number>(props: {
  value: T;
  options: { value: T; label: string; Icon?: (p: IconProps) => JSX.Element }[];
  onChange: (value: T, event: MouseEvent) => void;
  label: string;
  /** Fully round, for a switch that rides in a header rather than a settings row. */
  pill?: boolean;
  /** Shorter and smaller, where the control is an aside to a heading. */
  dense?: boolean;
  /**
   * Spread the choices across the width instead of sizing to their labels, for
   * a control that is a block of its own rather than something in a row.
   */
  fill?: boolean;
}) {
  /*
   * -1 parks the pill rather than sending it to the first choice: a value
   * persisted by an older build may no longer be one of the options, and a
   * control that quietly claims a choice nobody made is worse than one that
   * shows none.
   */
  const activeIndex = () => props.options.findIndex((option) => option.value === props.value);

  return (
    <div
      role="radiogroup"
      aria-label={props.label}
      class={[
        "relative flex items-center bg-secondary p-[3px]",
        props.pill ? "rounded-full" : "rounded-lg",
        { "w-full": Boolean(props.fill) },
      ]}
    >
      {/* The pill the choices ride on, which is what this control has always
          been built for - the buttons below mark themselves `data-pill-active`
          and stand at `z-10` so it can pass under them. The same component
          slides down the navigation rail and across the search/plan switch. */}
      <Show when={activeIndex() >= 0}>
        <SlidingPill
          active={activeIndex()}
          class={`inset-y-[3px] bg-card shadow-card ${props.pill ? "rounded-full" : "rounded-md"}`}
        />
      </Show>

      <For each={props.options}>
        {(option) => {
          const on = () => props.value === option.value;
          return (
            <button
              type="button"
              role="radio"
              data-pill-active={on() ? "true" : "false"}
              aria-checked={on() ? "true" : "false"}
              aria-label={option.Icon ? option.label : undefined}
              title={option.Icon ? option.label : undefined}
              onClick={(event) => props.onChange(option.value, event)}
              class={[
                // `whitespace-nowrap`: a two-character label broken across two
                // lines is not a shorter label, it is a broken one.
                // Weight stays put: bolding the chosen label grew its box,
                // and a heading that wrapped around a wider control was the
                // whole list jumping.
                "app-press relative z-10 flex items-center justify-center whitespace-nowrap px-2.5 font-bold leading-none transition-colors duration-state",
                props.fill ? "grow basis-0" : "shrink-0",
                props.dense ? "h-6 text-[0.75rem]" : "h-7 text-[0.81rem]",
                props.pill ? "rounded-full" : "rounded-md",
                {
                  "text-foreground": on(),
                  "text-subtle-foreground": !on(),
                },
              ]}
            >
              <Show when={option.Icon} fallback={option.label}>
                {(Icon) => Icon()({ size: 14 })}
              </Show>
            </button>
          );
        }}
      </For>
    </div>
  );
}

export function Toggle(props: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={props.checked ? "true" : "false"}
      aria-label={props.label}
      onClick={() => props.onChange(!props.checked)}
      class={[
        "flex h-[1.7rem] w-[2.9rem] items-center rounded-full p-[2.5px] transition-colors duration-200",
        /* The off track is a well cut into whatever the toggle sits on - a
           raised card in settings - so it cannot share that card's surface. */
        { "bg-primary": props.checked, "bg-card": !props.checked },
      ]}
    >
      <span
        class={[
          "size-[1.35rem] rounded-full transition-transform duration-200 ease-[cubic-bezier(0.34,1.4,0.64,1)]",
          {
            "translate-x-[1.2rem] bg-primary-foreground": props.checked,
            "bg-background": !props.checked,
          },
        ]}
      />
    </button>
  );
}

/** Empty and error states share this centred, quiet treatment. */
export function EmptyState(props: { title: string; hint?: string; action?: JSX.Element }) {
  return (
    <div class="flex flex-col items-center gap-2.5 px-10 py-16 text-center lg:py-24">
      <span class="text-[0.94rem] font-bold text-muted-foreground">{props.title}</span>
      <Show when={props.hint}>
        <span class="text-[0.81rem] font-medium leading-relaxed text-subtle-foreground">
          {props.hint}
        </span>
      </Show>
      <Show when={props.action}>
        <div class="pt-2">{props.action}</div>
      </Show>
    </div>
  );
}
