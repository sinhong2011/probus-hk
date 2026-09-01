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
  /**
   * Status on the right of the title - a distance, a time - rather than a
   * second line of the title. A camera's "229 m · 更新於 11:42" is not what
   * the sheet is called, and sitting under the name it read as a subtitle.
   */
  aside?: JSX.Element;
  /** Extra classes on the drawer, e.g. a wider panel than the default. */
  class?: string;
  /** Extra classes on the title block above the scroll body. */
  headerClass?: string;
  /** Extra classes on the scroll body. */
  bodyClass?: string;
  /**
   * Scroll the body as one block. Turn off when the contents carry their own
   * scroller - a card whose rows move inside its frame.
   */
  bodyScroll?: boolean;
  /**
   * A second deed in the footer, above Close - opening the thing this sheet
   * is a preview of, rather than putting it away.
   */
  action?: JSX.Element;
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
      class={[right() ? "" : "sm:max-w-[32rem]", props.class ?? ""].join(" ")}
    >
      {/* Centred on a sheet, as shadcn centres its own; a panel reads from
          the left, as a column does. An aside pins the header to a left
          title and a right status, or a centred name with a number off to
          one side would be two alignments on one line. */}
      <div
        class={[
          "flex shrink-0 p-4 pb-0",
          props.headerClass,
          props.aside
            ? "items-start justify-between gap-3"
            : ["flex-col gap-0.5", { "text-center md:text-left": !right() }],
        ]}
      >
        <div class={props.aside ? "min-w-0 flex-1 text-left" : undefined}>
          <h2 class="text-balance text-base font-medium text-foreground">{props.title}</h2>
          <Show when={props.description}>
            <p class="text-balance text-sm text-muted-foreground">{props.description}</p>
          </Show>
        </div>
        <Show when={props.aside}>
          <div class="shrink-0 pt-px text-right">{props.aside}</div>
        </Show>
      </div>
      <div
        class={[
          "min-h-0 flex-1",
          props.bodyScroll === false
            ? "flex flex-col overflow-hidden"
            : "app-scroll touch-pan-y overflow-y-auto overscroll-contain",
          props.bodyClass ?? "p-4",
        ]}
      >
        {props.children}
      </div>
      {/* Two deeds sit in a row, each half the sheet: a full-width stack
          of the same two bars is twice the button a rider needs to tap. */}
      <div
        class={[
          "mt-auto flex shrink-0 px-4 pt-2 pb-2",
          props.action ? "flex-row gap-2" : "flex-col",
        ]}
      >
        <Show when={props.action}>
          <div class="min-w-0 flex-1">{props.action}</div>
        </Show>
        <button
          type="button"
          onClick={props.onClose}
          class={[
            "app-press flex h-8 items-center justify-center rounded-lg bg-secondary text-[0.81rem] font-semibold text-foreground",
            props.action ? "min-w-0 flex-1" : "w-full",
          ]}
        >
          {t("close", props.lang)}
        </button>
      </div>
    </Drawer>
  );
}
