import { For, Show, createEffect } from "solid-js";
import { Modal } from "./Modal";
import { StopCode } from "./Chrome";
import { CheckIcon } from "./Icons";
import { useDb } from "~/data/context";
import type { Company, KeyedRoute } from "~/data/types";
import { pick, stripStopCode, t, type Lang } from "~/lib/i18n";

/**
 * Which stop on a route a bookmark should watch.
 *
 * A bookmark is a route at a stop, and the stop is the half that goes stale: a
 * route offered from the "you keep opening these" list is saved at its first
 * stop, and a rider who moves house or changes job is still watching the old
 * kerb. Until now the only way to move it was to delete it and walk the route
 * page for the new stop, which also threw away its group and its place in the
 * list.
 *
 * Every stop, numbered as the route page numbers them, with the current one
 * marked and scrolled into view. One tap decides: unlike the group sheet this
 * is not also how a bookmark is made, so there is nothing to confirm - and a
 * wrong tap is a second tap away from being put right.
 */
export function StopSheet(props: {
  open: boolean;
  onClose: () => void;
  route: KeyedRoute;
  co: Company;
  /** The stop the bookmark watches now. */
  stopId: string;
  onChoose: (choice: { co: Company; stopId: string; seq: number }) => void;
  lang: Lang;
}) {
  const db = useDb();
  let current: HTMLButtonElement | undefined;

  const stops = () =>
    (props.route.stops[props.co] ?? []).map((id, index) => ({
      id,
      seq: index + 1,
      name: db().stopList[id]?.name,
    }));

  // The list is as long as the route; the stop being changed is the one place
  // on it the rider is looking for.
  createEffect(
    () => props.open,
    (open) => {
      if (open) current?.scrollIntoView({ block: "center" });
    },
  );

  return (
    <Modal
      open={props.open}
      onClose={props.onClose}
      title={t("changeStop", props.lang)}
      lang={props.lang}
    >
      <div role="radiogroup" aria-label={t("changeStop", props.lang)} class="-mx-1 flex flex-col">
        <For each={stops()}>
          {(entry) => {
            const picked = () => entry.id === props.stopId;
            return (
              <button
                type="button"
                role="radio"
                aria-checked={picked() ? "true" : "false"}
                ref={(el) => {
                  if (picked()) current = el;
                }}
                onClick={() => {
                  props.onChoose({ co: props.co, stopId: entry.id, seq: entry.seq });
                  props.onClose();
                }}
                class={[
                  "mb-press flex min-h-11 items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition-colors duration-state",
                  { "bg-primary-muted": picked() },
                ]}
              >
                <span
                  class={[
                    "tnum w-6 shrink-0 text-[0.81rem] font-semibold",
                    picked() ? "text-primary" : "text-faint-foreground",
                  ]}
                >
                  {entry.seq}.
                </span>
                <span
                  class={[
                    "min-w-0 grow truncate text-[0.88rem]",
                    picked() ? "font-bold text-primary" : "font-semibold text-foreground",
                  ]}
                >
                  {stripStopCode(pick(entry.name, props.lang))}
                </span>
                <StopCode name={entry.name} lang={props.lang} />
                <Show when={picked()}>
                  <span class="shrink-0 text-primary">
                    <CheckIcon size={12} />
                  </span>
                </Show>
              </button>
            );
          }}
        </For>
      </div>
    </Modal>
  );
}
