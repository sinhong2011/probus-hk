import { For, Show, createEffect, createMemo, createSignal } from "solid-js";
import { Card, EmptyState, Hairline, Reveal, ScreenTitle, SectionLabel } from "~/components/Chrome";
import { Section, SplitPage } from "~/components/Layout";
import { ModeSwitch } from "~/components/ModeSwitch";
import {
  ChevronRightIcon,
  CloseIcon,
  PinIcon,
  SwapIcon,
  WalkIcon,
} from "~/components/Icons";
import { RoutePlate } from "~/components/RoutePlate";
import { routeHref } from "~/components/RouteRow";
import { useDb } from "~/data/context";
import { searchStops } from "~/data/db";
import { planJourneys, type Journey } from "~/data/planner";
import type { StopEntry } from "~/data/types";
import { formatDistance, walkMinutes, type LatLng } from "~/lib/geo";
import { pick, stripStopCode, t, type Lang } from "~/lib/i18n";
import { useGeolocation } from "~/stores/geolocation";
import { settings } from "~/stores/settings";

type Endpoint = { kind: "me" } | { kind: "stop"; id: string; stop: StopEntry };

function endpointLabel(end: Endpoint | null, lang: Lang): string | null {
  if (!end) return null;
  return end.kind === "me" ? t("myLocation", lang) : stripStopCode(pick(end.stop.name, lang));
}

function JourneyCard(props: { journey: Journey; lang: Lang }) {
  const j = () => props.journey;

  return (
    <Card>
      <div class="flex items-center justify-between px-3.5 pb-2 pt-3">
        <span
          class={[
            "rounded-full px-2 py-0.5 text-[0.63rem] font-bold",
            {
              "bg-primary-muted text-primary": j().legs.length === 1,
              "bg-secondary text-muted-foreground": j().legs.length > 1,
            },
          ]}
        >
          {j().legs.length === 1 ? t("direct", props.lang) : t("oneChange", props.lang)}
        </span>
        <span class="tnum text-[0.75rem] font-bold text-foreground">
          {t("wholeJourney", props.lang)} {j().totalMinutes} {t("minute", props.lang)}
        </span>
      </div>

      <Hairline />

      <div class="flex items-center gap-1.5 px-3.5 py-2 text-subtle-foreground">
        <WalkIcon size={12} />
        <span class="tnum text-[0.63rem] font-semibold">
          {t("walkLabel", props.lang)} {formatDistance(j().walkStart)} ·{" "}
          {walkMinutes(j().walkStart)} {t("minute", props.lang)}
        </span>
      </div>

      <For each={j().legs}>
        {(leg, index) => (
          <>
            <Show when={index() > 0}>
              <div class="flex items-center gap-1.5 bg-secondary/60 px-3.5 py-2 text-subtle-foreground">
                <SwapIcon size={12} />
                <span class="tnum text-[0.63rem] font-semibold">
                  {[
                    t("changeHere", props.lang),
                    j().walkTransfer > 0
                      ? `${t("walkLabel", props.lang)} ${formatDistance(j().walkTransfer)}`
                      : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </div>
            </Show>

            <a
              href={routeHref(leg.route.key)}
              class="mb-tap flex items-center gap-3 px-3.5 py-2.5"
            >
              <RoutePlate route={leg.route.route} co={leg.route.co} size="sm" />
              <div class="flex min-w-0 grow flex-col gap-0.5">
                <span class="truncate text-[0.8rem] font-bold tracking-[-0.01em] text-foreground">
                  {stripStopCode(pick(leg.boardStop.name, props.lang))} →{" "}
                  {stripStopCode(pick(leg.alightStop.name, props.lang))}
                </span>
                <span class="tnum truncate text-[0.63rem] font-medium text-subtle-foreground">
                  {[
                    `${leg.hops} ${t("stops", props.lang)}`,
                    `${leg.minutes} ${t("minute", props.lang)}`,
                    leg.fare,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </div>
              <span class="text-faint-foreground">
                <ChevronRightIcon size={14} />
              </span>
            </a>
          </>
        )}
      </For>

      <div class="flex items-center gap-1.5 px-3.5 pb-3 pt-1 text-subtle-foreground">
        <WalkIcon size={12} />
        <span class="tnum text-[0.63rem] font-semibold">
          {t("walkLabel", props.lang)} {formatDistance(j().walkEnd)} · {walkMinutes(j().walkEnd)}{" "}
          {t("minute", props.lang)}
        </span>
      </div>
    </Card>
  );
}

export default function Plan() {
  const db = useDb();
  const lang = settings.lang;
  const { position } = useGeolocation();

  const [from, setFrom] = createSignal<Endpoint | null>({ kind: "me" });
  const [to, setTo] = createSignal<Endpoint | null>(null);
  const [picking, setPicking] = createSignal<"from" | "to" | null>("to");
  const [query, setQuery] = createSignal("");

  const matches = createMemo(() => (picking() ? searchStops(db(), query(), 10) : []));

  const coordsOf = (end: Endpoint | null): LatLng | null => {
    if (!end) return null;
    return end.kind === "me" ? position() : end.stop.location;
  };

  const journeys = createMemo<Journey[]>(() => {
    const a = coordsOf(from());
    const b = coordsOf(to());
    if (!a || !b) return [];
    return planJourneys(db(), a, b, { walkRadiusM: settings.radiusM() });
  });

  const choose = (id: string, stop: StopEntry) => {
    const target = picking();
    if (target === "from") setFrom({ kind: "stop", id, stop });
    else setTo({ kind: "stop", id, stop });
    setPicking(null);
    setQuery("");
  };

  const swap = () => {
    const a = from();
    setFrom(to());
    setTo(a);
  };

  /**
   * One endpoint: the place, or the field you type it into.
   *
   * Tapping a row turns that row into the input rather than opening a second
   * search box beneath it - two fields both labelled "destination" is a
   * question about which one the app is listening to.
   */
  const EndpointRow = (props: { which: "from" | "to"; end: Endpoint | null }) => {
    const active = () => picking() === props.which;
    let field!: HTMLInputElement;

    createEffect(
      () => active(),
      (on) => {
        if (on) field.focus();
      },
    );

    return (
      <div
        class={[
          "flex h-12 w-full items-center gap-2 rounded-2xl border-[1.5px] bg-card px-3.5 transition-colors duration-state",
          { "border-primary-border": active(), "border-border": !active() },
        ]}
      >
        <input
          ref={field}
          value={active() ? query() : (endpointLabel(props.end, lang()) ?? "")}
          onInput={(e) => setQuery(e.currentTarget.value)}
          onFocus={() => {
            setPicking(props.which);
            setQuery("");
          }}
          placeholder={t(props.which === "from" ? "chooseOrigin" : "chooseDest", lang())}
          aria-label={t(props.which === "from" ? "fromLabel" : "toLabel", lang())}
          autocomplete="off"
          class={[
            "grow bg-transparent text-[0.85rem] outline-none placeholder:font-medium placeholder:text-subtle-foreground",
            {
              "font-bold text-foreground": props.end !== null && !active(),
              "font-semibold text-foreground": active(),
              "font-medium text-subtle-foreground": props.end === null && !active(),
            },
          ]}
        />

        <Show when={active()}>
          <button
            type="button"
            aria-label="close"
            onClick={() => {
              setPicking(null);
              setQuery("");
            }}
            class="mb-press flex size-6 shrink-0 items-center justify-center rounded-full bg-secondary text-muted-foreground"
          >
            <CloseIcon size={12} />
          </button>
        </Show>

        <Show when={!active() && props.which === "from" && props.end?.kind === "me"}>
          <span class="shrink-0 text-primary">
            <PinIcon size={15} />
          </span>
        </Show>
      </div>
    );
  };

  return (
    <SplitPage
      aside={
        <>
          <ScreenTitle title={t("searchRoutes", lang())} subtitle="Search" />

          <div class="-mt-2.5">
            <ModeSwitch lang={lang()} />
          </div>

          <div class="-mt-2 flex items-stretch gap-2.5">
            {/*
             * The dot, the dotted run and the pin, in the gutter beside the
             * fields: the journey is drawn once here so neither field has to
             * carry a "起點" label to say which end it is.
             */}
            <div class="flex w-3 shrink-0 flex-col items-center py-[1.15rem]" aria-hidden="true">
              <span class="size-2.5 shrink-0 rounded-full border-2 border-subtle-foreground" />
              <span class="my-1 w-0 grow border-l-2 border-dotted border-faint-foreground" />
              <span class="shrink-0 text-primary">
                <PinIcon size={14} />
              </span>
            </div>

            <div class="flex grow flex-col gap-2">
              <EndpointRow which="from" end={from()} />
              <EndpointRow which="to" end={to()} />
            </div>

            {/* Centred between the two ends, because that is what it acts on. */}
            <button
              type="button"
              aria-label={t("swapEnds", lang())}
              onClick={swap}
              class="mb-press flex size-10 shrink-0 self-center items-center justify-center rounded-full bg-secondary text-muted-foreground"
            >
              <SwapIcon size={16} />
            </button>
          </div>

          <Reveal open={picking() !== null}>
            {/* Aligned with the fields, clear of the gutter and the swap. */}
            <div class="pl-[1.375rem] pr-12">
              <Show when={picking() === "from"}>
                <button
                  type="button"
                  onClick={() => {
                    setFrom({ kind: "me" });
                    setPicking(null);
                  }}
                  class="mb-press flex w-full items-center gap-2.5 rounded-2xl border border-border bg-card px-3.5 py-3 text-left"
                >
                  <span class="text-primary">
                    <PinIcon size={15} />
                  </span>
                  <span class="text-[0.82rem] font-bold text-foreground">
                    {t("myLocation", lang())}
                  </span>
                </button>
              </Show>

              <Show when={matches().length > 0}>
                <Card class="mt-2.5">
                  <For each={matches()}>
                    {(match, index) => (
                      <>
                        <Show when={index() > 0}>
                          <Hairline />
                        </Show>
                        <button
                          type="button"
                          onClick={() => choose(match.stopId, match.stop)}
                          class="mb-tap flex w-full items-center gap-3 px-3.5 py-2.5 text-left"
                        >
                          <div class="flex min-w-0 grow flex-col gap-0.5">
                            <span class="truncate text-[0.82rem] font-bold text-foreground">
                              {stripStopCode(pick(match.stop.name, lang()))}
                            </span>
                            <span class="truncate text-[0.63rem] font-medium text-subtle-foreground">
                              {stripStopCode(pick(match.stop.name, lang() === "zh" ? "en" : "zh"))}
                            </span>
                          </div>
                          <span class="tnum shrink-0 text-[0.63rem] font-bold text-subtle-foreground">
                            {match.routeCount} {t("routesCount", lang())}
                          </span>
                        </button>
                      </>
                    )}
                  </For>
                </Card>
              </Show>
            </div>
          </Reveal>
        </>
      }
    >
      <Section class={picking() !== null ? "hidden lg:flex" : ""}>
        <Show
          when={from() && to()}
          fallback={<EmptyState title={t("plan", lang())} hint={t("planHint", lang())} />}
        >
          <Show
            when={journeys().length > 0}
            fallback={
              <EmptyState title={t("noJourneys", lang())} hint={t("noJourneysHint", lang())} />
            }
          >
            <SectionLabel
              trailing={
                <span class="tnum text-[0.63rem] font-semibold text-faint-foreground">
                  {journeys().length}
                </span>
              }
            >
              {`${t("routes", lang())} Journeys`}
            </SectionLabel>

            <div class="flex flex-col gap-2.5">
              <For each={journeys()}>
                {(journey) => <JourneyCard journey={journey} lang={lang()} />}
              </For>
            </div>
          </Show>
        </Show>
      </Section>
    </SplitPage>
  );
}
