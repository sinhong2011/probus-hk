import { For, Show, createEffect, createSignal } from "solid-js";
import { Modal } from "./Modal";
import { CheckIcon, PlusIcon, TagIcon } from "./Icons";
import { t, type Lang } from "~/lib/i18n";
import { GROUP_COLORS, groupColor, groupColorVar } from "~/lib/groupColors";
import { settings } from "~/stores/settings";

/**
 * Which group a star belongs to.
 *
 * Groups are free text and made on the spot - 返工, 週末, 阿媽屋企 - because the
 * useful division of a star list is the rider's own and no fixed set of
 * categories would have guessed it. Existing groups are offered first so the
 * second star in a group is a tap rather than a retyping.
 *
 * They are laid out as chips rather than as a column of full-width rows: a
 * group name is two or three characters, and a stack of wide blocks made a
 * list of three short words look like a settings screen. Chips also put the
 * whole set in one glance, which is the question being asked - "which of these
 * is it?" - rather than one option per line.
 *
 * Nothing here decides anything until the button at the bottom is pressed: the
 * sheet is also how a star is made, and a half-answered question should
 * leave the list exactly as it found it.
 */
export function GroupSheet(props: {
  open: boolean;
  onClose: () => void;
  /** Groups already in use, offered before the rider invents another. */
  groups: string[];
  current: string;
  onChoose: (group: string) => void;
  /** What the commit button says; naming the deed makes the sheet the last step of it. */
  confirmLabel?: string;
  lang: Lang;
}) {
  const [draft, setDraft] = createSignal("");
  const [picked, setPicked] = createSignal("");
  /** Groups invented here, which have no star in them yet to be listed by. */
  const [made, setMade] = createSignal<string[]>([]);

  // A sheet that reopened holding the last thing typed into it would be
  // answering the previous star's question.
  createEffect(
    () => props.open,
    (open) => {
      if (!open) return;
      setDraft("");
      setMade([]);
      setPicked(props.current);
    },
  );

  const options = () => {
    const list = props.groups.slice();
    for (const fresh of made()) if (!list.includes(fresh)) list.push(fresh);
    return list;
  };

  /**
   * What pressing the button would file this under, including a name still
   * being typed - which is what makes it safe to show on the button itself.
   */
  const target = () => draft().trim() || picked();

  /** Puts the typed name on the list and selects it; it is still not saved. */
  const invent = () => {
    const name = draft().trim();
    if (!name) return;
    // Kept, not replaced: a rider naming two groups in a row was watching the
    // first one vanish off the list as the second arrived.
    setMade((names) => (names.includes(name) ? names : [...names, name]));
    setPicked(name);
    setDraft("");
  };

  const commit = () => {
    // A name still sitting in the field is an answer too - it would be a poor
    // sheet that threw it away because it was never handed to the list.
    props.onChoose(target());
    props.onClose();
  };

  return (
    <Modal
      open={props.open}
      onClose={props.onClose}
      title={t("groupLabel", props.lang)}
      lang={props.lang}
    >
      <div class="flex flex-col gap-4">
        <div
          role="radiogroup"
          aria-label={t("groupLabel", props.lang)}
          class="flex flex-wrap items-center gap-1.5"
        >
          {/* The default sits first and reads as an absence rather than as a
              group: outlined, not filled, so a real name never has to be told
              apart from "none of them" by its wording alone. */}
          <Chip
            label={t("noGroup", props.lang)}
            selected={picked() === ""}
            ghost
            onSelect={() => setPicked("")}
          />

          <For each={options()}>
            {(group) => (
              <Chip
                label={group}
                color={groupColorVar(groupColor(group))}
                selected={picked() === group}
                /* Only the ones invented here spring in; the rest were already
                   on screen when the sheet opened. */
                fresh={made().includes(group)}
                onSelect={() => setPicked(group)}
              />
            )}
          </For>
        </div>

        {/* The picked group's swatches. Every group is born coloured - its
            name lands on one of the eight - and this is where the rider moves
            it. The change is saved as it is tapped: a colour is dressing, not
            a decision the sheet's commit button should hold hostage. */}
        <Show when={picked()}>
          {(name) => (
            <div class="flex items-center gap-2.5">
              <span class="shrink-0 text-[0.75rem] font-semibold text-subtle-foreground">
                {props.lang === "zh" ? "標籤顏色" : "Tag colour"}
              </span>
              <div
                role="radiogroup"
                aria-label={props.lang === "zh" ? "標籤顏色" : "Tag colour"}
                class="flex items-center gap-1.5"
              >
                <For each={GROUP_COLORS}>
                  {(color) => (
                    <button
                      type="button"
                      role="radio"
                      aria-checked={groupColor(name()) === color ? "true" : "false"}
                      aria-label={color}
                      onClick={() => settings.setGroupColor(name(), color)}
                      class="app-press flex size-6 items-center justify-center rounded-full"
                      style={{ background: groupColorVar(color) }}
                    >
                      <Show when={groupColor(name()) === color}>
                        <span class="text-white">
                          <CheckIcon size={11} />
                        </span>
                      </Show>
                    </button>
                  )}
                </For>
              </div>
            </div>
          )}
        </Show>

        {/* One field, with its own add button inside it, so the pair reads as
            a single instrument rather than as a box next to a button that
            happens to be near it. */}
        <form
          // Filled rather than outlined: the sunken background is what says
          // "type here", the same way every field in the app does. The
          // hairline is the field's edge, not that outline.
          class="flex h-12 items-center gap-2.5 rounded-2xl border border-border bg-raised pl-3.5 pr-1.5"
          onSubmit={(event) => {
            event.preventDefault();
            invent();
          }}
        >
          <span class="shrink-0 text-faint-foreground">
            <TagIcon size={13} />
          </span>
          <input
            value={draft()}
            onInput={(event) => setDraft(event.currentTarget.value)}
            placeholder={t("groupName", props.lang)}
            aria-label={t("newGroup", props.lang)}
            enterkeyhint="done"
            maxlength={16}
            class="h-full min-w-0 grow bg-transparent text-[0.88rem] font-semibold text-foreground outline-none placeholder:font-medium placeholder:text-subtle-foreground"
          />
          <button
            type="submit"
            aria-label={t("newGroup", props.lang)}
            disabled={draft().trim() === ""}
            /* The key takes the accent the moment there is a name to add, so
               the field says what the button is for before it is used - but
               tinted, not filled: the filled button on this sheet is the one
               that saves, and a second one made adding a name look like it. */
            class={[
              "app-press flex size-9 shrink-0 items-center justify-center rounded-xl transition-colors duration-state",
              {
                "bg-secondary text-faint-foreground": draft().trim() === "",
                "bg-primary-muted text-primary": draft().trim() !== "",
              },
            ]}
          >
            <PlusIcon size={14} />
          </button>
        </form>

        {/* The one button that changes anything, and it says what it changes -
            down to the group it will land in, including a name still sitting
            in the field above, which is otherwise a rule the rider cannot
            see. */}
        <button
          type="button"
          onClick={commit}
          class="app-press flex h-10 items-center justify-center gap-1.5 rounded-xl bg-primary px-4 text-[0.88rem] font-bold text-primary-foreground shadow-card"
        >
          <span class="shrink-0">{props.confirmLabel ?? t("saveLabel", props.lang)}</span>
          <Show when={target()}>
            {(name) => (
              <span class="flex min-w-0 items-center gap-1.5 text-primary-foreground/65">
                <span aria-hidden="true">·</span>
                <span class="truncate font-semibold">{name()}</span>
              </span>
            )}
          </Show>
        </button>
      </div>
    </Modal>
  );
}

/** One group to choose from, sized to its name. */
function Chip(props: {
  label: string;
  /** The group's colour: the chip's whole ground is painted with it. */
  color?: string;
  selected: boolean;
  /** The "no group" default, which is an absence and is drawn as one. */
  ghost?: boolean;
  /** Invented in this sheet a moment ago, so it arrives rather than appears. */
  fresh?: boolean;
  onSelect: () => void;
}) {
  /*
   * A group chip answers in its own colour - the whole ground, not a mark on
   * it: a tint while open, the full colour once chosen. Inline, because the
   * chosen-state rule on the role would otherwise repaint it in the neutral.
   */
  const paint = () =>
    props.color
      ? props.selected
        ? { background: props.color, color: "var(--background)" }
        : {
            background: `color-mix(in srgb, ${props.color} 15%, transparent)`,
            color: props.color,
          }
      : undefined;

  return (
    <button
      type="button"
      role="radio"
      aria-checked={props.selected ? "true" : "false"}
      onClick={props.onSelect}
      style={paint()}
      class={[
        "app-press flex h-[1.6rem] max-w-full items-center gap-1.5 rounded-full px-2.5 text-[0.75rem]",
        {
          "font-bold": props.selected,
          // Neutral while colourless - "no group" is an absence being
          // chosen, and the accent belongs to the button that saves. The
          // dashed edge going solid is half of what says it was picked.
          "bg-secondary text-foreground": props.selected && !props.color,
          // The one border that stays: dashed is what says "not made yet",
          // and a ghost with no edge at all is indistinguishable from a gap.
          "border border-dashed border-border bg-transparent font-semibold text-subtle-foreground":
            !props.selected && !!props.ghost,
          "bg-secondary font-semibold text-muted-foreground":
            !props.selected && !props.ghost && !props.color,
          "font-semibold": !props.selected && !!props.color,
          "app-pop": !!props.fresh,
        },
      ]}
    >
      <span class="min-w-0 truncate">{props.label}</span>
      <Show when={props.selected}>
        <span class="app-pop shrink-0">
          <CheckIcon size={11} />
        </span>
      </Show>
    </button>
  );
}
