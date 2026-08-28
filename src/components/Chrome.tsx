import { For, Show } from "solid-js";
import type { JSX } from "@solidjs/web";

/** Small-caps section heading used down the whole app. */
export function SectionLabel(props: { children: JSX.Element; trailing?: JSX.Element }) {
  return (
    <div class="flex items-baseline justify-between">
      <span class="text-[0.63rem] font-bold uppercase tracking-[0.16em] text-subtle-foreground">
        {props.children}
      </span>
      <Show when={props.trailing}>{props.trailing}</Show>
    </div>
  );
}

/** Rounded surface that groups rows, with hairlines drawn between them. */
export function Card(props: { children: JSX.Element; class?: string }) {
  return (
    <div
      class={`overflow-hidden rounded-xl border border-border bg-card shadow-card ${props.class ?? ""}`}
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
      class={`mb-reveal ${props.class ?? ""}`}
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
export function Hairline() {
  return <div class="ml-3.5 h-px bg-border" />;
}

export function Chip(props: { children: JSX.Element; tone?: "plain" | "accent" }) {
  return (
    <span
      class={["inline-flex h-[1.6rem] w-fit items-center gap-1.5 rounded-full px-2.5 text-[0.63rem] font-bold", {
        "bg-secondary text-muted-foreground": (props.tone ?? "plain") === "plain",
        "bg-primary-muted text-primary border border-primary-border": props.tone === "accent",
      }]}
    >
      {props.children}
    </span>
  );
}

/** The live-data pill with its pulsing dot. */
export function LivePill(props: { label: string }) {
  return (
    <span class="inline-flex items-center gap-[7px] rounded-full border border-primary-border bg-primary-muted py-[5px] pl-[9px] pr-[11px]">
      <span
        class="size-1.5 rounded-full bg-primary motion-safe:animate-[mb-pulse_2s_ease-in-out_infinite]"
        style={{ "box-shadow": "0 0 0 3px color-mix(in srgb, var(--primary) 15%, transparent)" }}
      />
      <span class="text-[0.66rem] font-semibold text-primary">{props.label}</span>
    </span>
  );
}

/** Screen title block: large Chinese over a small roman subtitle. */
export function ScreenTitle(props: { title: string; subtitle: string; trailing?: JSX.Element }) {
  return (
    <div class="flex items-end justify-between">
      <div class="flex flex-col gap-[3px]">
        <span class="text-[1.7rem] font-bold leading-[1.05] tracking-[-0.035em] text-foreground">
          {props.title}
        </span>
        <span class="text-[0.75rem] font-semibold tracking-[0.02em] text-subtle-foreground">
          {props.subtitle}
        </span>
      </div>
      <Show when={props.trailing}>{props.trailing}</Show>
    </div>
  );
}

/**
 * Segmented control. Kept local rather than pulled from a component library
 * because it is a plain single-choice control and this keeps the alpha
 * dependency off a high-traffic path.
 */
export function Segmented<T extends string | number>(props: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={props.label} class="flex items-center gap-0.5 rounded-lg bg-background p-[3px]">
      <For each={props.options}>
        {(option) => (
          <button
            type="button"
            role="radio"
            aria-checked={props.value === option.value ? "true" : "false"}
            onClick={() => props.onChange(option.value)}
            class={["flex h-7 items-center justify-center rounded-lg px-2.5 text-[0.72rem] transition-colors duration-150", {
              "bg-secondary font-bold text-foreground": props.value === option.value,
              "font-semibold text-subtle-foreground": props.value !== option.value,
            }]}
          >
            {option.label}
          </button>
        )}
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
      class={["flex h-[1.7rem] w-[2.9rem] items-center rounded-full p-[2.5px] transition-colors duration-200", { "bg-primary": props.checked, "bg-secondary": !props.checked }]}
    >
      <span
        class={["size-[1.35rem] rounded-full transition-transform duration-200 ease-[cubic-bezier(0.34,1.4,0.64,1)]", {
          "translate-x-[1.2rem] bg-primary-foreground": props.checked,
          "bg-background": !props.checked,
        }]}
      />
    </button>
  );
}

/** Empty and error states share this centred, quiet treatment. */
export function EmptyState(props: { title: string; hint?: string; action?: JSX.Element }) {
  return (
    <div class="flex flex-col items-center gap-2.5 px-10 py-16 text-center">
      <span class="text-[0.85rem] font-bold text-muted-foreground">{props.title}</span>
      <Show when={props.hint}>
        <span class="text-[0.72rem] font-medium leading-relaxed text-subtle-foreground">{props.hint}</span>
      </Show>
      <Show when={props.action}>
        <div class="pt-2">{props.action}</div>
      </Show>
    </div>
  );
}
