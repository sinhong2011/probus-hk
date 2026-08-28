import { groupBy } from "es-toolkit";
import { For, Show, createEffect, createMemo, createSignal } from "solid-js";
import { Card, EmptyState, Hairline, ScreenTitle, SectionLabel } from "~/components/Chrome";
import { EtaCountdown } from "~/components/EtaCountdown";
import { BookmarkIcon, GripIcon, MinusIcon, WalkIcon } from "~/components/Icons";
import { RoutePlate } from "~/components/RoutePlate";
import { Page, Section } from "~/components/Layout";
import { routeHref } from "~/components/RouteRow";
import { useDb } from "~/data/context";
import { routeAt } from "~/data/db";
import { isRunningNow } from "~/data/schedule";
import type { Eta, KeyedRoute, StopEntry } from "~/data/types";
import { stopIdsFor, useEta } from "~/data/useEta";
import { countdown } from "~/lib/format";
import { distanceM, walkMinutes } from "~/lib/geo";
import { pick, stripStopCode, t, type Lang } from "~/lib/i18n";
import { frequent } from "~/stores/frequent";
import { useGeolocation } from "~/stores/geolocation";
import { now } from "~/stores/clock";
import { saved, type SavedItem } from "~/stores/saved";
import { settings } from "~/stores/settings";

/** Matches the rendered row height, used to turn a drag offset into an index. */
const ROW_HEIGHT = 78;

interface Resolved {
  item: SavedItem;
  route: KeyedRoute;
  stop: StopEntry | undefined;
  stopName: string;
  running: boolean;
}

/**
 * When to set off, rather than when the bus arrives.
 *
 * A bookmark is somewhere you go regularly, so the useful number is not "the
 * bus is 8 minutes away" but "you have 5 minutes before you need to walk". That
 * needs the walk to the stop, which is why it only appears once location is
 * available.
 *
 * Being told only that the next bus is out of reach is a dead end, so the
 * search runs down the arrival list to the first one still catchable and gives
 * the leaving time for that.
 */
function leaveAdvice(etas: Eta[], metres: number | null, at: number) {
  if (metres === null || etas.length === 0) return null;

  const walk = walkMinutes(metres);
  const upcoming = etas.map((eta) => countdown(eta, at)).filter((state) => state.kind !== "gone");

  for (const [index, state] of upcoming.entries()) {
    // A minute of slack: nobody misses a bus by thirty seconds of rounding.
    const leaveIn = (state.kind === "arriving" ? 0 : state.minutes) - walk;
    if (leaveIn >= -1) {
      return { leaveIn: Math.max(0, leaveIn), walk, urgent: leaveIn <= 2, nth: index };
    }
  }
  return upcoming.length > 0 ? { leaveIn: null, walk, urgent: false, nth: -1 } : null;
}

function BookmarkCard(props: {
  entry: Resolved;
  lang: Lang;
  metres: number | null;
  editing: boolean;
  dragging: boolean;
  onRemove: () => void;
  onDrag: (event: PointerEvent) => void;
  onArrivals: () => void;
}) {
  const etas = useEta(() => ({
    route: props.entry.route,
    seq: props.entry.item.seq,
    stopIdByCo: stopIdsFor(props.entry.route, props.entry.item.seq),
  }));

  const advice = () => leaveAdvice(etas() ?? [], props.metres, now());

  /*
   * The timetable says the route has finished, yet the operator is still
   * reporting a bus: trust the bus. The card tells the screen, which moves it
   * back out of the dormant section.
   */
  createEffect(
    () => (etas()?.length ?? 0) > 0,
    (live) => {
      if (live) props.onArrivals();
    },
  );

  const dim = () => !props.entry.running && etas()?.length === 0;

  return (
    <div
      class={[
        "mb-press overflow-hidden rounded-xl border bg-card shadow-card transition-shadow duration-state motion-safe:mb-rise",
        {
          "border-primary shadow-lg": props.dragging,
          "border-border": !props.dragging,
          "opacity-60": dim(),
        },
      ]}
      style={props.dragging ? { transform: "scale(1.02) rotate(-0.6deg)" } : undefined}
    >
      <div class="flex items-center gap-3 px-3.5 py-3">
        <Show when={props.editing}>
          <button
            type="button"
            aria-label="reorder"
            class="cursor-grab touch-none text-faint-foreground"
            onPointerDown={props.onDrag}
          >
            <GripIcon size={17} />
          </button>
        </Show>

        <RoutePlate
          route={props.entry.route.route}
          co={props.entry.route.co}
          size="md"
          muted={dim()}
        />

        <a href={routeHref(props.entry.route.key)} class="flex min-w-0 grow flex-col gap-0.5">
          <span class="truncate text-[0.85rem] font-bold tracking-[-0.01em] text-foreground">
            {t("towards", props.lang)} {pick(props.entry.route.dest, props.lang)}
          </span>
          <span class="truncate text-[0.63rem] font-medium text-subtle-foreground">
            {[
              props.entry.stopName,
              props.metres !== null
                ? `${t("walkMinutes", props.lang)} ${walkMinutes(props.metres)} ${t("minute", props.lang)}`
                : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </span>
        </a>

        <Show
          when={!props.editing}
          fallback={
            <button
              type="button"
              aria-label="remove"
              onClick={props.onRemove}
              class="flex size-7 items-center justify-center rounded-full text-destructive"
              style={{ background: "color-mix(in srgb, var(--destructive) 14%, transparent)" }}
            >
              <MinusIcon size={13} />
            </button>
          }
        >
          <EtaCountdown etas={etas()} lang={props.lang} size="md" limit={2} />
        </Show>
      </div>

      {/* The one line that turns arrival times into a decision. */}
      <Show when={!props.editing && advice()}>
        {(a) => (
          <div
            class={[
              "flex items-center gap-1.5 border-t px-3.5 py-2",
              {
                "border-primary-border bg-primary-muted": a().urgent,
                "border-border": !a().urgent,
              },
            ]}
          >
            <span class={a().urgent ? "text-primary" : "text-subtle-foreground"}>
              <WalkIcon size={12} />
            </span>
            {/* Which bus this is about, when it is not the next one. */}
            <Show when={a().nth !== 0}>
              <span class="text-[0.68rem] font-semibold text-faint-foreground">
                {a().nth < 0 ? t("tooLate", props.lang) : t("takeNext", props.lang)}
              </span>
            </Show>

            <Show when={a().leaveIn !== null}>
              <span
                class={[
                  "tnum text-[0.68rem] font-bold",
                  { "text-primary": a().urgent, "text-subtle-foreground": !a().urgent },
                ]}
              >
                <Show when={a().leaveIn! > 0} fallback={t("leaveNow", props.lang)}>
                  {a().leaveIn} {t("leaveIn", props.lang)}
                </Show>
              </span>
            </Show>
          </div>
        )}
      </Show>
    </div>
  );
}

export default function Saved() {
  const db = useDb();
  const lang = settings.lang;
  const { position } = useGeolocation();
  const [editing, setEditing] = createSignal(false);
  const [dragId, setDragId] = createSignal<string | null>(null);

  const resolved = createMemo<Resolved[]>(() =>
    saved.items().flatMap((item) => {
      const route = routeAt(db(), item.routeKey);
      if (!route) return [];
      const stop = db().stopList[item.stopId];
      return [
        {
          item,
          route,
          stop,
          stopName: stop ? stripStopCode(pick(stop.name, lang())) : "",
          running: isRunningNow(db(), route),
        },
      ];
    }),
  );

  const metresTo = (entry: Resolved) => {
    const here = position();
    return here && entry.stop ? distanceM(here, entry.stop.location) : null;
  };

  /*
   * Bookmarks whose route has finished for the night are moved out of the way
   * rather than deleted - they are still yours, they are just not useful at
   * two in the morning.
   *
   * A card that turns out to have live arrivals reports back and stays put for
   * the rest of the session; the latch never clears, so a card can never
   * oscillate between the two sections as its feed refreshes.
   */
  const [live, setLive] = createSignal<Record<string, true>>({}, { ownedWrite: true });
  const noteArrivals = (id: string) =>
    setLive((prev) => (prev[id] ? prev : { ...prev, [id]: true }));

  const isResting = (r: Resolved) => !r.running && !live()[r.item.id];
  const active = createMemo(() => resolved().filter((r) => !isResting(r)));
  const resting = createMemo(() => resolved().filter(isResting));

  const groups = createMemo(() => {
    const buckets = groupBy(active(), (r) => r.item.group);
    return Object.entries(buckets).sort(([a], [b]) => (a === "" ? 1 : b === "" ? -1 : 0));
  });

  /** Routes opened often enough to be worth offering as a bookmark. */
  const suggestions = createMemo(() =>
    frequent.top(3).flatMap((key) => {
      const route = routeAt(db(), key);
      return route && !saved.items().some((i) => i.routeKey === key) ? [route] : [];
    }),
  );

  const startDrag = (event: PointerEvent, id: string, index: number) => {
    event.preventDefault();
    const handle = event.currentTarget as HTMLElement;
    handle.setPointerCapture(event.pointerId);
    setDragId(id);

    const startY = event.clientY;
    const flat = resolved();
    const baseIndex = flat.findIndex((r) => r.item.id === id);

    const onMove = (move: PointerEvent) => {
      const delta = Math.round((move.clientY - startY) / ROW_HEIGHT);
      const next = Math.max(0, Math.min(flat.length - 1, baseIndex + delta));
      if (next !== index) saved.reorder(id, next);
    };
    const onUp = () => {
      setDragId(null);
      handle.releasePointerCapture(event.pointerId);
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
    };
    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
  };

  return (
    <Page>
      <ScreenTitle
        title={t("saved", lang())}
        subtitle="Bookmarks"
        trailing={
          <Show when={resolved().length > 0}>
            <button
              type="button"
              onClick={() => setEditing((e) => !e)}
              class={[
                "flex h-[2.1rem] items-center rounded-full px-4 text-[0.75rem] font-bold transition-colors duration-150",
                {
                  "bg-primary text-primary-foreground": editing(),
                  "bg-secondary text-muted-foreground": !editing(),
                },
              ]}
            >
              {t(editing() ? "done" : "edit", lang())}
            </button>
          </Show>
        }
      />

      <Show
        when={resolved().length > 0}
        fallback={
          <div class="flex flex-col gap-6">
            <EmptyState title={t("emptySaved", lang())} hint={t("emptySavedHint", lang())} />

            {/* Rather than an empty screen, offer the routes already being
                checked most often - one tap to keep them here. */}
            <Show when={suggestions().length > 0}>
              <Section>
                <SectionLabel>{t("bookmarkThese", lang())}</SectionLabel>
                <Card>
                  <For each={suggestions()}>
                    {(route, index) => (
                      <>
                        <Show when={index() > 0}>
                          <Hairline />
                        </Show>
                        <div class="flex items-center gap-3 px-3.5 py-2.5">
                          <RoutePlate route={route.route} co={route.co} size="sm" />
                          <span class="min-w-0 grow truncate text-[0.82rem] font-bold text-foreground">
                            {t("towards", lang())} {pick(route.dest, lang())}
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              const co = route.co[0] ?? "kmb";
                              const stopId = route.stops[co]?.[0];
                              if (stopId) {
                                saved.toggle({ routeKey: route.key, co, stopId, seq: 1 });
                              }
                            }}
                            class="flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-primary px-3 text-[0.68rem] font-bold text-primary-foreground"
                          >
                            <BookmarkIcon size={13} />
                            {t("addBookmark", lang())}
                          </button>
                        </div>
                      </>
                    )}
                  </For>
                </Card>
              </Section>
            </Show>
          </div>
        }
      >
        <div class="flex flex-col gap-6">
          <Show when={editing()}>
            <p class="-mb-3 text-[0.63rem] font-medium text-subtle-foreground">
              {lang() === "zh" ? "拖曳排序 · 撳減號移除" : "Drag to reorder, tap minus to remove"}
            </p>
          </Show>

          <Show when={!editing() && position() === null}>
            <p class="-mb-3 text-[0.63rem] font-medium text-subtle-foreground">
              {t("noLocation", lang())}
            </p>
          </Show>

          <For each={groups()}>
            {([group, entries]) => (
              <Section>
                <Show when={group !== ""}>
                  <div class="flex items-center gap-2">
                    <span class="text-[0.63rem] font-bold uppercase tracking-[0.16em] text-subtle-foreground">
                      {group}
                    </span>
                    <div class="h-px grow bg-border" />
                  </div>
                </Show>

                <div class="flex flex-col gap-2.5">
                  <For each={entries}>
                    {(entry, index) => (
                      <BookmarkCard
                        entry={entry}
                        lang={lang()}
                        metres={metresTo(entry)}
                        editing={editing()}
                        dragging={dragId() === entry.item.id}
                        onRemove={() => saved.remove(entry.item.id)}
                        onDrag={(e) => startDrag(e, entry.item.id, index())}
                        onArrivals={() => noteArrivals(entry.item.id)}
                      />
                    )}
                  </For>
                </div>
              </Section>
            )}
          </For>

          <Show when={resting().length > 0}>
            <Section>
              <SectionLabel>{t("notRunning", lang())}</SectionLabel>
              <div class="flex flex-col gap-2.5">
                <For each={resting()}>
                  {(entry, index) => (
                    <BookmarkCard
                      entry={entry}
                      lang={lang()}
                      metres={metresTo(entry)}
                      editing={editing()}
                      dragging={dragId() === entry.item.id}
                      onRemove={() => saved.remove(entry.item.id)}
                      onDrag={(e) => startDrag(e, entry.item.id, index())}
                      onArrivals={() => noteArrivals(entry.item.id)}
                    />
                  )}
                </For>
              </div>
            </Section>
          </Show>
        </div>
      </Show>
    </Page>
  );
}
