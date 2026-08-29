import { Show, createEffect } from "solid-js";
import type { JSX } from "@solidjs/web";

/**
 * The shape every screen shares.
 *
 * One column, one gutter, one rhythm between blocks. Screens differ in what
 * they put inside that column, never in where the column sits - moving between
 * tabs should not shift the title, the edges or the spacing under them.
 *
 * The rule for extra width is that it should carry *more of the list*, never
 * stretch a single row across the window: a route number and its arrival time
 * have to stay close enough to read as one thing. So a wide window either packs
 * cards into columns or splits into two panes; it never widens a row.
 */

/** Gutter and column widths, in one place so nothing drifts. */
const GUTTER = "px-3.5 lg:px-8";
/*
 * One row width across the whole app: `content` matches the list column inside
 * a split screen exactly, so a bookmark row, a search result and a stop row are
 * all the same width no matter which screen you are on.
 */
const WIDTH = { content: "42rem", wide: "68rem" } as const;

export function Page(props: {
  children: JSX.Element;
  /** Set on screens whose content genuinely fills more than one column. */
  wide?: boolean;
  /**
   * A control that stays within thumb reach at the bottom of a phone screen.
   * A wide window has room to put it beside the content instead, so it is the
   * screen's job to render it there and this slot hides itself.
   */
  dock?: JSX.Element;
  /**
   * On a wide screen, hold the page to the window and let a pane inside it do
   * the scrolling. Without this the map and the route header scroll away with
   * the stop list, which on a desktop is the one thing that should stay put.
   */
  fill?: boolean;
  class?: string;
}) {
  /*
   * A filled page holds itself to the window, but the document behind it can
   * still scroll a few pixels - and a page that creeps while the pane inside it
   * scrolls feels broken. The root is pinned for as long as such a page is up.
   */
  createEffect(
    () => Boolean(props.fill),
    (fill) => {
      if (!fill) return;
      document.documentElement.classList.add("mb-fill");
      // Returned rather than `onCleanup`: the callback has no owner in Solid 2,
      // so a registered cleanup never ran and the root stayed pinned on every
      // screen visited after this one.
      return () => document.documentElement.classList.remove("mb-fill");
    },
  );

  return (
    <div
      class={[
        "mb-safe-top mb-scroll flex min-h-dvh flex-col",
        { "lg:h-dvh lg:min-h-0 lg:overflow-hidden": Boolean(props.fill) },
      ]}
    >
      <div
        class={[
          `mx-auto flex w-full grow flex-col gap-6 pt-4 lg:gap-8 lg:pt-8 ${GUTTER} ${props.class ?? ""}`,
          { "lg:min-h-0": Boolean(props.fill) },
        ]}
        style={{ "max-width": props.wide ? WIDTH.wide : WIDTH.content }}
      >
        {props.children}
      </div>

      <Show when={props.dock}>
        <div class="sticky bottom-[var(--tabbar-height)] z-20 lg:hidden">{props.dock}</div>
      </Show>

      {/* Keeps the last row clear of the tab bar. A filled page has no page
          scroll to run past, so the spacer would only steal height. */}
      <div class={["h-28 shrink-0", { "lg:hidden": Boolean(props.fill) }]} />
    </div>
  );
}

/**
 * A block of a page. The page owns the space between blocks, so a section only
 * has to say how tightly its own contents sit.
 */
export function Section(props: { children: JSX.Element; class?: string; tight?: boolean }) {
  return (
    <section class={`flex flex-col ${props.tight ? "gap-2" : "gap-2.5"} ${props.class ?? ""}`}>
      {props.children}
    </section>
  );
}

/**
 * Escapes the page gutter for something that should touch the edges - a sticky
 * header, or a control docked to the bottom of a phone screen.
 */
export function Bleed(props: { children: JSX.Element; class?: string }) {
  return <div class={`-mx-3.5 lg:-mx-8 ${props.class ?? ""}`}>{props.children}</div>;
}

/**
 * Cards of uneven height, packed into columns. CSS columns rather than a grid
 * so a tall stop card does not leave a hole beside a short one.
 */
export function CardColumns(props: { children: JSX.Element; class?: string }) {
  return (
    <div
      class={`flex flex-col gap-2.5 lg:block lg:columns-2 lg:gap-4 2xl:columns-3 ${props.class ?? ""}`}
    >
      {props.children}
    </div>
  );
}

/** One item inside CardColumns; keeps a card from splitting across a column. */
export function CardColumnItem(props: {
  children: JSX.Element;
  class?: string;
  style?: JSX.CSSProperties;
}) {
  return (
    <div class={`lg:mb-4 lg:break-inside-avoid ${props.class ?? ""}`} style={props.style}>
      {props.children}
    </div>
  );
}

/**
 * A screen with a fixed half and a scrolling half: the controls or the context
 * on the left, the long list on the right. Below `lg` the two simply stack, so
 * the phone reading order is the same one the layout is built from.
 */
export function SplitPage(props: {
  aside: JSX.Element;
  children: JSX.Element;
  dock?: JSX.Element;
  /**
   * Hand the pane's height to its contents instead of scrolling it.
   *
   * A long list inside a card looks wrong when the pane scrolls: the card's own
   * top and bottom edges slide out of the window with it. Set this and the card
   * can fill the pane and scroll its rows inside its own frame.
   */
  mainFills?: boolean;
}) {
  return (
    <Page wide dock={props.dock} fill>
      {/* The list column is capped: a row whose route number and arrival time
          sit half a window apart is two things, not one. Surplus width goes to
          the margins instead. */}
      {/*
       * `grid-rows-[minmax(0,1fr)]` is what makes the panes scroll: without it
       * the row is sized to the tallest child, so a full height on either half
       * is a full height of something already taller than the window.
       */}
      <div class="grid gap-6 lg:min-h-0 lg:grow lg:grid-cols-[minmax(0,22rem)_minmax(0,42rem)] lg:grid-rows-[minmax(0,1fr)] lg:justify-center lg:gap-10">
        {/*
         * `[&>*]:shrink-0` is load-bearing: a flex column shrinks its children
         * to fit, and a card that clips its own overflow to keep its rounded
         * corners then swallows the list inside it instead of letting the pane
         * scroll.
         */}
        <div class="mb-scroll flex flex-col gap-6 lg:h-full lg:min-h-0 lg:overflow-y-auto lg:[&>*]:shrink-0">
          {props.aside}
        </div>
        {/* The half that scrolls. On a phone there is only one column, so the
            page scrolls as usual. */}
        <div
          class={[
            "mb-scroll flex min-w-0 flex-col gap-6 pb-2 lg:h-full lg:min-h-0 lg:gap-8",
            props.mainFills ? "lg:overflow-hidden" : "lg:overflow-y-auto lg:[&>*]:shrink-0",
          ]}
        >
          {props.children}
        </div>
      </div>
    </Page>
  );
}
