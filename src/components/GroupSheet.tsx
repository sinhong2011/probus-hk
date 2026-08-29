import { For, Show, createEffect, createSignal } from "solid-js";
import { Modal } from "./Modal";
import { CheckIcon, PlusIcon, TagIcon } from "./Icons";
import { t, type Lang } from "~/lib/i18n";

/**
 * Which group a bookmark belongs to.
 *
 * Groups are free text and made on the spot - 返工, 週末, 阿媽屋企 - because the
 * useful division of a bookmark list is the rider's own and no fixed set of
 * categories would have guessed it. Existing groups are offered first so the
 * second bookmark in a group is a tap rather than a retyping.
 *
 * They are laid out as chips rather than as a column of full-width rows: a
 * group name is two or three characters, and a stack of wide blocks made a
 * list of three short words look like a settings screen. Chips also put the
 * whole set in one glance, which is the question being asked - "which of these
 * is it?" - rather than one option per line.
 *
 * Nothing here decides anything until the button at the bottom is pressed: the
 * sheet is also how a bookmark is made, and a half-answered question should
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
  /** Groups invented here, which have no bookmark in them yet to be listed by. */
  const [made, setMade] = createSignal<string[]>([]);

  // A sheet that reopened holding the last thing typed into it would be
  // answering the previous bookmark's question.
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
                selected={picked() === group}
                /* Only the ones invented here spring in; the rest were already
                   on screen when the sheet opened. */
                fresh={made().includes(group)}
                onSelect={() => setPicked(group)}
              />
            )}
          </For>
        </div>

        {/* One field, with its own add button inside it, so the pair reads as
            a single instrument rather than as a box next to a button that
            happens to be near it. */}
        <form
          class={[
            "flex h-12 items-center gap-2.5 rounded-2xl border-[1.5px] bg-background pl-3.5 pr-1.5 transition-colors duration-state focus-within:border-primary-border",
            { "border-primary-border": draft() !== "", "border-border": draft() === "" },
          ]}
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
              "mb-press flex size-9 shrink-0 items-center justify-center rounded-xl border transition-colors duration-state",
              {
                "border-border bg-card text-faint-foreground": draft().trim() === "",
                "border-primary-border bg-primary-muted text-primary": draft().trim() !== "",
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
          class="mb-press flex h-12 items-center justify-center gap-1.5 rounded-xl bg-primary px-4 text-[0.88rem] font-bold text-primary-foreground shadow-card"
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
  selected: boolean;
  /** The "no group" default, which is an absence and is drawn as one. */
  ghost?: boolean;
  /** Invented in this sheet a moment ago, so it arrives rather than appears. */
  fresh?: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={props.selected ? "true" : "false"}
      onClick={props.onSelect}
      class={[
        "mb-press flex h-8 max-w-full items-center gap-1.5 rounded-full border px-3 text-[0.81rem] transition-colors duration-state",
        {
          // Tinted rather than filled: the one solid block of accent on the
          // sheet is the button that saves, and a filled chip beside it was
          // competing for the same glance while deciding nothing.
          "border-primary-border bg-primary-muted font-bold text-primary": props.selected,
          "border-dashed border-border bg-transparent font-semibold text-subtle-foreground":
            !props.selected && !!props.ghost,
          "border-transparent bg-secondary font-semibold text-muted-foreground":
            !props.selected && !props.ghost,
          "mb-pop": !!props.fresh,
        },
      ]}
    >
      <span class="min-w-0 truncate">{props.label}</span>
      <Show when={props.selected}>
        <span class="mb-pop shrink-0">
          <CheckIcon size={11} />
        </span>
      </Show>
    </button>
  );
}
