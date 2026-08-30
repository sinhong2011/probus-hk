import { Show, createEffect, createSignal, onCleanup } from "solid-js";
import type { JSX } from "@solidjs/web";

/**
 * The shape every screen shares.
 *
 * One gutter, one rhythm between blocks, and one width: the body of every
 * screen takes all the room the window gives it. Screens used to pick their own
 * cap - 42rem here, 68rem there - so moving between tabs slid the whole page
 * sideways and left a desktop window mostly empty; the body now fills, and it
 * is the *contents* that decide what to do with the space.
 *
 * The rule for that extra width is that it should carry *more of the list*,
 * never stretch a single row across the window: a route number and its arrival
 * time have to stay close enough to read as one thing. So a wide screen packs
 * cards into columns, splits rows into a grid, or splits into two panes.
 */

/** The one gutter, in one place so nothing drifts. */
const GUTTER = "px-3.5 lg:px-8";

export function Page(props: {
  children: JSX.Element;
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
   *
   * `"always"` holds the page to the window on a phone as well, ending it
   * above the tab bar: for a screen whose list is the thing worth scrolling
   * at every width, with the rest kept in view over it.
   */
  fill?: boolean | "always";
  class?: string;
}) {
  /*
   * A filled page holds itself to the window, but the document behind it can
   * still scroll a few pixels - and a page that creeps while the pane inside it
   * scrolls feels broken. The root is pinned for as long as such a page is up.
   */
  createEffect(
    () => props.fill ?? false,
    (fill) => {
      if (!fill) return;
      const pinned = fill === "always" ? ["mb-fill", "mb-fill-always"] : ["mb-fill"];
      document.documentElement.classList.add(...pinned);
      // Returned rather than `onCleanup`: the callback has no owner in Solid 2,
      // so a registered cleanup never ran and the root stayed pinned on every
      // screen visited after this one.
      return () => document.documentElement.classList.remove(...pinned);
    },
  );

  /* How tall the dock is right now - it changes when the keypad hides for
     the system keyboard - so the spacer under the page can match it. */
  const [dockHeight, setDockHeight] = createSignal(0, { ownedWrite: true });
  const watchDock = (el: HTMLElement) => {
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => setDockHeight(el.offsetHeight));
    observer.observe(el);
    onCleanup(() => observer.disconnect());
  };

  return (
    <div
      class={[
        "pt-safe-top mb-scroll flex min-h-dvh flex-col",
        { "lg:h-dvh lg:min-h-0 lg:overflow-hidden": Boolean(props.fill) },
        { "h-dvh min-h-0 overflow-hidden": props.fill === "always" },
      ]}
    >
      <div
        class={[
          `flex w-full grow flex-col gap-6 pt-4 lg:gap-8 lg:pt-8 ${GUTTER} ${props.class ?? ""}`,
          /* A filled page ends where the sidebar ends: the sidebar floats
             `inset-y-3` from the window, and a pane that ran on to the very
             edge made the two look cut to different lengths. */
          { "lg:min-h-0 lg:pb-3": Boolean(props.fill) },
          /* Held to the window on a phone too, the page ends above the tab
             bar instead of scrolling a spacer past it. */
          { "min-h-0 pb-[calc(var(--tabbar-height)+0.5rem)]": props.fill === "always" },
        ]}
      >
        {props.children}
      </div>

      {/*
       * Pinned to the screen, above the tab bar, whatever the page under it is
       * doing. It was sticky, which only pins once the page is taller than the
       * window: a short page left the keypad sitting under the last card
       * instead of under the thumb. The spacer below grows to the dock's
       * measured height so the page's last row can still scroll clear of it.
       */}
      <Show when={props.dock}>
        <div ref={watchDock} class="fixed inset-x-0 bottom-[var(--tabbar-height)] z-20 lg:hidden">
          {props.dock}
        </div>
        <div class="shrink-0 lg:hidden" style={{ height: `${dockHeight()}px` }} />
      </Show>

      {/* Keeps the last row clear of the tab bar. A filled page has no page
          scroll to run past, so the spacer would only steal height. */}
      <div
        class={[
          "h-28 shrink-0",
          { "lg:hidden": Boolean(props.fill) },
          { hidden: props.fill === "always" },
        ]}
      />
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
 *
 * The column count follows the window rather than a fixed page width, because
 * the page no longer has one: every step up in width buys another column of
 * cards instead of another inch on each card.
 */
export function CardColumns(props: { children: JSX.Element; class?: string }) {
  return (
    <div
      class={`flex flex-col gap-2.5 lg:block lg:columns-2 lg:gap-4 2xl:columns-3 min-[110rem]:columns-4 ${props.class ?? ""}`}
    >
      {props.children}
    </div>
  );
}

/**
 * A list of rows that keeps its rows readable on a wide screen by wrapping
 * them into columns instead of stretching each one across the window.
 *
 * In one column it is the card the rest of the app draws, hairline and all -
 * the rule inset from the left so the list reads as one block with a seam
 * rather than as a stack of slabs. In two it cannot be: a rule inset on the
 * left of the right-hand column would point at nothing, so the grid's own gaps
 * carry the separator colour instead and it runs both ways. Children are plain
 * rows either way - no `Hairline` between them.
 */
export function RowCard(props: {
  children: JSX.Element;
  /** Hold the list to one column, e.g. while its rows are being dragged. */
  single?: boolean;
  class?: string;
}) {
  return (
    <div
      class={[
        "grid overflow-hidden rounded-xl border border-border bg-card shadow-card",
        "[&>*]:relative [&>*+*]:before:absolute [&>*+*]:before:left-3.5 [&>*+*]:before:right-0 [&>*+*]:before:top-0 [&>*+*]:before:h-px [&>*+*]:before:bg-border [&>*+*]:before:content-['']",
        props.single
          ? ""
          : [
              "lg:grid-cols-2 lg:gap-px lg:bg-border lg:[&>*]:bg-card lg:[&>*+*]:before:hidden",
              "min-[110rem]:grid-cols-3",
              /* An odd number of rows leaves the last cell of the grid empty,
                 and an empty cell is a hole of the separator colour in the
                 corner of the card. The last row widens to close it. */
              "lg:[&>*:last-child:nth-child(odd)]:col-span-2",
              "min-[110rem]:[&>*:last-child:nth-child(3n+1)]:col-span-3",
              "min-[110rem]:[&>*:last-child:nth-child(3n+2)]:col-span-2",
              "min-[110rem]:[&>*:last-child:nth-child(3n)]:col-span-1",
            ].join(" "),
        props.class ?? "",
      ]}
    >
      {props.children}
    </div>
  );
}

/**
 * Cards of even weight, laid out left to right. A grid rather than columns
 * where reading order matters more than packing - a ranked list stays ranked
 * across the row, which is how a reader scans it.
 *
 * The cards in a row share a height. They hold live arrivals, so a card is
 * taller the moment a third bus is due, and a row of cards jostling half a line
 * up and down as the countdowns tick was the grid redrawing itself every
 * refresh; matched, the row is a shelf and only the numbers move.
 */
export function CardGrid(props: {
  children: JSX.Element;
  /** Hold the cards to one column, e.g. while they are being dragged. */
  single?: boolean;
  class?: string;
}) {
  return (
    <div
      class={[
        "grid gap-2.5 lg:gap-4",
        props.single ? "" : "lg:grid-cols-2 min-[110rem]:grid-cols-3",
        props.class ?? "",
      ]}
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
   * can fill the pane and scroll its rows inside its own frame - on a phone as
   * well, where the aside stacks above it and the list takes whatever height is
   * left under it. Held to the window like that, every pixel between blocks is
   * taken from the list, so the blocks sit closer than on a scrolling page.
   */
  mainFills?: boolean;
  /**
   * Give the surplus width to the aside rather than to the list.
   *
   * For a screen whose aside is a map: a map is the one thing here that is
   * worth more the bigger it is, while its list is a numbered trail of stops
   * that cannot wrap into columns and reads worse the wider each row gets.
   */
  wideAside?: boolean;
}) {
  return (
    <Page dock={props.dock} fill={props.mainFills ? "always" : true}>
      {/* Both panes together fill the window - the list used to be capped at
          42rem as well, which parked the pair of them in the middle with the
          rest of the screen empty. Which pane takes the surplus is the screen's
          call: the list, unless its aside is a map. */}
      {/*
       * `grid-rows-[minmax(0,1fr)]` is what makes the panes scroll: without it
       * the row is sized to the tallest child, so a full height on either half
       * is a full height of something already taller than the window.
       */}
      {/*
       * On a phone a filling list is the second row, and the aside above it is
       * given no more than it needs. The list keeps a floor rather than the
       * aside keeping its full height: on a short screen the aside scrolls
       * inside its row, which beats a list of one visible stop.
       */}
      <div
        class={[
          props.mainFills
            ? "grid min-h-0 grow gap-3 grid-rows-[minmax(0,auto)_minmax(8rem,1fr)] lg:grid-rows-[minmax(0,1fr)] lg:gap-10"
            : "grid gap-6 lg:min-h-0 lg:grow lg:grid-rows-[minmax(0,1fr)] lg:gap-10",
          props.wideAside
            ? "lg:grid-cols-[minmax(22rem,1fr)_minmax(0,46rem)]"
            : "lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]",
        ]}
      >
        {/*
         * `[&>*]:shrink-0` is load-bearing: a flex column shrinks its children
         * to fit, and a card that clips its own overflow to keep its rounded
         * corners then swallows the list inside it instead of letting the pane
         * scroll.
         */}
        <div
          class={
            props.mainFills
              ? "mb-scroll flex min-h-0 flex-col gap-3 overflow-y-auto [&>*]:shrink-0 lg:h-full lg:gap-6"
              : "mb-scroll flex flex-col gap-6 lg:h-full lg:min-h-0 lg:overflow-y-auto lg:[&>*]:shrink-0"
          }
        >
          {props.aside}
        </div>
        {/* The half that scrolls. On a phone there is only one column, so the
            page scrolls as usual - unless the list fills, in which case this
            row is the height it has and the card inside it does the scrolling. */}
        <div
          class={[
            "mb-scroll flex min-w-0 flex-col lg:h-full lg:min-h-0",
            props.mainFills
              ? "min-h-0 gap-3 overflow-hidden lg:gap-8"
              : "gap-6 pb-2 lg:gap-8 lg:overflow-y-auto lg:pb-0 lg:[&>*]:shrink-0",
          ]}
        >
          {props.children}
        </div>
      </div>
    </Page>
  );
}
