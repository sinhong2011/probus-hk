import { Show, createSignal } from "solid-js";
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

  /*
   * Closing is a departure, not a disappearance: the note folds up and fades,
   * and only once that has played is it taken out of the page - so the gap it
   * held closes with it rather than being left behind. A note already closed
   * on an earlier visit is never mounted at all.
   */
  const [closing, setClosing] = createSignal(false);
  const [gone, setGone] = createSignal(props.id ? dismissed.has(props.id) : false);
  const close = (id: string) => {
    setClosing(true);
    dismissed.dismiss(id);
    window.setTimeout(() => setGone(true), 300);
  };

  return (
    <Show when={!gone()}>
      {/* Folds and fades on its way out. The same trick as `Reveal`, done here
          rather than with it, because `Reveal` marks itself `data-open` and
          the page counts those to know which stop rows are open. */}
      <div
        class={[
          "grid transition-[grid-template-rows,opacity] duration-reveal ease-[var(--ease-out)]",
          closing() ? "grid-rows-[0fr] opacity-0" : "grid-rows-[1fr] opacity-100",
          props.class ?? "",
        ]}
        inert={closing()}
      >
        <div class="min-h-0 overflow-hidden">
          <div
            /* A warning is announced; a hint is not, it merely sits there to be
           read - the difference between Kobalte's alert and a status region. */
            role={warn() ? "alert" : "status"}
            class={[
              "flex items-center gap-2 rounded-lg py-1.5 pl-2.5 pr-1 text-[0.75rem] font-medium leading-snug motion-safe:app-rise",
              /* A hint sits on the page's own grey, a step quieter than a card and
             with no frame, so it reads as a note in the margin. A warning gets
             its own colour, because a warning has to be seen. */
              warn() ? "bg-warning/12 text-warning" : "bg-secondary text-muted-foreground",
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
                  onClick={() => close(id())}
                  aria-label={t("close", props.lang)}
                  /* A small disc on the note's own ground, so it reads as a
                 control and not a stray glyph; the hit area is the row's full
                 height, a finger's rather than the disc's. */
                  class={[
                    "app-press -my-1.5 flex size-6 shrink-0 items-center justify-center rounded-full transition-colors duration-state",
                    warn()
                      ? "bg-warning/15 text-warning hover:bg-warning/25"
                      : "bg-card text-faint-foreground shadow-card hover:text-foreground active:bg-background",
                  ]}
                >
                  <CloseIcon size={10} />
                </button>
              )}
            </Show>
          </div>
        </div>
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
