import { Show } from "solid-js";
import { stopIdsFor, useEta } from "~/data/useEta";
import type { Eta, KeyedRoute } from "~/data/types";
import { concessionFare, fareAt } from "~/lib/format";
import { pick, t, type Lang } from "~/lib/i18n";
import { operatorLabel } from "~/lib/operators";
import { EtaCountdown, type CountdownSize } from "./EtaCountdown";
import { RoutePlate, type PlateSize } from "./RoutePlate";

export function routeHref(key: string): string {
  return `/route/${encodeURIComponent(key)}`;
}

interface LineProps {
  route: KeyedRoute;
  seq: number;
  lang: Lang;
  etas: Eta[];
  plateSize?: PlateSize;
  countdownSize?: CountdownSize;
  /** Overrides the operator/fare subtitle, e.g. with a stop name. */
  subtitle?: string;
}

function subtitleFor(props: LineProps): string {
  if (props.subtitle) return props.subtitle;

  const parts = [operatorLabel(props.route.co, props.lang)];
  const fare = fareAt(props.route.fares, props.seq);

  if (fare) {
    const holiday = fareAt(props.route.faresHoliday, props.seq);
    if (holiday && holiday !== fare) {
      // Only NLB really charges differently at weekends.
      parts.push(`${fare} · ${t("holidayFare", props.lang)} ${holiday}`);
    } else {
      // The $2 concession matters to a lot of riders, so it is always shown.
      const concession = concessionFare(props.route.fares?.[props.seq - 1]);
      parts.push(concession ? `${fare} · ${concession}` : fare);
    }
  }
  return parts.filter(Boolean).join(" · ");
}

/** Presentational row - takes arrivals it is given, so a stop can batch them. */
export function RouteLine(props: LineProps) {
  return (
    <a
      href={routeHref(props.route.key)}
      class="mb-tap flex items-center gap-3 px-3.5 py-2.5"
    >
      <RoutePlate route={props.route.route} co={props.route.co} size={props.plateSize ?? "sm"} />

      <div class="flex min-w-0 grow flex-col gap-0.5">
        <span class="truncate text-[0.82rem] font-bold tracking-[-0.01em] text-foreground">
          {t("towards", props.lang)} {pick(props.route.dest, props.lang)}
        </span>
        <span class="truncate text-[0.63rem] font-medium text-subtle-foreground">{subtitleFor(props)}</span>
      </div>

      <EtaCountdown
        etas={props.etas}
        lang={props.lang}
        size={props.countdownSize ?? "sm"}
      />
    </a>
  );
}

/** Self-fetching row, for places that show a single route on its own. */
export function RouteRow(props: Omit<LineProps, "etas">) {
  const etas = useEta(() => ({
    route: props.route,
    seq: props.seq,
    stopIdByCo: stopIdsFor(props.route, props.seq),
  }));

  return (
    <Show when={etas()} fallback={<RouteLine {...props} etas={[]} />}>
      {(list) => <RouteLine {...props} etas={list()} />}
    </Show>
  );
}
