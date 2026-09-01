import { useLinkProps } from "@tanstack/solid-router";
import { Show } from "solid-js";
import { useDb } from "~/data/context";
import { isSpecialService } from "~/data/db";
import { lastRunGone } from "~/data/schedule";
import { stopIdsFor, useEta } from "~/data/useEta";
import type { Eta, KeyedRoute } from "~/data/types";
import { fareAt, notableConcession } from "~/lib/format";
import { pick, t, type Lang } from "~/lib/i18n";
import { routeLink } from "~/lib/links";
import { operatorLabel } from "~/lib/operators";
import { minute } from "~/stores/clock";
import { SpecialTag } from "./Chrome";
import { EtaCountdown, type CountdownSize } from "./EtaCountdown";
import { RoutePlate, type PlateSize } from "./RoutePlate";

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
      // The concession, where it is not the flat $2 every route charges - see
      // `notableConcession`.
      const concession = notableConcession(props.route.fares?.[props.seq - 1]);
      parts.push(concession ? `${fare} · ${concession}` : fare);
    }
  }
  return parts.filter(Boolean).join(" · ");
}

/** Presentational row - takes arrivals it is given, so a stop can batch them. */
export function RouteLine(props: LineProps) {
  const db = useDb();
  /* Whether an empty answer here means "wait" or "that was the last one".
     Read through the clock so the row turns over on the minute the last bus
     passes rather than on a reload - and through the minute of it, because
     that is how often the answer can change and this is a timetable lookup
     per row of a list. */
  const over = () => {
    minute();
    return lastRunGone(db(), props.route);
  };

  return (
    <a
      {...useLinkProps(routeLink(props.route.key))}
      class="app-tap flex items-center gap-3 px-3.5 py-2.5"
    >
      <RoutePlate route={props.route.route} co={props.route.co} size={props.plateSize ?? "sm"} />

      <div class="flex min-w-0 grow flex-col gap-0.5">
        <span class="flex min-w-0 items-center gap-1.5">
          <span class="truncate text-[0.88rem] font-bold tracking-[-0.01em] text-foreground">
            {t("towards", props.lang)} {pick(props.route.dest, props.lang)}
          </span>
          <Show when={isSpecialService(props.route)}>
            <SpecialTag lang={props.lang} />
          </Show>
        </span>
        <span class="truncate text-[0.75rem] font-medium text-subtle-foreground">
          {subtitleFor(props)}
        </span>
      </div>

      <EtaCountdown
        etas={props.etas}
        lang={props.lang}
        size={props.countdownSize ?? "sm"}
        over={over()}
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
