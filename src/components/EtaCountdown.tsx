import { For, Show, createMemo } from "solid-js";
import type { Eta } from "~/data/types";
import { RollingNumber } from "./RollingNumber";
import { EtaSkeleton } from "./Skeleton";
import { countdown, type Countdown } from "~/lib/format";
import { t, type Lang } from "~/lib/i18n";
import { now } from "~/stores/clock";

export type CountdownSize = "sm" | "md" | "lg";

const LEAD: Record<CountdownSize, string> = {
  sm: "1.5rem",
  md: "1.85rem",
  lg: "2.15rem",
};

/**
 * Every arrival the operator reports, stacked - the next one as the hero and
 * the ones after it beneath, each carrying its own unit.
 *
 * Stacking rather than running them together ("16 · 37") is what the transit
 * apps Hong Kong riders already use do, and it reads far faster: knowing the
 * bus after next is what tells you whether to run for this one.
 *
 * Four states must be distinguishable at a glance, and colour alone is not
 * enough, so each also differs in shape: a live arrival is a bare numeral, an
 * imminent one becomes words beside a pulsing dot, a timetable estimate wears a
 * tilde, and no service is words only. A rule under the number read as an
 * underline rather than as a meaning, and cost a row of height to say it.
 */
export function EtaCountdown(props: {
  /** `undefined` while the answer is still in flight. */
  etas: Eta[] | undefined;
  lang: Lang;
  size?: CountdownSize;
  /** Cap on how many arrivals to stack. */
  limit?: number;
}) {
  const size = () => props.size ?? "md";

  /** Platform and train length, from the next arrival that reports them. */
  const rail = createMemo(() => {
    const next = props.etas?.find((eta) => eta.platform);
    return next?.platform ? { platform: next.platform, cars: next.cars } : null;
  });

  /*
   * A feed can keep reporting a bus for a while after it has gone. Showing a
   * negative countdown is worse than showing nothing, so departed arrivals are
   * dropped here rather than trusted from any one adapter.
   */
  const upcoming = createMemo<Countdown[]>(() => {
    const at = now();
    return (props.etas ?? [])
      .map((eta) => countdown(eta, at))
      .filter((state) => state.kind !== "gone")
      .slice(0, props.limit ?? 3);
  });

  return (
    <Show when={props.etas !== undefined} fallback={<EtaSkeleton size={size()} />}>
    <Show
      when={upcoming().length > 0}
      fallback={
        <span class="text-[0.72rem] font-semibold text-faint-foreground" data-eta-state="none">
          {t("noService", props.lang)}
        </span>
      }
    >
      <div
        class="flex shrink-0 flex-col items-end gap-[3px]"
        aria-label={upcoming()
          .map((s) => label(s, props.lang))
          .join(", ")}
        data-eta-state={upcoming()[0]?.scheduled ? "scheduled" : upcoming()[0]?.kind}
      >
        <For each={upcoming()}>
          {(state, index) => (
            <Show
              when={!(index() === 0 && state.kind === "arriving")}
              fallback={
                <div class="flex items-center gap-[5px]">
                  <span
                    class="size-[7px] rounded-full bg-warning motion-safe:animate-[mb-pulse_1.6s_ease-in-out_infinite]"
                    style={{
                      "box-shadow": "0 0 0 3px color-mix(in srgb, var(--warning) 16%, transparent)",
                    }}
                  />
                  <span class="text-[0.95rem] font-bold tracking-tight text-warning">
                    {t("arriving", props.lang)}
                  </span>
                </div>
              }
            >
              <div class="flex items-baseline gap-[3px]">
                <span
                  class={[
                    "tnum font-bold tracking-[-0.05em] leading-none",
                    {
                      // The next arrival is the one the decision turns on.
                      "text-foreground": index() === 0 && !state.scheduled,
                      "text-muted-foreground": index() === 0 && state.scheduled,
                      "text-subtle-foreground": index() > 0,
                    },
                  ]}
                  style={{ "font-size": index() === 0 ? LEAD[size()] : "0.95rem" }}
                >
                  <Show when={state.scheduled}>
                    <span class="opacity-60">~</span>
                  </Show>
                  <RollingNumber value={state.kind === "arriving" ? 0 : state.minutes} />
                </span>
                <span
                  class={[
                    "font-semibold",
                    { "text-muted-foreground": index() === 0, "text-faint-foreground": index() > 0 },
                  ]}
                  style={{ "font-size": index() === 0 ? "0.66rem" : "0.6rem" }}
                >
                  {t("minute", props.lang)}
                </span>
              </div>
            </Show>
          )}
        </For>

        {/* In a list every row would repeat this; the dashed underline already
            marks a timetable estimate, so the words are only worth the space
            where several arrivals are stacked. */}
        {/*
         * Where to stand. A rail arrival is not answered by a number of minutes
         * alone - the platform is the rest of the answer, and it was being
         * thrown away by the adapter that already parsed it.
         */}
        <Show when={rail()}>
          {(info) => (
            <span class="flex items-center gap-1 rounded-full bg-secondary px-1.5 py-px text-[0.58rem] font-bold text-muted-foreground">
              <span class="tnum">
                {t("platform", props.lang)} {info().platform}
              </span>
              <Show when={info().cars}>
                {(cars) => (
                  <span class="tnum text-faint-foreground">
                    · {cars()} {t("cars", props.lang)}
                  </span>
                )}
              </Show>
            </span>
          )}
        </Show>

        <Show when={upcoming().length > 1 && upcoming().some((s) => s.scheduled)}>
          <span class="text-[0.58rem] font-semibold text-faint-foreground">
            {t("scheduled", props.lang)}
          </span>
        </Show>
      </div>
    </Show>
    </Show>
  );
}

function label(state: Countdown, lang: Lang): string {
  if (state.kind === "arriving") return t("arriving", lang);
  const minutes = `${state.minutes} ${t("minute", lang)}`;
  return state.scheduled ? `${minutes} ${t("scheduled", lang)}` : minutes;
}
