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
 * It is drawn the way shadcn/ui's Base UI drawer is drawn: a card floated a
 * small inset in from the edges of whatever it lives in, rounded on all four
 * corners, a hairline and a shadow to lift it, and a short grab bar across
 * the top of a sheet. The inset is padding on the moving element rather than
 * a margin on it, so the drawer's own "off screen" - a translate of its full
 * size - takes the gap with it and nothing peeks in while it is closed.
 *
 * Positions are given as fractions of the space the drawer lives in. Where
 * none are given the sheet is as tall as its content, up to a cap, and the only
 * gesture is dismissal.
 */

/**
 * With no snap points, the tallest a content-sized sheet may be - shadcn's
 * `100dvh - 6rem`, as a share of the space the sheet lives in. A class rather
 * than an inline style: the drawer writes its own inline `max-height` while
 * the keyboard is up, and clears it after, and a cap set the same way went
 * with it.
 */
const NATURAL_MAX = "max-h-[calc(100%-6rem)]";

export interface DrawerProps {
  open: boolean;
  onClose: () => void;
  /** Names the sheet for a screen reader. */
  label: string;
  children: JSX.Element;
  /**
   * Heights the sheet rests at, low to high: fractions of its container, or
   * pixel lengths (`"88px"`) for a rest that is the height of a header
   * whatever the screen. Omit for a sheet the height of its content.
   */
  snapPoints?: SnapPoint[];
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
   * Whether a gesture may put the sheet away. Off, the lowest snap point is a
   * floor: the sheet can be pushed down to it and no further, and only the
   * screen that owns it can close it.
   */
  dismissible?: boolean;
  /**
   * Animate the sheet's height as what it shows changes size - a sheet with
   * two views, sized to each, rather than a fixed frame around both.
   */
  transitionResize?: boolean;
  /**
   * Live inside the nearest positioned ancestor rather than over the window,
   * for a sheet that belongs to one panel - the map's - and not to the page.
   */
  within?: boolean;
  /**
   * A sheet over a sheet: rendered inside another `Drawer`'s children, it
   * opens over that one, which draws back and follows this one's drag, the
   * way a phone stacks its own. Fixed for the life of the drawer.
   */
  nested?: boolean;
  /**
   * A bottom sheet the full width of its container and flush with its foot:
   * no inset at the sides, no gap below, square at the bottom. For a sheet
   * that is a panel of the screen rather than a card floated over it - a
   * map opened out, the network map. Works with `within`: the sheet still
   * lives in the panel, it just is a panel of that panel.
   */
  flush?: boolean;
  /** Extra classes on the sheet itself, e.g. a width cap on a wide screen. */
  class?: string;
  /**
   * The edge it comes from. A sheet rises from the bottom; a panel slides in
   * from the right, full height, for a wide window where a list has room
   * beside the page instead of over it. `"bottom"` if unsaid.
   *
   * A panel is three quarters of a narrow window and `max-w-sm` of a wide
   * one, and has no handle - a handle is a thing you pull down, and this one
   * is pushed aside.
   */
  side?: "bottom" | "right";
  /**
   * Whether the drawer wraps its contents in the one region that scrolls. On
   * by default. Off, the contents lay themselves out inside the card - a
   * header, the part that scrolls, a footer that stays put - the way shadcn's
   * drawer leaves that to the page. Whatever scrolls has to say so with
   * `touch-pan-y`, as the drawer takes every touch that does not. A side
   * panel never wraps; its contents always lay themselves out.
   */
  scroll?: boolean;
  /**
   * With a modal sheet, draw the page back and down behind it - the card
   * stacked under a card, as a phone does with its own sheets. On by default;
   * needs the app shell marked `data-drawer-wrapper`.
   */
  scaleBackground?: boolean;
}

export function Drawer(props: DrawerProps) {
  const side = () => props.side ?? "bottom";
  const right = () => side() === "right";
  const scrolls = () => !right() && (props.scroll ?? true);
  const flush = () => !right() && Boolean(props.flush);
  /* A sheet that cannot be put away and has no rest positions does not move,
     and a handle on a thing that does not move is a lie. */
  const draggable = () => (props.dismissible ?? true) || !!props.snapPoints;
  const points = () => props.snapPoints;
  const tallest = () => {
    const list = points();
    const last = list?.[list.length - 1];
    return typeof last === "number" ? `${last * 100}%` : last;
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
    const index = list.indexOf(point);
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
          /* Over everything on the page, the tab bar included (it is z-30):
             a drawer is the frontmost thing while it is up, whatever it is
             over, as shadcn's is. A nested one is over the drawer it is in -
             by z-index, not by order, because its portal lands in the body
             before its parent's does. */
          props.nested ? "z-50" : "z-40",
          "flex flex-col outline-none",
          /* Where it lives, and the inset it keeps from the edges of it: a
             panel's own edges, or the window's - clear of the home indicator
             at the foot of a phone. */
          right()
            ? "fixed inset-y-0 right-0 w-3/4 py-2 pr-2 sm:max-w-sm"
            : [
                "mx-auto w-full",
                flush() ? "" : "px-2",
                [
                  props.within ? "absolute" : "fixed",
                  "inset-x-0 bottom-0",
                  flush()
                    ? ""
                    : props.within
                      ? "pb-2"
                      : "pb-[calc(var(--spacing-safe-bottom)+0.5rem)]",
                ].join(" "),
              ].join(" "),
          { [NATURAL_MAX]: !right() && !tallest() },
          props.class ?? "",
        ]}
        style={{ height: right() ? undefined : tallest() }}
      >
        {/* The card: what is seen of the drawer. */}
        <div
          class={[
            /* The hairline is what separates the card from whatever it floats
               over - a map, a scrimmed page - where the shadow alone leaves
               the top edge soft against a light background. */
            "flex min-h-0 grow flex-col overflow-hidden border border-border bg-drawer shadow-xl",
            /* Flush with the foot of the window, the card keeps the home
               indicator clear inside itself, and has no bottom corners to
               round. */
            flush() ? "rounded-t-3xl border-b-0 pb-[var(--spacing-safe-bottom)]" : "rounded-3xl",
            /* A breath above the handle so the bar is not sitting on the
               card's top edge. A side panel has no handle and keeps its own
               inset. */
            right() ? "" : "pt-2",
          ]}
        >
          {/* The handle: what says "this moves", before anything is tried.
              The bar sits in the middle of the strip, not at its foot. */}
          <Show when={!right() && draggable()}>
            <div class="flex h-[1.75rem] w-full shrink-0 items-center justify-center">
              <Sheet.Handle class="relative -top-1 !h-1 !w-24 rounded-full !bg-border !opacity-100" />
            </div>
          </Show>
          <Show when={scrolls()} fallback={props.children}>
            {/* The one thing inside that scrolls, and says so - the drawer
                takes every touch that does not. */}
            <div class="app-scroll min-h-0 grow touch-pan-y overflow-y-auto overscroll-contain">
              {props.children}
            </div>
          </Show>
        </div>
      </Sheet.Content>
    </>
  );

  // Decided once: a drawer is nested or it is not, and the two are different
  // roots rather than one root with a flag.
  const Root = props.nested ? Sheet.NestedRoot : Sheet.Root;

  return (
    <Root
      open={props.open}
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
      modal={props.modal ?? false}
      direction={side()}
      dismissible={props.dismissible ?? true}
      transitionResize={props.transitionResize ?? false}
      snapPoints={points()}
      defaultActiveSnapPoint={points()?.[props.initialSnap ?? 0]}
      activeSnapPoint={active()}
      onActiveSnapPointChange={onActive}
      shouldScaleBackground={props.modal && props.scaleBackground !== false}
    >
      <Show when={!props.within} fallback={sheet()}>
        <Sheet.Portal>{sheet()}</Sheet.Portal>
      </Show>
    </Root>
  );
}

/**
 * The header a sheet over a map wants: a title, a line under it, and the way
 * out. Set as shadcn sets its drawer header - padded, the title at base
 * weight, the line under it muted - with the close as the small ghost cross
 * shadcn puts in the corner of what it opens.
 */
export function DrawerHeader(props: {
  title: JSX.Element;
  onClose: () => void;
  closeLabel: string;
  /** The line under the title: a count, a chip, what the sheet is for. */
  children?: JSX.Element;
}) {
  return (
    <div class="relative flex shrink-0 flex-col gap-0.5 p-4 pb-3 pr-12">
      <h2 class="truncate text-base font-medium text-foreground">{props.title}</h2>
      <Show when={props.children}>
        <div class="flex items-center gap-2 text-sm text-muted-foreground">{props.children}</div>
      </Show>
      <button
        type="button"
        onClick={props.onClose}
        aria-label={props.closeLabel}
        class="app-press absolute right-3 top-3 flex size-8 items-center justify-center rounded-md text-foreground opacity-70 transition-opacity duration-state active:opacity-100"
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          stroke-width="1.6"
          stroke-linecap="round"
          aria-hidden="true"
        >
          <path d="M3.5 3.5l9 9M12.5 3.5l-9 9" />
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
