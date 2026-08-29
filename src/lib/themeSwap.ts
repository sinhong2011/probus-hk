import { reflectTheme, settings, type ThemeChoice } from "~/stores/settings";

/**
 * Changing the theme, as a change rather than a jump cut.
 *
 * Day becoming night across a whole screen in one frame is the harshest thing
 * a settings toggle can do, and at night it is a face full of white. The new
 * theme is drawn over the old one and wiped in from the control that asked for
 * it, so the rider watches their own tap spread across the screen.
 *
 * It is a view transition, so where the browser has no such thing - Firefox
 * today - the theme simply changes, which is what happened before anyway.
 */
type Transitioning = Document & {
  startViewTransition?: (run: () => void) => { ready: Promise<void>; finished: Promise<void> };
};

const SWEEP_MS = 460;

/**
 * The curve the wipe travels on, taken from the stylesheet so the app keeps one
 * set of curves.
 *
 * It has to be `--ease-std` and not the `--ease-out` most of the app moves on.
 * An ease-out is right for a thing arriving somewhere and settling, but this is
 * an edge crossing fifteen hundred pixels, and on that curve it covered three
 * quarters of the screen in the first hundred milliseconds and then spent the
 * remaining three hundred and fifty creeping through the last sliver. An edge
 * that decelerates tenfold halfway across does not read as easing; it reads as
 * the animation catching. `--ease-std` keeps it moving through the middle.
 */
function sweepEase(): string {
  const token = getComputedStyle(document.documentElement).getPropertyValue("--ease-std").trim();
  return token || "cubic-bezier(0.4, 0, 0.2, 1)";
}

/**
 * The soft band at the sweep's edge, as a share of how far the sweep has got.
 *
 * A share rather than a width, so it reads the same on a phone as on a desktop,
 * and so the band is at its narrowest under the finger - where the rider is
 * looking - and widest out at the far corners, where nobody is.
 */
const FEATHER_PCT = 8;

/**
 * The gradient that softens the edge.
 *
 * It never changes, which is the point. Chrome interpolates one gradient into
 * another discretely - a mask animated by rewriting its colour stops does not
 * sweep at all, it holds the old theme to the halfway mark and then cuts to the
 * new one. So the gradient is fixed and the sweep is `mask-size` growing under
 * it, which is a length, and lengths interpolate.
 */
const SWEEP_MASK = `radial-gradient(closest-side, #000 ${100 - FEATHER_PCT}%, #0000 100%)`;

export function swapTheme(next: ThemeChoice, from?: { x: number; y: number }) {
  const doc = document as Transitioning;
  /*
   * The browser photographs the document the moment this callback returns, and
   * that photograph is the whole effect: it is the new theme the wipe reveals.
   * Setting the store alone does not get it there - Solid 2 runs effects on its
   * own schedule, a task or so after the handler that wrote them, by which time
   * the picture has been taken of the old theme. So the attribute is written
   * here as well; the effect then writes the same value again, and changes
   * nothing.
   */
  const apply = () => {
    settings.setTheme(next);
    reflectTheme(next);
  };

  const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (still || !doc.startViewTransition) return apply();

  /*
   * The default cross-fade would run underneath the wipe and show through it.
   * The class turns it off for exactly this transition and no other.
   */
  const root = document.documentElement;
  root.classList.add("mb-theme-swap");

  const transition = doc.startViewTransition(apply);
  const origin = from ?? { x: window.innerWidth / 2, y: 0 };

  void transition.ready
    .then(() => {
      // Far enough to cover the furthest corner from where the tap landed.
      const radius = Math.hypot(
        Math.max(origin.x, window.innerWidth - origin.x),
        Math.max(origin.y, window.innerHeight - origin.y),
      );
      /*
       * A mask, not a clip: a clip gives a hard arc, and between a white screen
       * and a black one that is the highest-contrast edge the app ever draws -
       * every stair-step along it is visible. Under the gradient the two themes
       * are simply mixed for the width of the band, and the edge stops being an
       * edge.
       *
       * The mask is a square box grown from nothing, kept centred on the tap by
       * walking its corner out at the same rate. `closest-side` then ties the
       * circle to the box, so one length drives the whole sweep.
       */
      const side = radius * 2;

      root.animate(
        {
          maskImage: [SWEEP_MASK, SWEEP_MASK],
          maskRepeat: ["no-repeat", "no-repeat"],
          maskSize: ["0px 0px", `${side}px ${side}px`],
          maskPosition: [
            `${origin.x}px ${origin.y}px`,
            `${origin.x - radius}px ${origin.y - radius}px`,
          ],
        },
        {
          duration: SWEEP_MS,
          easing: sweepEase(),
          pseudoElement: "::view-transition-new(root)",
        },
      );
    })
    .catch(() => undefined);

  void transition.finished
    .catch(() => undefined)
    .finally(() => root.classList.remove("mb-theme-swap"));
}

/** Where a click landed, for the wipe to start from. */
export function pointerOrigin(event: MouseEvent): { x: number; y: number } {
  const target = event.currentTarget as HTMLElement | null;
  if (event.clientX || event.clientY) return { x: event.clientX, y: event.clientY };
  // A keyboard "click" reports no coordinates; the control itself is the origin.
  const box = target?.getBoundingClientRect();
  return box
    ? { x: box.left + box.width / 2, y: box.top + box.height / 2 }
    : { x: window.innerWidth / 2, y: 0 };
}
