import { For, Show, createMemo } from "solid-js";
import type { Eta } from "~/data/types";
import { RollingNumber } from "./RollingNumber";
import { EtaSkeleton } from "./Skeleton";
import { clockTime, countdown, isLastRun, type Countdown } from "~/lib/format";
import { pick, t, type Lang } from "~/lib/i18n";
import { now } from "~/stores/clock";
import { settings } from "~/stores/settings";

export type CountdownSize = "sm" | "md" | "lg";

const LEAD: Record<CountdownSize, string> = {
  sm: "1.35rem",
  md: "1.65rem",
  lg: "1.95rem",
};

/**
 * One size down, for a timetable estimate in the hero position. A live number
 * and a guess were set at the same size, and down a list the eye reads the
 * size before it reads the tilde; the guess is now literally the smaller
 * claim.
 */
const LEAD_SCHEDULED: Record<CountdownSize, string> = {
  sm: "1.13rem",
  md: LEAD.sm,
  lg: LEAD.md,
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
 * imminent one becomes words beside a pulsing dot, a timetable estimate is
 * smaller and named as one - the word under a lone number, a tilde on the ones
 * stacked - and no service is words only. A rule under the number read as an
 * underline rather than as a meaning, and cost a row of height to say it.
 */
export function EtaCountdown(props: {
  /** `undefined` while the answer is still in flight. */
  etas: Eta[] | undefined;
  lang: Lang;
  size?: CountdownSize;
  /** Cap on how many arrivals to stack. */
  limit?: number;
  /**
   * Print the wall-clock time the next one lands at, before the countdown.
   *
   * Off by default: down a list of forty stops the countdown is the whole
   * answer, and a clock under every row is forty numbers nobody read. It earns
   * its line where a rider has stopped at one stop and opened it - that is
   * someone deciding, and a decision is made against a watch, a meeting, a
   * train. It is also the number to send someone: "15:28" survives being
   * screenshotted and read a minute later, where "7 分鐘" does not.
   */
  clock?: boolean;
  /**
   * Minutes only: the clock, the timetable word and the operator's remark
   * have already been said somewhere else. Used when the open row has
   * moved those onto the left and this node is only the wait, dropping
   * onto that line.
   */
  waitOnly?: boolean;
  /**
   * How many of the leading arrivals the rider cannot reach in time.
   *
   * A countdown is only an answer if the bus is still catchable. A bookmark
   * twenty minutes' walk away lists buses that will have gone before anyone
   * could reach the kerb, and the screen that knows the walk is the one that
   * has to say so - this component only knows what the operator reported.
   *
   * Pass `Infinity` for "none of these can be caught".
   */
  unreachable?: number;
  /**
   * Print the operator's own notice - a disruption, a diversion - beside the
   * numbers. Off where the screen carries it somewhere better: the route page
   * shows it beside the stop's name, and printing it twice on one row is the
   * same sentence said twice, once too small to read.
   */
  notices?: boolean;
  /**
   * The day's last one has already gone past here.
   *
   * "暫無班次" and "尾班車已過" are not the same sentence. The first says the
   * feed has nothing to report, which a rider reads as "wait and one will
   * come"; the second says there is nothing more tonight and the answer is a
   * taxi or a walk. Only the screen holding the timetable can tell the two
   * apart, so it says which this is.
   */
  over?: boolean;
  /** Milliseconds before the digits roll; see `RollingNumber`. */
  stagger?: number;
  /**
   * One size down the whole stack. The hero minute size made the first wait
   * a different kind of row from the two under it; in a sheet of many
   * routes the colour is enough to say which one matters.
   */
  uniform?: boolean;
  class?: string;
}) {
  const size = () => props.size ?? "md";
  /*
   * The o'clock time is asked for twice: by the caller, which knows whether
   * this row has room for it, and by the rider, who says once in settings
   * whether they want that form at all - see `settings.clockTimes`. Both have
   * to say yes, and reading them in one place is what keeps the spoken label
   * and the printed row from disagreeing.
   */
  const clock = () => props.clock === true && settings.clockTimes();

  /** How many of the leading arrivals are out of reach. */
  const missed = () => Math.max(0, props.unreachable ?? 0);

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
  const upcoming = createMemo<{ state: Countdown; at: Date }[]>(() => {
    const at = now();
    const live = (props.etas ?? [])
      .map((eta) => ({ state: countdown(eta, at), at: eta.at }))
      .filter((entry) => entry.state.kind !== "gone");

    /*
     * The cap counts the arrivals still worth reading, so the ones out of
     * reach are added on top of it: cut at the limit alone and the one arrival
     * the card is about disappears the moment the two in front of it are out
     * of reach. The ceiling keeps a long walk from growing the card without
     * end.
     */
    return live.slice(0, Math.min(5, missed() + (props.limit ?? 3)));
  });

  /**
   * The arrival the card is really about.
   *
   * Not always the first one. Making the soonest arrival the hero puts the
   * biggest, brightest number on the screen in front of an answer that is
   * wrong whenever that bus cannot be caught - the eye reads the numeral, not
   * the line of small type underneath saying to forget it. The hero is the
   * first arrival still within reach; the ones before it stay on the card,
   * struck through, because "the one-minute bus is gone" is worth reading too.
   *
   * When none of them can be caught there is nothing better to promote, so the
   * top one keeps the position and wears the strike with the rest.
   */
  const heroIndex = createMemo(() => (missed() < upcoming().length ? missed() : 0));

  /** The clock time of the arrival the countdown at the top is counting to. */
  const leadAt = () => upcoming()[heroIndex()]?.at ?? null;

  /**
   * Only keep the 預定班次 column when a guess is actually on the stack.
   * Holding it empty on a live-only row left a word-width hole between the
   * destination and the minutes.
   */
  const booked = () =>
    !props.waitOnly && upcoming().some((entry) => entry.state.scheduled);

  return (
    <Show when={props.etas !== undefined} fallback={<EtaSkeleton size={size()} class={props.class} />}>
      <Show
        when={upcoming().length > 0}
        fallback={
          <span
            class={[
              "block text-right text-[0.81rem] font-semibold whitespace-nowrap text-faint-foreground",
              props.class ?? "",
            ]}
            data-eta-state={props.over ? "over" : "none"}
          >
            {t(props.over ? "lastBusGone" : "noService", props.lang)}
          </span>
        }
      >
        <div
          class={[
            "grid shrink-0 items-center justify-items-end gap-x-[3px] gap-y-1.5",
            booked()
              ? "grid-cols-[auto_minmax(2.5rem,auto)_auto] lg:grid-cols-[auto_auto_minmax(2.5rem,auto)_auto]"
              : "grid-cols-[auto_minmax(2.5rem,auto)_auto]",
            props.class ?? "",
          ]}
          aria-label={[
            clock() && leadAt() ? clockTime(leadAt() as Date) : "",
            upcoming()
              .map((entry, index) => label(entry.state, props.lang, index < missed()))
              .join(", "),
          ]
            .filter(Boolean)
            .join(" ")}
          data-eta-state={
            upcoming()[heroIndex()]?.state.scheduled
              ? "scheduled"
              : upcoming()[heroIndex()]?.state.kind
          }
          data-eta-missed={missed() > 0 ? String(Math.min(missed(), upcoming().length)) : undefined}
        >
          {/*
           * `keyed={false}`. Every tick rebuilds the countdown objects, so the
           * default value-keyed list threw the whole stack away and rebuilt it
           * once a second - which silently disabled the digit roll inside it,
           * because a freshly mounted digit starts at its final position. Keyed
           * by position the row survives the tick and the number can animate.
           *
           * Four columns, not a right-aligned stack: "預定班次" used to sit
           * in the same run as the minutes, so a live 3 and a scheduled 13
           * did not share a digit column and the eye had to hunt. The word
           * keeps a column even when it is not said, or lighting it would
           * shove the number sideways.
           *
           * The minutes keep a floor so "13 分鐘" never clips. On a phone
           * the word itself is dropped - the weaker, smaller numeral already
           * says this is a timetable guess, and the four characters were
           * taking the destination's room.
           */}
          <For each={upcoming()} keyed={false}>
            {(entry, index) => {
              const state = () => entry().state;
              /** The arrival this stack is an answer about; see `heroIndex`. */
              const hero = () => index === heroIndex();
              /** Reported, but already out of reach by the time you got there. */
              const gone = () => index < missed();

              return (
                <Show
                  when={!(hero() && !gone() && state().kind === "arriving")}
                  fallback={
                    <div class="col-span-full flex max-w-full items-center justify-end gap-[5px] overflow-hidden">
                      <Show when={!props.waitOnly}>
                        <EtaRemark state={state()} lang={props.lang} notices={props.notices} />
                      </Show>
                      <span
                        class="size-[7px] rounded-full bg-warning motion-safe:animate-[app-pulse_1.6s_ease-in-out_infinite]"
                        style={{
                          "box-shadow":
                            "0 0 0 3px color-mix(in srgb, var(--warning) 16%, transparent)",
                        }}
                      />
                      {/* A word, not a numeral: kept under the minute size so
                          即將抵達 does not shout over the stack. */}
                      <span
                        class="truncate font-bold leading-none tracking-tight text-warning motion-safe:transition-[font-size] motion-safe:duration-reveal"
                        style={{
                          "font-size": props.waitOnly ? "0.75rem" : "0.88rem",
                        }}
                      >
                        {t("arriving", props.lang)}
                      </span>
                    </div>
                  }
                >
                  <div class="contents">
                  {/* What the operator said about this one - and the thing it
                      says most often that matters is that it is the last. */}
                  <span class="flex items-center justify-end gap-[3px]">
                    <Show when={!props.waitOnly}>
                      <EtaRemark state={state()} lang={props.lang} notices={props.notices} />
                      {/* Clock first: "12:33" is the thing a watch already
                          knows, and the minutes after it are how long until
                          then. After the wait it read as a footnote. */}
                      <Show when={hero() && !gone() && clock() && leadAt()}>
                        <span class="tnum text-[0.75rem] font-semibold text-faint-foreground">
                          {clockTime(leadAt() as Date)}
                        </span>
                      </Show>
                    </Show>
                  </span>
                  <Show when={booked()}>
                    {/* One cell, no nested span: an empty wrapper still
                        threw a line-box at the parent's leading, so a stack
                        with one timetable guess was taller than three live
                        times. Empty when live; the column width comes from
                        the row that actually says the word. */}
                    <span
                      class={[
                        "hidden min-w-0 items-center justify-end overflow-hidden whitespace-nowrap text-[0.69rem] font-semibold leading-none text-faint-foreground lg:flex",
                        { "pr-1.5": state().scheduled },
                      ]}
                    >
                      {state().scheduled ? t("scheduled", props.lang) : ""}
                    </span>
                  </Show>
                  <span
                    class={[
                      "flex items-center justify-end tnum font-bold tracking-[-0.05em] leading-none motion-safe:transition-[font-size,color] motion-safe:duration-reveal",
                        {
                          /*
                           * Struck rather than merely dimmed: shape survives a
                           * sunlit screen and a rider who cannot tell the two
                           * greys apart, and colour alone was carrying it.
                           *
                           * The rule is a hairline, and weaker than the digits
                           * it crosses. At full weight it fused with tabular
                           * "11" and the pair read as a plus-minus sign.
                           */
                          "text-faint-foreground line-through decoration-1 decoration-faint-foreground/60":
                            gone(),
                          /*
                           * The arrival the decision turns on, in the app's
                           * own colour: down a card of grey type the eye
                           * lands on it first, which is the point of putting
                           * it at the top. A timetable estimate takes the
                           * same colour weaker - it is the same claim, made
                           * with less behind it.
                           *
                           * Once this number has dropped into the list it
                           * wears the list's size and ink, or the first wait
                           * is a different kind of row from the two under it.
                           */
                          "text-primary": hero() && !gone() && !state().scheduled && !props.waitOnly,
                          "text-primary/70":
                            hero() && !gone() && (state().scheduled || props.waitOnly),
                          "text-subtle-foreground": !hero() && !gone(),
                        },
                      ]}
                      style={{
                        "font-size": props.waitOnly
                          ? "1.13rem"
                          : props.uniform
                            ? gone()
                              ? "0.88rem"
                              : "1rem"
                            : hero()
                              ? (state().scheduled ? LEAD_SCHEDULED : LEAD)[size()]
                              : gone()
                                ? "0.88rem"
                                : "1rem",
                      }}
                    >
                      {/* The word sits before the minutes now, so a tilde
                          would say the same thing twice. */}
                      {/* A bus already out of reach is not counting down to
                          anything, so it is printed rather than rolled - and a
                          rolling column clips its own box, which would cut the
                          strike where it crosses the digits. */}
                      <Show
                        when={!gone()}
                        fallback={state().kind === "arriving" ? 0 : state().minutes}
                      >
                        <RollingNumber
                          value={state().kind === "arriving" ? 0 : state().minutes}
                          delay={props.stagger}
                        />
                      </Show>
                    </span>
                    <span
                      class={[
                        "flex items-center justify-end font-semibold leading-none motion-safe:transition-[font-size,color] motion-safe:duration-reveal",
                        {
                          "text-faint-foreground line-through decoration-1 decoration-faint-foreground/60":
                            gone(),
                          "text-muted-foreground": hero() && !gone() && !props.waitOnly,
                          "text-subtle-foreground": props.waitOnly && !gone(),
                          "text-faint-foreground": !hero() && !gone() && !props.waitOnly,
                        },
                      ]}
                      style={{
                        "font-size":
                          props.waitOnly || !hero() || props.uniform ? "0.75rem" : "0.81rem",
                      }}
                    >
                      {t("minute", props.lang)}
                    </span>
                  </div>
                </Show>
              );
            }}
          </For>

          {/*
           * Where to stand. Clock and "預定班次" live on the minutes now;
           * only the platform still needs a line of its own.
           */}
          <Show when={rail()}>
            {(info) => (
              <span class="col-span-full -mt-px flex items-center justify-end gap-1 rounded-full bg-secondary px-1.5 py-px text-[0.69rem] font-bold text-muted-foreground">
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
        </div>
      </Show>
    </Show>
  );
}

/**
 * The operator's own word on a departure, beside its countdown.
 *
 * A badge rather than a line of loose text: at the end of the service day every
 * row on a route carries one, and a column of bare words beside a column of
 * numerals reads as noise rather than as a mark on each number. The app says
 * "尾班" in its own two characters instead of repeating whichever phrase the
 * operator used, so the badge stays the same width down the whole list.
 */
export function EtaRemark(props: { state: Countdown; lang: Lang; notices?: boolean }) {
  /*
   * A screen that has already said the operator's notice somewhere it can be
   * read in full - beside the stop's name, where it opens - passes
   * `notices={false}`, and only the last-run mark stays here.
   */
  const shown = () => {
    const remark = props.state.remark;
    if (!remark) return undefined;
    return isLastRun(remark) || props.notices !== false ? remark : undefined;
  };

  return (
    <Show when={shown()}>
      {(remark) => (
        <span
          class={[
            "shrink-0 self-center truncate rounded-full px-1.5 py-px text-[0.69rem] font-bold leading-[1.4]",
            {
              "bg-warning/12 text-warning": isLastRun(remark()),
              "max-w-[6rem] bg-secondary text-subtle-foreground": !isLastRun(remark()),
            },
          ]}
        >
          {isLastRun(remark()) ? t("lastBus", props.lang) : pick(remark(), props.lang)}
        </span>
      )}
    </Show>
  );
}

function label(state: Countdown, lang: Lang, missed = false): string {
  const note = state.remark ? ` ${pick(state.remark, lang)}` : "";
  // Said in words, because the strike through the numeral is only a shape.
  const reach = missed ? `${t("tooLate", lang)} ` : "";
  if (state.kind === "arriving") return `${reach}${t("arriving", lang)}${note}`;
  const minutes = `${state.minutes} ${t("minute", lang)}`;
  return `${reach}${state.scheduled ? `${minutes} ${t("scheduled", lang)}` : minutes}${note}`;
}
