import { createEffect } from "solid-js";
import type { JSX } from "@solidjs/web";

/**
 * The one pill that travels behind a set of choices.
 *
 * Two pills that blink on and off are two states; one pill that moves is the
 * same place seen from another side, and the movement is what says so. The app
 * makes that gesture in more than one place - the search/plan switch, the
 * navigation rail, every segmented control - so it is one component rather than
 * one per site, which is how they drifted apart in the first place.
 *
 * It measures the choice it is behind rather than stepping by a fixed fraction.
 * Stepping needs every choice to be the same size, which a row of words is not:
 * forcing 繁中 and EN into equal halves broke the first onto two lines. Drop the
 * pill inside the track, mark the active choice `data-pill-active="true"`, and
 * the pill finds it - at any width, in any language.
 *
 * The mark is not `data-active`: the router owns that attribute on every link it
 * claims, writing an empty string on the current one and stripping it from the
 * rest. A track of links agreed with it on the first paint and then lost the
 * argument on the first navigation - the pill went looking for `"true"`, found
 * `""`, and never showed itself again.
 */
export function SlidingPill(props: {
  /** Whatever changing means the pill should move; only read, never rendered. */
  active: unknown;
  axis?: "x" | "y";
  /** Skin of the pill itself, e.g. `rounded-full bg-card shadow-card`. */
  class?: string;
  style?: JSX.CSSProperties;
}) {
  let pill!: HTMLDivElement;

  const measure = () => {
    const track = pill.parentElement;
    const target = track?.querySelector<HTMLElement>('[data-pill-active="true"]');
    if (!target) return;

    /*
     * The travel is the gap between the two, not the choice's own offset: both
     * are measured from the track's border box, while the pill starts at the
     * content box inside its padding. Translating by the raw offset pushed the
     * pill that padding further along, which the last choice in a track shows
     * as an edge hanging over the end of it. Offsets rather than rects because
     * they ignore transforms - a rect read mid-travel is the animated one.
     */
    if (props.axis === "y") {
      pill.style.transform = `translateY(${target.offsetTop - pill.offsetTop}px)`;
      pill.style.height = `${target.offsetHeight}px`;
    } else {
      pill.style.transform = `translateX(${target.offsetLeft - pill.offsetLeft}px)`;
      pill.style.width = `${target.offsetWidth}px`;
    }
    // Until it has been measured it would be a pill of no size at the origin.
    pill.dataset.ready = "true";
  };

  createEffect(
    () => props.active,
    () => {
      // After the choice has rendered: the new one has to exist to be measured.
      requestAnimationFrame(measure);
    },
  );

  /*
   * Labels change width when the language does, and a sidebar changes width
   * when it collapses; both move the pill without anything here changing.
   */
  createEffect(
    () => null,
    () => {
      const track = pill.parentElement;
      if (!track) return;
      const observer = new ResizeObserver(() => measure());
      observer.observe(track);
      for (const child of track.children) observer.observe(child);
      // Returned: an `onCleanup` inside an effect callback has no owner in Solid 2.
      return () => observer.disconnect();
    },
  );

  return (
    <div
      ref={pill}
      aria-hidden="true"
      data-ready="false"
      class={[
        // The travel is the whole point of the component, so it gets the
        // longer of the app's durations: at state speed it was over before
        // the eye had followed it.
        "pointer-events-none absolute transition-[transform,width,height,opacity] duration-reveal ease-[var(--ease-spring)] data-[ready=false]:opacity-0",
        props.class ?? "",
      ]}
      style={props.style}
    />
  );
}
