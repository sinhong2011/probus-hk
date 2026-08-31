import { Show, createSignal } from "solid-js";
import type { JSX } from "@solidjs/web";
import { Drawer } from "~/components/Drawer";
import { SplitPage } from "~/components/Layout";
import { createWide } from "~/lib/wide";

/**
 * The shape the search and plan screens share, now that the map is their
 * canvas: the maps-app arrangement, at both widths.
 *
 * On a phone the map takes what the header and the keypad leave, and the
 * results are a sheet floating over it - resting almost full so the screen
 * still opens as the list a rider came for, pushed down when the map is the
 * question. On a wide window the same parts become Google's own layout: one
 * panel down the left with the fields and the results, and the map filling
 * everything else, which is the arrangement the whole desktop shell is built
 * around - the body fills the window, and here the map is the body.
 *
 * The sheet and the panel are one `panel`, placed once: rendering it into
 * both homes and toggling visibility would double every result in the DOM,
 * and a count of results should mean the count of results.
 */

/**
 * Where the results sheet rests, as shares of the space it lives in: pushed
 * down enough that the map is what the screen is showing, and pulled up, most
 * of it - the same grammar as the sheet over an opened-out route map.
 *
 * That space is the window itself for a screen with nothing docked under the
 * map (the planner), and the map's own panel where a keypad needs the foot of
 * the screen (search). Shares of a short map panel made a sheet that could
 * never stand up; shares of the window are what a maps app's sheet means.
 */
export const EXPLORE_SHEET_LOW = 0.45;
const EXPLORE_SHEET_TALL = 0.92;

export function ExploreFrame(props: {
  /** The title, the search/plan switch and the fields - every width. */
  header: JSX.Element;
  /** Blocks a wide window keeps in the panel under the fields - the dial. */
  asideExtra?: JSX.Element;
  /** The results: the sheet's contents on a phone, the panel's rest on a desktop. */
  panel: JSX.Element;
  map: JSX.Element;
  /** The phone's keypad, within thumb reach under everything. */
  dock?: JSX.Element;
  /** Names the results sheet for a screen reader. */
  sheetLabel: string;
  /**
   * The sheet's rest, for a screen that wants a say - the planner raises it
   * for the match list and drops it when the map becomes the answer. Pair
   * with `onSnapChange` so the screen's idea of it stays true.
   */
  snap?: number;
  onSnapChange?: (index: number) => void;
  /**
   * Whether the sheet is on the screen at all. A sheet exists to carry
   * something; a screen with nothing for it keeps it away entirely rather
   * than opening an empty card. Open if unsaid.
   */
  sheetOpen?: boolean;
  /**
   * Let a gesture push the sheet past its floor and off the screen, and say
   * when it happens. Off, the lowest snap point is a floor.
   */
  dismissible?: boolean;
  onDismiss?: () => void;
}) {
  const wide = createWide();

  /*
   * The sheet rests tall and does not scroll below that: held low it is a
   * window onto its first rows and the whole sheet is what the finger moves -
   * a finger moving up on content that can scroll would be scrolling it, and
   * the sheet would never rise.
   */
  /* With nothing docked under the map, the sheet belongs to the window: it
     rises over the header and the tab bar the way a maps app's does. A dock
     (search's dial) keeps the sheet inside the map's panel, clear of it. */
  const pageSheet = () => !props.dock;

  const [ownSnap, setOwnSnap] = createSignal(0);
  /* Owned by the screen when it says so, and by the frame otherwise. */
  const snap = () => props.snap ?? ownSnap();
  const setSnap = (index: number) => {
    if (props.onSnapChange) props.onSnapChange(index);
    else setOwnSnap(index);
  };
  const scrolls = () => snap() >= 1;

  return (
    <SplitPage
      mainFills
      dock={props.dock}
      aside={
        <>
          {props.header}
          <Show when={wide()}>
            {props.asideExtra}
            {props.panel}
          </Show>
        </>
      }
    >
      <div class="relative min-h-0 grow overflow-hidden rounded-2xl border border-border bg-map shadow-card">
        {props.map}
        <Show when={!wide()}>
          <Drawer
            open={props.sheetOpen ?? true}
            onClose={() => props.onDismiss?.()}
            within={!pageSheet()}
            flush={pageSheet()}
            dismissible={props.dismissible ?? false}
            snapPoints={[EXPLORE_SHEET_LOW, EXPLORE_SHEET_TALL]}
            initialSnap={0}
            snap={snap()}
            onSnapChange={setSnap}
            label={props.sheetLabel}
          >
            {/* As tall as the part of the sheet that shows at whichever rest
                it is at, so the visible part is the scrolling part. */}
            <div
              class={[
                "app-scroll min-h-0 px-3.5 pt-1",
                /* A flush card keeps the home indicator clear itself. */
                pageSheet() ? "pb-2" : "pb-safe-bottom",
                scrolls() ? "touch-pan-y overflow-y-auto" : "overflow-hidden",
              ]}
              style={{ height: "var(--snap-point-height)" }}
            >
              {props.panel}
            </div>
          </Drawer>
        </Show>
      </div>
    </SplitPage>
  );
}
