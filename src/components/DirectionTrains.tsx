import { Show, createMemo } from "solid-js";
import { EtaCountdown } from "./EtaCountdown";
import type { Company, KeyedRoute } from "~/data/types";
import { useEta } from "~/data/useEta";
import { pick, t, type Lang } from "~/lib/i18n";

/**
 * One direction's next trains from a station.
 *
 * Shared between the line page and the map's station sheet, which ask the
 * same question of the same feed: given this route and this platform, what
 * is coming. The operator is a parameter because the light rail answers it
 * too, from its own stop ids.
 */
export function DirectionTrains(props: {
  route: KeyedRoute;
  stationId: string;
  co?: Company;
  lang: Lang;
  /** Off, the row asks for nothing: a closed row on a thirty-station line
      would otherwise poll a feed for a screen that shows none of it. */
  active: boolean;
  /** Show the route's number, where the direction alone does not say which. */
  numbered?: boolean;
}) {
  const co = () => props.co ?? "mtr";
  /** 1-based position of the station along this direction, or 0 if not on it. */
  const seq = createMemo(() => (props.route.stops[co()]?.indexOf(props.stationId) ?? -1) + 1);

  const etas = useEta(() =>
    props.active && seq() > 0
      ? { route: props.route, seq: seq(), stopIdByCo: { [co()]: props.stationId } }
      : null,
  );

  return (
    <Show when={seq() > 0}>
      <div class="flex items-center gap-2.5 rounded-lg bg-secondary px-3 py-2">
        <div class="flex min-w-0 grow flex-col gap-0.5">
          <span class="truncate text-[0.88rem] font-bold text-foreground">
            <Show when={props.numbered}>
              <span class="tnum mr-1.5 text-muted-foreground">{props.route.route}</span>
            </Show>
            {t("towards", props.lang)} {pick(props.route.dest, props.lang)}
          </span>
          <span class="truncate text-[0.75rem] font-medium text-subtle-foreground">
            {t("nextTrains", props.lang)}
          </span>
        </div>
        <EtaCountdown etas={etas()} lang={props.lang} size="sm" limit={3} />
      </div>
    </Show>
  );
}
