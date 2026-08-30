import { For } from "solid-js";
import { AlarmIcon, CloseIcon } from "./Icons";
import { toast } from "~/stores/toast";
import { t, type Lang } from "~/lib/i18n";

/**
 * The banner an alert arrives in while the app is the thing on screen.
 *
 * It sits at the top rather than over the tab bar: a reminder is not a
 * confirmation of something the rider just did, it is an interruption, and the
 * top of the screen is where interruptions belong. It is also the one place a
 * notification can land on iOS Safari, which grants the system channel to
 * installed apps only.
 */
export function Toaster(props: { lang: Lang }) {
  return (
    <div
      class="pt-safe-top pointer-events-none fixed inset-x-0 top-0 z-50 flex flex-col items-center gap-2 px-4"
      aria-live="assertive"
    >
      <For each={toast.items()}>
        {(item) => (
          <div
            class={[
              "pointer-events-auto flex w-full max-w-[26rem] items-center gap-3 rounded-2xl border px-3.5 py-3 shadow-card motion-safe:mb-rise",
              {
                "border-primary-border bg-primary-muted": item.tone === "alert",
                "border-border bg-card": item.tone !== "alert",
              },
            ]}
          >
            <span
              class={[
                "flex size-8 shrink-0 items-center justify-center rounded-full",
                {
                  "bg-primary text-primary-foreground": item.tone === "alert",
                  "bg-secondary text-muted-foreground": item.tone !== "alert",
                },
              ]}
            >
              <AlarmIcon size={15} />
            </span>

            <div class="flex min-w-0 grow flex-col gap-0.5">
              <span class="truncate text-[0.88rem] font-bold tracking-[-0.01em] text-foreground">
                {item.title}
              </span>
              <span class="truncate text-[0.81rem] font-semibold text-muted-foreground">
                {item.body}
              </span>
            </div>

            <button
              type="button"
              aria-label={t("close", props.lang)}
              onClick={() => toast.dismiss(item.id)}
              class="mb-press flex size-7 shrink-0 items-center justify-center rounded-full bg-secondary text-muted-foreground"
            >
              <CloseIcon size={12} />
            </button>
          </div>
        )}
      </For>
    </div>
  );
}
