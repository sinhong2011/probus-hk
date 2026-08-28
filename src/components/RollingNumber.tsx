import { For } from "solid-js";

const DIGITS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

/**
 * A number whose digits roll when it changes.
 *
 * Arrival times tick down while you are looking at them, and a digit that
 * simply swaps is easy to miss - the roll is what says the number is live
 * rather than a value the screen happened to load with.
 *
 * Sized entirely in `em`, so it takes whatever type it is dropped into.
 */
export function RollingNumber(props: { value: number }) {
  const digits = () => String(Math.max(0, Math.trunc(props.value))).split("");

  return (
    // The surrounding countdown already carries the spoken value; ten stacked
    // digits per column would be nonsense to read out.
    <span class="inline-flex" aria-hidden="true">
      <For each={digits()}>{(digit) => <Digit value={Number(digit)} />}</For>
    </span>
  );
}

function Digit(props: { value: number }) {
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

      <span
        class="absolute left-0 top-0 flex flex-col transition-transform duration-state ease-[var(--ease-spring)]"
        style={{ transform: `translateY(${-props.value}em)` }}
      >
        <For each={DIGITS}>
          {(digit) => (
            <span style={{ height: "1em", "line-height": "1" }}>{digit}</span>
          )}
        </For>
      </span>
    </span>
  );
}
