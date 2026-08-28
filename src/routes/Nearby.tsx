import { For, Show, createMemo } from "solid-js";
import { Card, Chip, EmptyState, LivePill, ScreenTitle, SectionLabel } from "~/components/Chrome";
import { CardColumns, CardColumnItem, Page, Section } from "~/components/Layout";
import { PinIcon } from "~/components/Icons";
import { RouteRow } from "~/components/RouteRow";
import { StopCard } from "~/components/StopCard";
import { useDb } from "~/data/context";
import { nearbyStopClusters, routeAt } from "~/data/db";
import { pick, stripStopCode, t } from "~/lib/i18n";
import { geo, useGeolocation } from "~/stores/geolocation";
import { saved } from "~/stores/saved";
import { RADIUS_CHOICES, settings } from "~/stores/settings";

/** How many stops to render before the list stops being useful. */
const MAX_STOPS = 12;
/** Routes previewed per stop; the stop page shows the rest. */
const PREVIEW_ROUTES = 4;

export default function Nearby() {
  const db = useDb();
  const lang = settings.lang;
  const { position, status } = useGeolocation();

  const stops = createMemo(() => {
    const at = position();
    if (!at) return [];
    return nearbyStopClusters(db(), at, settings.radiusM()).slice(0, MAX_STOPS);
  });

  const nearestName = () => {
    const first = stops()[0];
    return first ? stripStopCode(pick(first.stop.name, lang())) : null;
  };

  const pinned = createMemo(() =>
    saved.items().flatMap((item) => {
      const route = routeAt(db(), item.routeKey);
      if (!route) return [];
      const stop = db().stopList[item.stopId];
      return [{ item, route, stopName: stop ? pick(stop.name, lang()) : "" }];
    }),
  );

  return (
    <Page wide>
      {/* Two rows, not four: where you are belongs beside the title rather than
          on a line of its own above it. */}
      <div class="flex flex-col gap-3.5">
        <ScreenTitle
          title={t("nearby", lang())}
          subtitle="Nearby"
          trailing={
            <div class="flex min-w-0 items-center gap-1.5 pb-1 text-primary">
              <PinIcon size={15} />
              <span class="truncate text-[0.75rem] font-bold tracking-[-0.01em] text-foreground">
                {nearestName() ?? t(status() === "ready" ? "noNearby" : "locating", lang())}
              </span>
            </div>
          }
        />

        <div class="flex items-center gap-2">
          <Show when={status() === "ready"}>
            <LivePill label={t("live", lang())} />
          </Show>
          <For each={RADIUS_CHOICES}>
            {(radius) => (
              <button
                type="button"
                onClick={() => settings.setRadiusM(radius)}
                aria-pressed={settings.radiusM() === radius ? "true" : "false"}
                class={[
                  "flex h-[1.6rem] items-center rounded-full px-2.5 text-[0.63rem] font-bold transition-colors duration-150",
                  {
                    "bg-primary text-primary-foreground": settings.radiusM() === radius,
                    "bg-secondary text-subtle-foreground": settings.radiusM() !== radius,
                  },
                ]}
              >
                <span class="tnum">{radius} m</span>
              </button>
            )}
          </For>
        </div>
      </div>

      <Show when={pinned().length > 0}>
        <Section>
          <SectionLabel>{`${t("pinned", lang())} Pinned`}</SectionLabel>
          <CardColumns>
            <For each={pinned()}>
              {(entry) => (
                <CardColumnItem>
                  <Card>
                    <RouteRow
                      route={entry.route}
                      seq={entry.item.seq}
                      lang={lang()}
                      plateSize="md"
                      countdownSize="md"
                      subtitle={stripStopCode(entry.stopName)}
                    />
                  </Card>
                </CardColumnItem>
              )}
            </For>
          </CardColumns>
        </Section>
      </Show>

      <Section>
        <SectionLabel>{`${t("nearbyStops", lang())} Nearby stops`}</SectionLabel>

        <Show
          when={status() !== "denied" && status() !== "unavailable"}
          fallback={
            <EmptyState
              title={t("locationDenied", lang())}
              hint={t("locationHint", lang())}
              action={
                <button
                  type="button"
                  onClick={() => geo.retry()}
                  class="rounded-lg bg-primary px-4 py-2 text-[0.75rem] font-bold text-primary-foreground"
                >
                  {t("retry", lang())}
                </button>
              }
            />
          }
        >
          <Show
            when={stops().length > 0}
            fallback={
              <div class="py-10 text-center">
                <Chip>{t(status() === "ready" ? "noNearby" : "locating", lang())}</Chip>
              </div>
            }
          >
            <CardColumns>
              <For each={stops()}>
                {(entry, index) => (
                  <CardColumnItem
                    class="motion-safe:mb-rise"
                    style={{ "animation-delay": `${Math.min(index(), 8) * 24}ms` }}
                  >
                    <StopCard
                      stopId={entry.stopId}
                      stop={entry.stop}
                      memberIds={entry.memberIds}
                      metres={entry.metres}
                      lang={lang()}
                      maxRoutes={PREVIEW_ROUTES}
                    />
                  </CardColumnItem>
                )}
              </For>
            </CardColumns>
          </Show>
        </Show>
      </Section>
    </Page>
  );
}
