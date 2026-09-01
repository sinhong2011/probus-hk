import { For, Show, createMemo, createSignal } from "solid-js";
import { uniqBy } from "es-toolkit";
import { useLinkProps } from "@tanstack/solid-router";
import { Chip, EmptyState, SectionLabel, StopCode } from "~/components/Chrome";
import { RowCard, Section } from "~/components/Layout";
import { CameraSheet } from "~/components/CameraSheet";
import { GroupSheet } from "~/components/GroupSheet";
import {
  ChevronRightIcon,
  ExternalIcon,
  CameraIcon,
  MapIcon,
  StarFillIcon,
  StarIcon,
  WalkIcon,
} from "~/components/Icons";
import { Modal } from "~/components/Modal";
import { RouteLine } from "~/components/RouteRow";
import { SortSheet, SortTrigger, type SortChoice } from "~/components/SortSheet";
import { nearestCamera } from "~/data/cameras";
import { useDb } from "~/data/context";
import { compareRoutes, routesAtCluster } from "~/data/db";
import { useStopEtas } from "~/data/useStopEtas";
import { etaKey } from "~/data/eta/batch";
import { mapLink, type MapProvider } from "~/lib/externalLinks";
import { distanceM, formatDistance, walkMinutes } from "~/lib/geo";
import { pick, stripStopCode, t, type Lang } from "~/lib/i18n";
import { stopLink } from "~/lib/links";
import { createWide } from "~/lib/wide";
import { useGeolocation } from "~/stores/geolocation";
import { isStopStar, starred } from "~/stores/starred";

const MAP_CHOICES: { id: MapProvider; label: "mapGoogle" | "mapApple" | "mapSystem" }[] = [
  { id: "google", label: "mapGoogle" },
  { id: "apple", label: "mapApple" },
  { id: "geo", label: "mapSystem" },
];

/**
 * Everything that calls at one kerb: the name, how far it is, and the lines
 * that stop here.
 *
 * The stop's own page is this, and so is the sheet that opens from a route
 * before leaving it - a rider checking whether 31 also calls here should not
 * have to abandon the 2A they were reading.
 */
export function StopPreview(props: {
  stopId: string;
  lang: Lang;
  /**
   * The sheet already wears the name. The page does not, so the name stays
   * here as the heading.
   */
  embedded?: boolean;
  /**
   * A route in this list is being followed. The sheet that is showing them
   * uses this to put itself away, so the page underneath is the one that
   * opens rather than a sheet still covering it.
   */
  onPickRoute?: () => void;
}) {
  const db = useDb();
  const { position } = useGeolocation();
  const stop = () => db().stopList[props.stopId];

  /** Every operator's id for this kerb, so nothing is missed. */
  const memberIds = createMemo(() => {
    const ids = new Set<string>([props.stopId]);
    for (const [, alias] of db().stopMap[props.stopId] ?? []) ids.add(alias);
    return [...ids];
  });

  const routes = createMemo(() =>
    uniqBy(routesAtCluster(db(), memberIds()), (at) => `${at.route.route}/${at.route.dest.en}`),
  );

  const etas = useStopEtas(() => props.stopId, routes);

  /*
   * Soonest first is the question at a kerb; route number is the index of
   * what calls here. The control names the question; the sheet holds both
   * answers.
   */
  const [sort, setSort] = createSignal<"eta" | "route">("eta");
  const [sortOpen, setSortOpen] = createSignal(false);
  const sorts = (): SortChoice<"eta" | "route">[] => [
    { value: "eta", label: t("sortEta", props.lang), hint: t("sortEtaHint", props.lang) },
    { value: "route", label: t("sortRoute", props.lang), hint: t("sortRouteHint", props.lang) },
  ];

  const ordered = createMemo(() => {
    const map = etas();
    const rows = routes().map((at) => {
      const list = map?.get(etaKey(at.route.key));
      return {
        at,
        etas: map === undefined ? undefined : (list ?? []),
        next: list?.[0]?.at.getTime() ?? Number.POSITIVE_INFINITY,
      };
    });
    return rows.sort((a, b) =>
      sort() === "eta"
        ? a.next - b.next || compareRoutes(a.at.route, b.at.route)
        : compareRoutes(a.at.route, b.at.route),
    );
  });

  const metres = () => {
    const here = position();
    const s = stop();
    return here && s ? distanceM(here, s.location) : null;
  };

  const camera = () => {
    const s = stop();
    return s ? nearestCamera(s.location) : null;
  };
  const [cameraOpen, setCameraOpen] = createSignal(false);
  const [groupOpen, setGroupOpen] = createSignal(false);

  /**
   * Star the stop itself. A star from a route page is a line at this kerb;
   * this is the kerb, every line that calls here. Removing it drops only
   * that stop star, not a route kept from a route page.
   */
  const keptHere = () => {
    const ids = new Set(memberIds());
    return starred.items().filter((item) => isStopStar(item) && ids.has(item.stopId));
  };
  const isStarred = () => keptHere().length > 0;

  const toggleStar = () => {
    const kept = keptHere();
    if (kept.length > 0) {
      for (const item of kept) starred.remove(item.id);
      return;
    }
    requestAnimationFrame(() => setGroupOpen(true));
  };

  return (
    <Show when={stop()}>
      {(entry) => (
        <div class="flex min-h-0 flex-1 flex-col gap-4">
          <div class={["flex shrink-0 flex-col", props.embedded ? "-mt-1 gap-1" : "gap-2"]}>
            <Show when={!props.embedded}>
              <div class="flex flex-wrap items-center gap-2.5">
                <h1 class="text-[1.55rem] font-bold leading-[1.1] tracking-[-0.035em] text-foreground">
                  {stripStopCode(pick(entry().name, props.lang))}
                </h1>
                <StopCode name={entry().name} lang={props.lang} class="text-[0.81rem]" />
              </div>
            </Show>

            <div class="flex flex-wrap items-center gap-2 py-2">
              <button
                type="button"
                onClick={toggleStar}
                aria-pressed={isStarred() ? "true" : "false"}
                class={[
                  "app-press inline-flex h-[1.6rem] w-fit shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full bg-secondary px-2.5 text-[0.75rem] font-bold transition-colors duration-state hover:text-foreground",
                  isStarred() ? "text-primary" : "text-muted-foreground",
                ]}
              >
                <Show when={isStarred()} fallback={<StarIcon size={12} />}>
                  <StarFillIcon size={12} />
                </Show>
                {t(isStarred() ? "starredOn" : "addStar", props.lang)}
              </button>
              <Show when={metres() !== null}>
                <Chip tone="accent">
                  <WalkIcon size={12} />
                  <span class="tnum">
                    {formatDistance(metres() as number)} · {walkMinutes(metres() as number)}{" "}
                    {t("minute", props.lang)}
                  </span>
                </Chip>
              </Show>
              <Show when={camera()}>
                <button
                  type="button"
                  onClick={() => setCameraOpen(true)}
                  class="app-press inline-flex h-[1.6rem] w-fit shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full bg-secondary px-2.5 text-[0.75rem] font-bold text-muted-foreground transition-colors duration-state hover:text-foreground"
                >
                  <CameraIcon size={12} />
                  {t("trafficCamera", props.lang)}
                </button>
              </Show>
              <nav
                aria-label={t("cameraOpenMap", props.lang)}
                class="flex h-[1.6rem] shrink-0 items-stretch overflow-hidden rounded-full border border-border bg-secondary"
              >
                <span class="flex items-center pl-1.5 text-faint-foreground" aria-hidden="true">
                  <MapIcon size={11} />
                </span>
                <For each={MAP_CHOICES}>
                  {(choice, index) => (
                    <a
                      href={mapLink(choice.id, entry().location, props.lang)}
                      target="_blank"
                      rel="noreferrer"
                      class={[
                        "app-press flex items-center px-2 text-[0.75rem] font-bold text-muted-foreground transition-colors duration-state hover:text-foreground",
                        { "border-l border-border": index() > 0 },
                      ]}
                    >
                      {t(choice.label, props.lang)}
                    </a>
                  )}
                </For>
                <span class="flex items-center pr-1.5 text-faint-foreground" aria-hidden="true">
                  <ExternalIcon size={9} />
                </span>
              </nav>
            </div>
          </div>

          <Show when={camera()}>
            {(near) => (
              <CameraSheet
                open={cameraOpen()}
                onClose={() => setCameraOpen(false)}
                near={near()}
                lang={props.lang}
              />
            )}
          </Show>

          <GroupSheet
            open={groupOpen()}
            onClose={() => setGroupOpen(false)}
            groups={starred.groups()}
            current=""
            confirmLabel={t("addStar", props.lang)}
            onChoose={(group) => {
              starred.toggle({
                routeKey: "",
                co: routes()[0]?.co ?? "kmb",
                stopId: props.stopId,
                seq: 0,
                group,
              });
            }}
            lang={props.lang}
          />

          <Section class="flex min-h-0 min-w-0 flex-1 flex-col">
            <SectionLabel
              aside={
                <Chip
                  class="h-5 min-w-5 justify-center px-1.5 text-[0.69rem]"
                  label={`${routes().length} ${t("routesCount", props.lang)}`}
                >
                  <span class="tnum">{routes().length}</span>
                </Chip>
              }
              trailing={
                <SortTrigger label={t("sortBy", props.lang)} onClick={() => setSortOpen(true)} />
              }
            >
              {t("routesHere", props.lang)}
            </SectionLabel>

            <SortSheet
              open={sortOpen()}
              onClose={() => setSortOpen(false)}
              value={sort()}
              options={sorts()}
              onChoose={setSort}
              lang={props.lang}
            />

            <Show
              when={ordered().length > 0}
              fallback={<EmptyState title={t("noService", props.lang)} />}
            >
              <RowCard
                scroll
                single={props.embedded}
                flushRules={props.embedded}
                class="min-h-0 flex-1"
              >
                <For each={ordered()}>
                  {(row) => (
                    <RouteLine
                      route={row.at.route}
                      seq={row.at.seq}
                      lang={props.lang}
                      etas={row.etas}
                      countdownSize="sm"
                      compact={props.embedded}
                      uniformStack={props.embedded}
                      onClick={props.onPickRoute}
                    />
                  )}
                </For>
              </RowCard>
            </Show>
          </Section>
        </div>
      )}
    </Show>
  );
}

/**
 * The stop, as a sheet over the page that asked about it.
 *
 * Opening the stop's own screen used to be the only way to see what else
 * calls here, which threw away the route you were standing in. The sheet is
 * that page, held over this one; the route is still underneath. On a phone it
 * rises from the bottom; on a wide window it is a panel from the right, a
 * column of one route per row beside the page that asked.
 */
export function StopPreviewSheet(props: {
  open: boolean;
  onClose: () => void;
  stopId: string | null;
  lang: Lang;
}) {
  const db = useDb();
  const wide = createWide();
  const stop = () => (props.stopId ? db().stopList[props.stopId] : undefined);
  const title = () => {
    const entry = stop();
    return entry ? stripStopCode(pick(entry.name, props.lang)) : t("openStop", props.lang);
  };

  return (
    <Modal
      open={props.open}
      onClose={props.onClose}
      title={title()}
      lang={props.lang}
      aside={
        <Show when={stop()}>
          {(entry) => <StopCode name={entry().name} lang={props.lang} class="text-[0.75rem]" />}
        </Show>
      }
      side={wide() ? "right" : "bottom"}
      /* The default side panel is a settings column. A route number, a
         destination and an arrival need the same width the stop list uses. */
      class={wide() ? "sm:max-w-xl!" : ""}
      bodyScroll={false}
      bodyClass="flex min-h-0 flex-1 flex-col overflow-hidden px-4 pb-0 pt-0"
      action={
        <Show when={props.stopId}>
          {(id) => (
            <a
              {...useLinkProps(stopLink(id()))}
              class="app-press flex h-8 w-full items-center justify-center gap-1.5 rounded-lg bg-primary text-[0.81rem] font-bold text-primary-foreground"
            >
              {t("openStop", props.lang)}
              <ChevronRightIcon size={14} />
            </a>
          )}
        </Show>
      }
    >
      <Show when={props.stopId}>
        {(id) => (
          <StopPreview stopId={id()} lang={props.lang} embedded onPickRoute={props.onClose} />
        )}
      </Show>
    </Modal>
  );
}
