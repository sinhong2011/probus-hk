import { useLinkProps, useNavigate, useSearch } from "@tanstack/solid-router";
import { For, Show, createEffect, createMemo, createSignal } from "solid-js";
import { Card, Chip, Hairline, Reveal, SectionLabel } from "./Chrome";
import { ChevronRightIcon, CloseIcon, PinIcon, SearchIcon, SwapIcon, WalkIcon } from "./Icons";
import { Modal } from "./Modal";
import { RoutePlate } from "./RoutePlate";
import { useDb } from "~/data/context";
import { lineName } from "~/data/rail";
import { planRail, type RailJourney, type RailLeg } from "~/data/railPlanner";
import { lineOf, railStations, servicesAt } from "~/data/railTimes";
import type { KeyedRoute, RouteDb } from "~/data/types";
import { pick, t, type Lang } from "~/lib/i18n";
import { plateStyle } from "~/lib/operators";

/**
 * Station to station across the railway: pick both ends, read the ways
 * between them. What the MTR's own planner does, done here from the time
 * table in `~/data/railTimes` and drawn the way a rider reads it - the lines
 * in their colours, a change as a break in the line, a walk as a gap.
 */

/** The colour a line is known by. */
const colourOf = (line: string) => plateStyle(["mtr"], line).background;

/** A station's name, or its code where the database has not heard of it. */
function stationName(db: RouteDb, code: string, lang: Lang): string {
  const stop = db.stopList[code];
  return stop ? pick(stop.name, lang) : code;
}

/**
 * The database's own entry for this leg - the direction of the line whose
 * station order runs the way the train does - so a leg can open the route
 * page with its arrivals, its map and its fares.
 */
function routeFor(db: RouteDb, leg: RailLeg): KeyedRoute | undefined {
  for (const key in db.routeList) {
    const entry = db.routeList[key];
    if (!entry || entry.co[0] !== "mtr" || entry.route !== leg.line) continue;
    const stops = entry.stops.mtr ?? [];
    const a = stops.indexOf(leg.from);
    const b = stops.indexOf(leg.to);
    if (a >= 0 && b > a) return { ...entry, key };
  }
  return undefined;
}

function changesLabel(journey: RailJourney, lang: Lang): string {
  const n = journey.legs.length - 1;
  return n === 0 ? t("direct", lang) : n === 1 ? t("oneChange", lang) : t("twoChanges", lang);
}

/**
 * The journey as a line: every leg a bar in its line's colour between two
 * station dots, a change where two dots meet, and a walk as a dashed gap
 * with a walker on it. Widths follow the minutes, so a long ride looks long.
 */
function JourneyLine(props: { journey: RailJourney }) {
  return (
    <div class="flex items-center" aria-hidden="true">
      <For each={props.journey.legs}>
        {(leg, index) => {
          const change = () => props.journey.changes[index() - 1];
          return (
            <>
              <Show when={change()}>
                {(c) => (
                  <Show when={c().at !== c().to} fallback={<span class="w-1" />}>
                    <span class="mx-1 flex items-center gap-0.5 text-faint-foreground">
                      <span class="h-0 w-3 border-t-2 border-dashed border-border" />
                      <WalkIcon size={11} />
                      <span class="h-0 w-3 border-t-2 border-dashed border-border" />
                    </span>
                  </Show>
                )}
              </Show>
              <span
                class="size-3 shrink-0 rounded-full border-2 bg-card"
                style={{ "border-color": colourOf(leg.line) }}
              />
              <span
                class="h-[3px] min-w-6 rounded-full"
                style={{ background: colourOf(leg.line), flex: `${leg.minutes} 0 0` }}
              />
              <span
                class="size-3 shrink-0 rounded-full border-2 bg-card"
                style={{ "border-color": colourOf(leg.line) }}
              />
            </>
          );
        }}
      </For>
    </div>
  );
}

function JourneyCard(props: { journey: RailJourney; lang: Lang; suggested: boolean }) {
  const db = useDb();
  const [open, setOpen] = createSignal(props.suggested);
  const j = () => props.journey;
  const name = (code: string) => stationName(db(), code, props.lang);

  return (
    <Card>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open() ? "true" : "false"}
        class="mb-tap flex w-full flex-col gap-2.5 px-3.5 py-3 text-left"
        data-rail-journey
      >
        <div class="flex w-full items-center justify-between gap-3">
          <span class="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-[0.81rem] font-bold text-foreground">
            <span>{changesLabel(j(), props.lang)}</span>
            <Show when={j().changeMinutes > 0}>
              <span class="tnum font-semibold text-subtle-foreground">
                · {t("changeWalk", props.lang)} {j().changeMinutes} {t("minute", props.lang)}
              </span>
            </Show>
          </span>
          <span class="flex shrink-0 items-baseline gap-1">
            <span class="text-[0.81rem] font-semibold text-subtle-foreground">~</span>
            <span
              class={[
                "tnum text-[1.25rem] font-bold leading-none tracking-[-0.03em]",
                props.suggested ? "text-primary" : "text-foreground",
              ]}
            >
              {j().totalMinutes}
            </span>
            <span class="text-[0.75rem] font-semibold text-subtle-foreground">
              {t("minute", props.lang)}
            </span>
            <span
              class={[
                "ml-1 self-center text-faint-foreground transition-transform duration-state",
                open() ? "-rotate-90" : "rotate-90",
              ]}
            >
              <ChevronRightIcon size={13} />
            </span>
          </span>
        </div>
        <JourneyLine journey={j()} />
      </button>

      <Reveal open={open()}>
        <Hairline />
        <For each={j().legs}>
          {(leg, index) => {
            const change = () => j().changes[index() - 1];
            const route = () => routeFor(db(), leg);
            return (
              <>
                <Show when={change()}>
                  {(c) => (
                    <div class="flex items-center gap-1.5 bg-secondary/60 px-3.5 py-1.5 text-[0.75rem] font-semibold text-subtle-foreground">
                      <WalkIcon size={12} />
                      <span class="tnum">
                        {c().at === c().to
                          ? `${t("interchange", props.lang)} · ${name(c().at)}`
                          : `${t("walkTo", props.lang)} ${name(c().to)}`}
                        {" · "}
                        {c().minutes} {t("minute", props.lang)}
                      </span>
                    </div>
                  )}
                </Show>
                <a
                  {...useLinkProps({
                    to: "/route/$key",
                    // Read lazily: the leg resolves to a bus route or it does
                    // not, and until it does there is nowhere for this to go.
                    get params() {
                      return { key: (route() as KeyedRoute | undefined)?.key ?? "" };
                    },
                    get disabled() {
                      return !route();
                    },
                  })}
                  class="mb-tap flex items-center gap-3 px-3.5 py-2.5"
                >
                  <RoutePlate route={leg.line} co={["mtr"]} size="sm" />
                  <div class="flex min-w-0 grow flex-col gap-0.5">
                    <span class="truncate text-[0.88rem] font-bold tracking-[-0.01em] text-foreground">
                      {pick(lineName(leg.line), props.lang)}
                      <span class="ml-1.5 font-semibold text-subtle-foreground">
                        {t("towards", props.lang)} {name(leg.towards)}
                      </span>
                    </span>
                    <span class="tnum truncate text-[0.75rem] font-medium text-subtle-foreground">
                      {name(leg.from)} → {name(leg.to)} · {leg.stations} {t("stops", props.lang)} ·{" "}
                      {leg.minutes} {t("minute", props.lang)}
                    </span>
                  </div>
                  <Show when={route()}>
                    <span class="text-faint-foreground">
                      <ChevronRightIcon size={14} />
                    </span>
                  </Show>
                </a>
              </>
            );
          }}
        </For>
      </Reveal>
    </Card>
  );
}

/** One end of the journey: the station, or the invitation to pick one. */
function EndRow(props: {
  label: string;
  code: string | null;
  lang: Lang;
  tone: "from" | "to";
  onPick: () => void;
}) {
  const db = useDb();
  return (
    <button
      type="button"
      onClick={props.onPick}
      class="mb-press flex h-12 w-full items-center gap-2.5 rounded-2xl border-[1.5px] border-border bg-card px-3.5 text-left transition-colors duration-state"
      data-rail-end={props.tone}
    >
      <span class={props.tone === "from" ? "text-primary" : "text-destructive"}>
        <PinIcon size={17} />
      </span>
      <span class="shrink-0 text-[0.81rem] font-semibold text-subtle-foreground">
        {props.label}
      </span>
      <span
        class={[
          "min-w-0 grow truncate text-[0.94rem] font-bold",
          props.code ? "text-foreground" : "text-faint-foreground",
        ]}
      >
        {props.code ? stationName(db(), props.code, props.lang) : t("chooseStation", props.lang)}
      </span>
    </button>
  );
}

export function RailPlanner(props: { lang: Lang }) {
  const db = useDb();
  const search = useSearch({ from: "/rail" });
  const navigate = useNavigate();
  /*
   * Which end is being picked lives in the URL beside the ends themselves:
   * the picker covers the whole of a phone's screen, so the back button has
   * to be its way out, and a reload should not lose it. Opening pushes,
   * closing replaces, so leaving the planner is still one step.
   */
  const picking = (): "from" | "to" | null => search().pick ?? null;
  const setPicking = (which: "from" | "to" | null) =>
    navigate({
      to: "/rail",
      search: (prev) => ({ ...prev, pick: which ?? undefined }),
      replace: which === null,
    });
  /* The dialog keeps its last title while it slides away, or "to" would flash
     to "from" the moment a choice closed it. */
  const [shownEnd, setShownEnd] = createSignal<"from" | "to">("from");
  createEffect(
    () => picking(),
    (which) => {
      if (which) setShownEnd(which);
    },
  );
  const [query, setQuery] = createSignal("");

  /** Only stations the database knows, so every one on the list has a name. */
  const stations = createMemo(() =>
    railStations()
      .filter((code) => db().stopList[code])
      .sort((a, b) =>
        stationName(db(), a, props.lang).localeCompare(stationName(db(), b, props.lang), "zh-HK"),
      ),
  );

  const known = (code: string | undefined | null) =>
    code && railStations().includes(code) ? code : null;
  const from = () => known(search().from);
  const to = () => known(search().to);

  /*
   * Replacing rather than pushing: picking the other end of the same journey
   * is one decision being made, not a screen to come back to. Left on push,
   * a rider who chose two stations had to press back twice to leave.
   */
  const set = (which: "from" | "to", code: string | null) =>
    navigate({
      to: "/rail",
      // A choice closes the picker in the same step, not a second one.
      search: (prev) => ({ ...prev, [which]: code ?? undefined, pick: undefined }),
      replace: true,
    });

  const matches = createMemo(() => {
    const q = query().trim().toLowerCase();
    return stations().filter((code) => {
      if (!q) return true;
      const stop = db().stopList[code];
      return (
        code.toLowerCase().startsWith(q) ||
        stop?.name.zh.toLowerCase().includes(q) ||
        stop?.name.en.toLowerCase().includes(q)
      );
    });
  });

  const journeys = createMemo(() => {
    const a = from();
    const b = to();
    return a && b ? planRail(a, b) : [];
  });

  const choose = (code: string) => {
    const which = picking();
    if (!which) return;
    set(which, code);
    setQuery("");
  };

  const swap = () => {
    navigate({
      to: "/rail",
      search: { from: to() ?? undefined, to: from() ?? undefined },
      replace: true,
    });
  };

  return (
    <div class="flex flex-col gap-4" data-rail-planner>
      <div class="flex flex-col gap-2">
        <SectionLabel>{t("railJourney", props.lang)}</SectionLabel>
        <div class="flex items-stretch gap-2">
          <div class="flex min-w-0 grow flex-col gap-2">
            <EndRow
              label={t("fromStation", props.lang)}
              code={from()}
              lang={props.lang}
              tone="from"
              onPick={() => setPicking("from")}
            />
            <EndRow
              label={t("toStation", props.lang)}
              code={to()}
              lang={props.lang}
              tone="to"
              onPick={() => setPicking("to")}
            />
          </div>
          <button
            type="button"
            onClick={swap}
            aria-label={t("swapEnds", props.lang)}
            title={t("swapEnds", props.lang)}
            disabled={!from() && !to()}
            data-rail-swap
            class="mb-press flex w-11 shrink-0 items-center justify-center rounded-2xl border-[1.5px] border-border bg-card text-muted-foreground disabled:text-faint-foreground/50"
          >
            <SwapIcon size={17} />
          </button>
        </div>
      </div>

      <Show
        when={from() && to()}
        fallback={
          <span class="px-1 text-[0.81rem] font-medium text-subtle-foreground">
            {t("railJourneyHint", props.lang)}
          </span>
        }
      >
        <Show
          when={journeys().length > 0}
          fallback={
            <span class="px-1 text-[0.81rem] font-medium text-subtle-foreground">
              {t("noJourneys", props.lang)}
            </span>
          }
        >
          <div class="flex flex-col gap-2">
            <SectionLabel>{t("suggestedRoute", props.lang)}</SectionLabel>
            <JourneyCard journey={journeys()[0] as RailJourney} lang={props.lang} suggested />
          </div>
          <Show when={journeys().length > 1}>
            <div class="flex flex-col gap-2">
              <SectionLabel>{t("otherRoutes", props.lang)}</SectionLabel>
              <For each={journeys().slice(1)}>
                {(journey) => <JourneyCard journey={journey} lang={props.lang} suggested={false} />}
              </For>
            </div>
          </Show>
        </Show>
      </Show>

      <Modal
        open={picking() !== null}
        onClose={() => setPicking(null)}
        title={shownEnd() === "from" ? t("fromStation", props.lang) : t("toStation", props.lang)}
        lang={props.lang}
      >
        <div class="flex flex-col gap-3">
          <div class="flex h-11 items-center gap-2.5 rounded-2xl border-[1.5px] border-border bg-card px-3.5">
            <span class="text-primary">
              <SearchIcon size={17} />
            </span>
            <input
              ref={(el) => requestAnimationFrame(() => el.focus())}
              value={query()}
              onInput={(e) => setQuery(e.currentTarget.value)}
              placeholder={t("chooseStation", props.lang)}
              aria-label={t("chooseStation", props.lang)}
              autocomplete="off"
              class="min-w-0 grow bg-transparent text-[0.94rem] font-semibold text-foreground outline-none placeholder:text-subtle-foreground"
            />
            <Show when={query()}>
              <button
                type="button"
                aria-label="clear"
                onClick={() => setQuery("")}
                class="flex size-6 shrink-0 items-center justify-center rounded-full bg-secondary text-muted-foreground"
              >
                <CloseIcon size={12} />
              </button>
            </Show>
          </div>
          <Card>
            <For each={matches()}>
              {(code, index) => (
                <>
                  <Show when={index() > 0}>
                    <Hairline />
                  </Show>
                  <button
                    type="button"
                    onClick={() => choose(code)}
                    class="mb-tap flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left"
                    data-rail-station={code}
                  >
                    {/* The lines the station is on, as the colours a rider
                        knows them by - which is also how an interchange
                        shows itself: more than one dot. */}
                    <span class="flex shrink-0 items-center gap-0.5">
                      <For each={[...new Set(servicesAt(code).map(lineOf))]}>
                        {(line) => (
                          <span
                            class="size-2.5 rounded-full"
                            style={{ background: colourOf(line) }}
                          />
                        )}
                      </For>
                    </span>
                    <span class="min-w-0 grow truncate text-[0.88rem] font-bold text-foreground">
                      {stationName(db(), code, props.lang)}
                    </span>
                    <Chip class="shrink-0">
                      <span class="tnum">{code}</span>
                    </Chip>
                  </button>
                </>
              )}
            </For>
          </Card>
        </div>
      </Modal>
    </div>
  );
}
