import { Show } from "solid-js";
import type { JSX } from "@solidjs/web";
import { CloseIcon } from "./Icons";
import { t, type Lang } from "~/lib/i18n";
import { dismissed } from "~/stores/dismissed";

/**
 * A line of guidance in a box of its own, that can be closed for good.
 *
 * The shape is Kobalte's Alert - a region announced by its role - in this
 * app's tokens, with the one thing a static note lacks: a way to be rid of
 * it. A note is for the first reading. Given an `id`, closing it is remembered
 * (see the `dismissed` store) and it never comes back, on this device or in
 * the next tab. Without one it is simply a box that says something.
 */
export function Alert(props: {
  children: JSX.Element;
  lang: Lang;
  /** Names the note for the record of closed ones. Omit for one that stays. */
  id?: string;
  tone?: "info" | "warn";
  /** Replaces the information mark. */
  icon?: JSX.Element;
  class?: string;
}) {
  const warn = () => props.tone === "warn";
  const open = () => (props.id ? !dismissed.has(props.id) : true);

  return (
    <Show when={open()}>
      <div
        /* A warning is announced; a hint is not, it merely sits there to be
           read - the difference between Kobalte's alert and a status region. */
        role={warn() ? "alert" : "status"}
        class={[
          "flex items-center gap-2 rounded-lg py-1.5 pl-2.5 pr-1 text-[0.75rem] font-medium leading-snug motion-safe:mb-rise",
          /* A hint sits on the page's own grey, a step quieter than a card and
             with no frame, so it reads as a note in the margin. A warning gets
             its own colour, because a warning has to be seen. */
          warn() ? "bg-warning/12 text-warning" : "bg-secondary text-muted-foreground",
          props.class ?? "",
        ]}
      >
        <span class={["shrink-0", warn() ? "" : "text-primary"]} aria-hidden="true">
          <Show when={props.icon} fallback={<InfoMark />}>
            {props.icon}
          </Show>
        </span>
        <div class="min-w-0 grow">{props.children}</div>
        <Show when={props.id}>
          {(id) => (
            <button
              type="button"
              onClick={() => dismissed.dismiss(id())}
              aria-label={t("close", props.lang)}
              /* Taller than the line it sits on, so the target is a finger's
                 and not the glyph's. */
              class="mb-press -my-2 flex size-7 shrink-0 items-center justify-center rounded-full text-faint-foreground transition-colors duration-state active:text-foreground"
            >
              <CloseIcon size={11} />
            </button>
          )}
        </Show>
      </div>
    </Show>
  );
}

/** A circled i. The icon set's "information" is a bare glyph, which at this
    size is a dot; a ring is what makes it read as a mark. */
function InfoMark() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      stroke-width="1.6"
      stroke-linecap="round"
      aria-hidden="true"
    >
      <circle cx="8" cy="8" r="6.4" />
      <path d="M8 7.4v3.6M8 5.1v.05" />
    </svg>
  );
}
