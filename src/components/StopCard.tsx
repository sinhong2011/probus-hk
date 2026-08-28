import { For, Show, createMemo } from "solid-js";
import { routesAtCluster, type RouteAtStop } from "~/data/db";
import { useDb } from "~/data/context";
import { etaKey, fetchStopEtas } from "~/data/eta/batch";
import type { StopEntry } from "~/data/types";
import { createAsyncMemo } from "~/lib/async";
import { formatDistance } from "~/lib/geo";
import { pick, stripStopCode, type Lang } from "~/lib/i18n";
import { etaTick } from "~/stores/clock";
import { Card, Chip, Hairline } from "./Chrome";
import { RouteLine } from "./RouteRow";

/**
 * A stop and the routes calling there. All of its arrivals are fetched in one
 * batch so a busy junction costs a couple of requests rather than one per row.
 */
export function StopCard(props: {
  stopId: string;
  stop: StopEntry;
  lang: Lang;
  metres?: number;
  /** Every operator's id for this kerb; defaults to the stop's own. */
  memberIds?: string[];
  /** Nearby shows a preview; the stop page shows everything. */
  maxRoutes?: number;
}) {
  const db = useDb();

  /**
   * One route number can appear several times at a stop as different service
   * types. They are the same bus to a passenger, so only the first is kept.
   */
  const routes = createMemo<RouteAtStop[]>(() => {
    const seen = new Set<string>();
    const out: RouteAtStop[] = [];
    for (const at of routesAtCluster(db(), props.memberIds ?? [props.stopId])) {
      const id = `${at.route.route}/${at.route.dest.en}`;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(at);
    }
    return out;
  });

  const etas = createAsyncMemo(async () => {
    etaTick();
    const list = routes();
    if (list.length === 0) return new Map<string, never[]>();
    try {
      return await fetchStopEtas(db(), props.stopId, list);
    } catch {
      return new Map<string, never[]>();
    }
  });

  /** Soonest first: the whole point of the screen is what to run for. */
  const ordered = createMemo(() => {
    const map = etas();
    const withTime = routes().map((at) => {
      const list = map?.get(etaKey(at.route.key)) ?? [];
      return { at, etas: list, next: list[0]?.at.getTime() ?? Number.POSITIVE_INFINITY };
    });
    withTime.sort((a, b) => a.next - b.next);
    return props.maxRoutes ? withTime.slice(0, props.maxRoutes) : withTime;
  });

  const name = () => stripStopCode(pick(props.stop.name, props.lang));
  const other = () =>
    stripStopCode(pick(props.stop.name, props.lang === "zh" ? "en" : "zh"));

  return (
    <Card>
      <a href={`/stop/${encodeURIComponent(props.stopId)}`} class="flex items-center gap-2.5 px-3.5 pb-2.5 pt-3">
        <div class="flex min-w-0 grow flex-col gap-0.5">
          <span class="truncate text-[0.8rem] font-bold tracking-[-0.01em] text-foreground">{name()}</span>
          <span class="truncate text-[0.63rem] font-medium text-subtle-foreground">{other()}</span>
        </div>
        <Show when={props.metres !== undefined}>
          <Chip>
            <span class="tnum">{formatDistance(props.metres as number)}</span>
          </Chip>
        </Show>
      </a>

      <Show when={ordered().length > 0}>
        <Hairline />
      </Show>

      <For each={ordered()}>
        {(row, index) => (
          <>
            <Show when={index() > 0}>
              <Hairline />
            </Show>
            <RouteLine
              route={row.at.route}
              seq={row.at.seq}
              lang={props.lang}
              etas={row.etas}
            />
          </>
        )}
      </For>
    </Card>
  );
}
