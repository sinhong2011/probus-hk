import { For, Show } from "solid-js";
import type { JSX } from "@solidjs/web";
import { Drawer as Sheet, type SnapPoint } from "@sinhong2011/solid-drawer";

/**
 * A sheet that rises from the bottom and is moved by hand.
 *
 * The sheets in this app were fixed things: open or closed, a fade between.
 * What a rider wants from one is what they get from the one on their phone's
 * maps app - to pull it up for more, push it down for the map, flick it away -
 * and that is a drawer, in the sense the word has come to mean on a screen:
 * a grab handle, a few heights it rests at, and a drag that follows the finger
 * and settles where the finger let go.
 *
 * The drawer itself is `@sinhong2011/solid-drawer`, this repo's own package; this
 * is the app's shape for it. Two kinds. A *modal* one covers the page with a
 * scrim, takes focus, closes on Escape, and pins the page behind it - a
 * dialog. A *non-modal* one sits over a map that stays live underneath, which
 * is the whole point of it: you read the station and drag the map at the same
 * time.
 *
 * Positions are given as fractions of the space the drawer lives in. Where
 * none are given the sheet is as tall as its content, up to a cap, and the only
 * gesture is dismissal.
 */

/** With no snap points, the tallest a content-sized sheet may be. */
const NATURAL_MAX = "86%";

export interface DrawerProps {
  open: boolean;
  onClose: () => void;
  /** Names the sheet for a screen reader. */
  label: string;
  children: JSX.Element;
  /**
   * Heights the sheet rests at, as fractions of its container, low to high.
   * Omit for a sheet the height of its content.
   */
  snapPoints?: number[];
  /** Which snap point to open at; the first if unsaid. */
  initialSnap?: number;
  /**
   * The snap point to rest at, for a parent that wants a say - to drop the
   * sheet back to its lowest height when what it shows has changed under it,
   * say. Pair with `onSnapChange` so the parent's idea of it stays true.
   */
  snap?: number;
  /** Told each time the sheet comes to rest at a different snap point. */
  onSnapChange?: (index: number) => void;
  /** A dialog: scrim, focus, Escape, and the page pinned behind it. */
  modal?: boolean;
  /**
   * Live inside the nearest positioned ancestor rather than over the window,
   * for a sheet that belongs to one panel - the map's - and not to the page.
   */
  within?: boolean;
  /** Extra classes on the sheet itself, e.g. a width cap on a wide screen. */
  class?: string;
  /**
   * With a modal sheet, draw the page back and down behind it - the card
   * stacked under a card, as a phone does with its own sheets. On by default;
   * needs the app shell marked `data-drawer-wrapper`.
   */
  scaleBackground?: boolean;
}

export function Drawer(props: DrawerProps) {
  const points = () => props.snapPoints;
  const tallest = () => {
    const list = points();
    return list?.length ? `${(list[list.length - 1] as number) * 100}%` : undefined;
  };
  /** The app thinks in indices; the drawer in values. */
  const active = (): SnapPoint | null | undefined => {
    if (props.snap === undefined) return undefined;
    return points()?.[props.snap] ?? null;
  };
  const onActive = (point: SnapPoint | null) => {
    const list = points();
    if (!list) return;
    // Put away, the sheet comes back at its opening height.
    if (point === null) {
      props.onSnapChange?.(props.initialSnap ?? 0);
      return;
    }
    const index = list.indexOf(point as number);
    if (index >= 0) props.onSnapChange?.(index);
  };

  // A function, not an element: JSX builds its components as it is
  // evaluated, and these have to be built inside the root, where the drawer's
  // context is.
  const sheet = () => (
    <>
      <Show when={props.modal}>
        <Sheet.Overlay
          class="fixed inset-0 z-40 bg-black/55"
          style={{ "backdrop-filter": "blur(2px)", "-webkit-backdrop-filter": "blur(2px)" }}
        />
      </Show>
      <Sheet.Content
        aria-label={props.label}
        class={[
          "z-40 mx-auto flex w-full flex-col overflow-hidden rounded-t-3xl border border-border bg-card shadow-lg outline-none",
          props.within
            ? "absolute inset-x-0 bottom-0"
            : "fixed inset-x-0 bottom-[var(--tabbar-height,0px)] lg:bottom-0",
          props.class ?? "",
        ]}
        style={{
          height: tallest(),
          "max-height": tallest() ? undefined : NATURAL_MAX,
        }}
      >
        {/* The handle: what says "this moves", before anything is tried. */}
        <div class="flex shrink-0 items-center justify-center pb-1 pt-2.5">
          <Sheet.Handle class="!h-1 !w-9 !bg-border !opacity-100" />
        </div>
        {/* The one thing inside that scrolls, and says so - the drawer takes
            every touch that does not. */}
        <div class="mb-scroll min-h-0 grow touch-pan-y overflow-y-auto overscroll-contain">
          {props.children}
        </div>
      </Sheet.Content>
    </>
  );

  return (
    <Sheet.Root
      open={props.open}
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
      modal={props.modal ?? false}
      snapPoints={points()}
      defaultActiveSnapPoint={points()?.[props.initialSnap ?? 0]}
      activeSnapPoint={active()}
      onActiveSnapPointChange={onActive}
      shouldScaleBackground={props.modal && props.scaleBackground !== false}
    >
      <Show when={!props.within} fallback={sheet()}>
        <Sheet.Portal>{sheet()}</Sheet.Portal>
      </Show>
    </Sheet.Root>
  );
}

/** The header most sheets want: a title, and the way out. */
export function DrawerHeader(props: {
  title: JSX.Element;
  onClose: () => void;
  closeLabel: string;
  children?: JSX.Element;
}) {
  return (
    <div class="flex shrink-0 items-start gap-2 px-3.5 pb-2 pt-0.5">
      <div class="flex min-w-0 grow flex-col gap-1">
        <h2 class="truncate text-[1.05rem] font-bold tracking-[-0.02em] text-foreground">
          {props.title}
        </h2>
        {props.children}
      </div>
      <button
        type="button"
        onClick={props.onClose}
        aria-label={props.closeLabel}
        class="mb-press -mr-1 flex size-8 shrink-0 items-center justify-center rounded-full bg-secondary text-muted-foreground"
      >
        <svg
          width="12"
          height="12"
          viewBox="0 0 12 12"
          fill="none"
          stroke="currentColor"
          stroke-width="1.8"
          stroke-linecap="round"
          aria-hidden="true"
        >
          <path d="M2 2l8 8M10 2l-8 8" />
        </svg>
      </button>
    </div>
  );
}

/** Rows of a sheet, separated by hairlines drawn between rather than around. */
export function DrawerRows(props: { children: JSX.Element[] | JSX.Element }) {
  const items = () => (Array.isArray(props.children) ? props.children : [props.children]);
  return (
    <div class="flex flex-col">
      <For each={items()}>
        {(child, i) => (
          <>
            <Show when={i() > 0}>
              <div class="ml-3.5 h-px bg-border" />
            </Show>
            {child}
          </>
        )}
      </For>
    </div>
  );
}
