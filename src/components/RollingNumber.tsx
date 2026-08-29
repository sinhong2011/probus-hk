import { createEffect, For } from "solid-js";

/** How far behind the units column each higher place lags, in ms, and the cap. */
const STAGGER = 45;
const STAGGER_MAX = 3;

/**
 * A number whose digits roll when it changes.
 *
 * Arrival times tick down while you are looking at them, and a digit that
 * simply swaps is easy to miss - the roll is what says the number is live
 * rather than a value the screen happened to load with.
 *
 * The roll always travels the same way: the minute on screen is pushed up and
 * out by the one replacing it. That direction is the point. A countdown only
 * ever moves one way, and a roll that changes direction with the digits - down
 * for 2 to 1, up for 8 to 7 - reads as a number being edited rather than time
 * running out.
 *
 * Sized entirely in `em`, so it takes whatever type it is dropped into.
 */
export function RollingNumber(props: { value: number }) {
  const digits = () => String(Math.max(0, Math.trunc(props.value))).split("");

  return (
    <span class="inline-flex">
      {/* The columns animate two copies of themselves, so copying a row used to
          yield the digit twice. The real value is here for text and for
          assistive tech; the columns are decoration. */}
      <span class="sr-only">{props.value}</span>
      <span class="inline-flex select-none" aria-hidden="true">
        {/*
         * `keyed={false}` is the whole reason the roll works. Keyed by value -
         * the default - "12" becoming "11" disposes the column showing 2 and
         * mounts a fresh one already showing 1, and a column that has just been
         * born has no previous digit to push out. Keyed by position the column
         * survives, and the change arrives as a value it can animate between.
         */}
        <For each={digits()} keyed={false}>
          {(digit, index) => <Digit value={Number(digit())} place={digits().length - 1 - index} />}
        </For>
      </span>
    </span>
  );
}

/**
 * The motion tokens, read from the document once.
 *
 * The Web Animations API takes numbers, not `var(--duration-roll)`, and the
 * alternative to reading them is a second copy of the two values that would
 * quietly stop matching the rest of the app's motion.
 */
let motion: { duration: number; easing: string } | undefined;

/**
 * A CSS time as a number of milliseconds.
 *
 * The unit has to be read, not assumed: the build minifies `420ms` down to
 * `.42s`, and taking that for a count of milliseconds finished the roll in
 * under half of one - the animation ran, and nothing ever appeared to move.
 */
function milliseconds(value: string, fallback: number) {
  const time = value.trim();
  const amount = Number.parseFloat(time);
  if (!Number.isFinite(amount)) return fallback;
  return time.endsWith("ms") ? amount : amount * 1000;
}

function rollTiming() {
  if (!motion) {
    const style = getComputedStyle(document.documentElement);
    motion = {
      duration: milliseconds(style.getPropertyValue("--duration-roll"), 480),
      easing: style.getPropertyValue("--ease-out").trim() || "cubic-bezier(0.22, 1, 0.36, 1)",
    };
  }
  return motion;
}

/**
 * One column of the roll: the digit leaving, and the digit arriving under it.
 *
 * Both cells stay in the DOM and swap what they hold, rather than one strip of
 * ten digits sliding to the right offset. A strip has to travel the distance
 * between the two digits, so 10 becoming 9 swept the units column past eight
 * numbers it was never showing - and it travelled whichever way the digits
 * happened to lie. Two cells always move exactly one step, always upward.
 *
 * `place` is how far this digit is from the units column, and it buys a small
 * delay: when 100 becomes 99 the units lead and the tens follow, which is the
 * way a mechanical counter turns and reads as one movement rather than three
 * columns firing at once.
 */
function Digit(props: { value: number; place: number }) {
  let leaving!: HTMLSpanElement;
  let arriving!: HTMLSpanElement;

  createEffect(
    () => props.value,
    (value, previous) => {
      // The first run has nothing to push out; the column is simply born
      // showing its value.
      if (previous === undefined || value === previous) return;

      /*
       * `arriving` gets its text from the JSX below. Solid applies that in a
       * render effect, which has already run by the time this one does, so the
       * cell is showing the new digit before it is asked to animate in.
       */
      leaving.textContent = String(previous);

      // The global reduced-motion rule only reaches CSS animations. This one
      // has to opt out itself.
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

      const { duration, easing } = rollTiming();
      const timing = {
        duration,
        easing,
        delay: Math.min(props.place, STAGGER_MAX) * STAGGER,
        /*
         * `both`, so the pair holds the row still through the stagger delay and
         * then stays where the roll left it - the leaving cell hidden, the
         * arriving one in place - until the next tick.
         */
        fill: "both" as const,
      };

      const playing = [
        leaving.animate(
          [
            { transform: "translateY(0)", opacity: 1 },
            { transform: "translateY(-1em)", opacity: 0 },
          ],
          timing,
        ),
        arriving.animate(
          [
            { transform: "translateY(1em)", opacity: 0 },
            { transform: "translateY(0)", opacity: 1 },
          ],
          timing,
        ),
      ];

      // A minute that ticks again mid-roll cancels the one in flight rather
      // than queueing behind it, which would run the column late for ever.
      return () => playing.forEach((animation) => animation.cancel());
    },
  );

  return (
    <span
      class="relative inline-block"
      style={{
        height: "1em",
        "line-height": "1",
        /*
         * `clip-path` rather than `overflow: hidden`: an inline-block with
         * hidden overflow takes its baseline from its bottom margin edge, which
         * drops the number below the unit beside it. Clipping leaves the
         * baseline where the type says it is.
         */
        "clip-path": "inset(0)",
      }}
    >
      {/* In flow, so it sets both the column's width and its baseline. */}
      <span class="invisible">0</span>

      {/* Idle at nothing: until a first change there is no digit on its way
          out, and after one the animation's fill holds it hidden. */}
      <span
        ref={leaving}
        class="absolute left-0 top-0 opacity-0"
        style={{ "line-height": "1", "will-change": "transform, opacity" }}
      />

      <span
        ref={arriving}
        class="absolute left-0 top-0"
        style={{ "line-height": "1", "will-change": "transform, opacity" }}
      >
        {props.value}
      </span>
    </span>
  );
}
