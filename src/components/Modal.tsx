import { Show } from "solid-js";
import type { JSX } from "@solidjs/web";
import { Drawer } from "./Drawer";
import { type Lang, t } from "~/lib/i18n";

/**
 * A dialog: a drawer that covers the page.
 *
 * Reference material - a timetable, a full stop list - does not belong inline.
 * Opening it there pushed the page it was attached to out from under the
 * reader, and inside a sticky column it had nowhere to go at all.
 *
 * It was a sheet that faded in and out; it is now the same drawer the map
 * uses, in its modal form - a scrim, focus held inside, Escape to leave, and a
 * handle that can be pulled to put it away. One kind of sheet across the app,
 * so a gesture learned on one works on all of them.
 *
 * Laid out as shadcn's drawer lays its own out: a header of title and
 * description, the body as the one part that scrolls, and a footer that
 * holds the way out - the same from the bottom of a phone and from the side
 * of a wide window.
 */
export function Modal(props: {
  open: boolean;
  onClose: () => void;
  title: string;
  lang: Lang;
  children: JSX.Element;
  /**
   * A panel from the right rather than a sheet from the bottom, for a wide
   * window where a long list reads better as a column beside the page.
   */
  side?: "bottom" | "right";
  /** A line under the title saying what the sheet is for. */
  description?: string;
}) {
  const right = () => props.side === "right";
  return (
    <Drawer
      open={props.open}
      onClose={props.onClose}
      modal
      side={props.side}
      scroll={false}
      label={props.title}
      class={right() ? "" : "sm:max-w-[32rem]"}
    >
      {/* Centred on a sheet, as shadcn centres its own; a panel reads from
          the left, as a column does. */}
      <div
        class={[
          "flex shrink-0 flex-col gap-0.5 p-4 pb-0",
          { "text-center md:text-left": !right() },
        ]}
      >
        <h2 class="text-base font-medium text-foreground">{props.title}</h2>
        <Show when={props.description}>
          <p class="text-balance text-sm text-muted-foreground">{props.description}</p>
        </Show>
      </div>
      <div class="app-scroll min-h-0 flex-1 touch-pan-y overflow-y-auto overscroll-contain p-4">
        {props.children}
      </div>
      <div class="mt-auto flex shrink-0 flex-col gap-2 p-4 pt-0">
        <button
          type="button"
          onClick={props.onClose}
          class="app-press flex h-10 w-full items-center justify-center rounded-xl bg-secondary text-[0.88rem] font-semibold text-foreground"
        >
          {t("close", props.lang)}
        </button>
      </div>
    </Drawer>
  );
}
