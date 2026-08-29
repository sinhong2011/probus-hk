import { createEffect, onCleanup } from "solid-js";
import type { JSX } from "@solidjs/web";
import { CloseIcon } from "./Icons";
import { t, type Lang } from "~/lib/i18n";

/**
 * A dialog: a bottom sheet on a phone, a centred card on a wide screen.
 *
 * Reference material - a timetable, a full stop list - does not belong inline.
 * Opening it there pushed the page it was attached to out from under the
 * reader, and inside a sticky column it had nowhere to go at all.
 *
 * It stays mounted so the close can animate, which means the closed dialog has
 * to be genuinely out of reach: `inert` for focus and pointers, and a delayed
 * `visibility` flip so it stops taking hits the moment the fade ends.
 */
export function Modal(props: {
  open: boolean;
  onClose: () => void;
  title: string;
  lang: Lang;
  children: JSX.Element;
}) {
  let sheet!: HTMLDivElement;
  let restore: HTMLElement | null = null;

  createEffect(
    () => props.open,
    (open) => {
      if (!open) return;

      // Escape closes it, and the page underneath must not scroll away behind
      // the sheet while it is up.
      restore = document.activeElement as HTMLElement | null;

      /*
       * Pinning the body at its current offset, rather than `overflow: hidden`,
       * which iOS Safari ignores - the page keeps scrolling and rubber-banding
       * behind the sheet.
       */
      const offset = window.scrollY;
      const body = document.body.style;
      const previous = { position: body.position, top: body.top, width: body.width };
      body.position = "fixed";
      body.top = `-${offset}px`;
      body.width = "100%";

      sheet.focus();

      const onKey = (event: KeyboardEvent) => {
        if (event.key === "Escape") props.onClose();
      };
      document.addEventListener("keydown", onKey);

      onCleanup(() => {
        document.removeEventListener("keydown", onKey);
        body.position = previous.position;
        body.top = previous.top;
        body.width = previous.width;
        window.scrollTo(0, offset);
        // Put the caret back where it was, or the next Tab starts from the top
        // of the document.
        restore?.focus();
      });
    },
  );

  return (
    <div
      class="mb-modal fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6"
      data-open={props.open ? "true" : "false"}
      inert={!props.open}
    >
      <div
        class="absolute inset-0 bg-black/55"
        style={{ "backdrop-filter": "blur(2px)", "-webkit-backdrop-filter": "blur(2px)" }}
        onClick={props.onClose}
        aria-hidden="true"
      />

      <div
        ref={sheet}
        role="dialog"
        aria-modal="true"
        aria-label={props.title}
        tabindex="-1"
        class="mb-sheet relative flex max-h-[86dvh] w-full flex-col overflow-hidden rounded-t-3xl border border-border bg-card shadow-card outline-none sm:max-h-[80dvh] sm:max-w-[32rem] sm:rounded-3xl"
      >
        <header class="flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-3">
          <span class="truncate text-[0.94rem] font-bold tracking-[-0.01em] text-foreground">
            {props.title}
          </span>
          <button
            type="button"
            aria-label={t("close", props.lang)}
            onClick={props.onClose}
            class="mb-press flex size-8 shrink-0 items-center justify-center rounded-full bg-secondary text-muted-foreground"
          >
            <CloseIcon size={14} />
          </button>
        </header>

        {/* Contained, so flicking past the end of the sheet does not start
            scrolling the page underneath it. */}
        <div class="mb-scroll grow overscroll-contain px-4 py-4">{props.children}</div>
      </div>
    </div>
  );
}
