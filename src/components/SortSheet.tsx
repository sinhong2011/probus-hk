import { For } from "solid-js";
import { Modal } from "./Modal";
import { CheckIcon, SortIcon } from "./Icons";
import { t, type Lang } from "~/lib/i18n";

export interface SortChoice<T extends string> {
  value: T;
  label: string;
  /** What the label does not manage to say on its own. */
  hint: string;
}

/**
 * How a list is ordered, asked once and then put away.
 *
 * Order is a setting, not a control: a rider picks one and lives with it for
 * months. A permanently visible segmented bar charged the top of every visit
 * for a decision made once - and above a filter row of the same pills, in the
 * same colours, at the same height, it read as a second row of filters rather
 * than as a different kind of thing entirely.
 *
 * So it lives in the header as one button that names the question, and the
 * options only appear when asked for. Which buys the room to say what each
 * one means: "最近" beside a list of arrival times is genuinely ambiguous -
 * nearest stop, or most recently used - and a segment two characters wide
 * had nowhere to say which.
 *
 * The trigger does not wear the current choice. "最快到站" and "路線號" are
 * different widths, and painting whichever is on onto a pill grew or shrank
 * it - a heading that wrapped around that change redrew the list under it.
 */

/** Opens the sort sheet. Always the same words, so it never resizes. */
export function SortTrigger(props: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-haspopup="dialog"
      aria-label={props.label}
      onClick={props.onClick}
      class="app-press flex h-[1.6rem] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full bg-secondary px-2.5 text-[0.75rem] font-bold leading-none text-subtle-foreground"
    >
      <SortIcon size={12} />
      {props.label}
    </button>
  );
}

export function SortSheet<T extends string>(props: {
  open: boolean;
  onClose: () => void;
  value: T;
  options: SortChoice<T>[];
  onChoose: (value: T) => void;
  lang: Lang;
}) {
  return (
    <Modal
      open={props.open}
      onClose={props.onClose}
      title={t("sortBy", props.lang)}
      lang={props.lang}
    >
      <div role="radiogroup" aria-label={t("sortBy", props.lang)} class="flex flex-col gap-1">
        <For each={props.options}>
          {(option) => {
            const on = () => props.value === option.value;
            return (
              <button
                type="button"
                role="radio"
                aria-checked={on() ? "true" : "false"}
                onClick={() => {
                  props.onChoose(option.value);
                  props.onClose();
                }}
                class={[
                  // Full rows, and a thumb-sized one: this is a sheet the hand
                  // reaches into, not a strip of segments read at a glance.
                  // No `transition-colors`: the radio role already carries the
                  // state transition, and a utility one would override it.
                  "app-press flex min-h-[3.1rem] items-center gap-3 rounded-xl px-3.5 py-2.5 text-left",
                  { "bg-secondary": on(), "bg-transparent": !on() },
                ]}
              >
                <span class="flex min-w-0 grow flex-col gap-0.5">
                  <span
                    class={[
                      "truncate text-[0.88rem] text-foreground",
                      { "font-bold": on(), "font-semibold": !on() },
                    ]}
                  >
                    {option.label}
                  </span>
                  <span class="truncate text-[0.75rem] font-medium text-subtle-foreground">
                    {option.hint}
                  </span>
                </span>

                {/* The tick, not a colour: which one is on has to survive being
                    read at a glance in sunlight. */}
                <span class={["shrink-0 text-foreground", { invisible: !on() }]}>
                  <CheckIcon size={15} />
                </span>
              </button>
            );
          }}
        </For>
      </div>
    </Modal>
  );
}
