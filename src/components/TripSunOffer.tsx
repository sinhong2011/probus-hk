import { For, Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js";
import { Alert } from "./Alert";
import { Chip } from "./Chrome";
import { Modal } from "./Modal";
import { SlidingPill } from "./SlidingPill";
import { SunIcon } from "./Icons";
import {
  addHkDays,
  formatHkHm,
  formatHkYmd,
  hkInstant,
  hkNow,
  parseHkYmdHm,
  sameHkDay,
} from "~/lib/hkTime";
import { t, type Lang } from "~/lib/i18n";
import { solarPosition } from "~/lib/solar";
import { createWide } from "~/lib/wide";
import { SUN_OFFER_DELAY_MS, SUN_OFFER_ID, sunOfferReady, type TripSunCopy } from "~/data/tripSun";
import { dismissed } from "~/stores/dismissed";
import { settings } from "~/stores/settings";
import { sheets } from "~/stores/sheets";
import { minute, now } from "~/stores/clock";

/** Hong Kong's middle, for "is the sun even up" before a route is scored. */
const HK = { lat: 22.3, lng: 114.17 };

/**
 * The chips a ride band or a plan card prints once the setting is on.
 */
export function TripSunChips(props: { copy: TripSunCopy; lang: Lang; tone?: "accent" | "card" }) {
  return (
    <>
      <Show when={props.copy.chip}>
        {(chip) => (
          <Chip tone={props.tone ?? "card"} class="shrink-0" label={chip()}>
            <SunIcon size={11} />
            <span>{chip()}</span>
          </Chip>
        )}
      </Show>
      <Show when={props.copy.wait}>
        {(wait) => (
          <Chip tone="card" class="shrink-0">
            {wait()}
          </Chip>
        )}
      </Show>
      <Show when={props.copy.walk}>
        {(walk) => (
          <Chip tone="card" class="shrink-0">
            {walk()}
          </Chip>
        )}
      </Show>
    </>
  );
}

/**
 * The one-time offer: a banner on the page, then a sheet after a short pause.
 *
 * Shown only on a daytime ride while the setting is still off. Closing either
 * surface, or turning the setting on, is remembered and it never returns.
 */
export function TripSunOffer(props: { lang: Lang; hasRide: boolean }) {
  const elevation = createMemo(() => {
    minute();
    return solarPosition(new Date(), HK.lat, HK.lng).elevation;
  });

  const ready = createMemo(() =>
    sunOfferReady({
      enabled: settings.tripSun(),
      dismissed: dismissed.has(SUN_OFFER_ID),
      elevation: elevation(),
      hasRide: props.hasRide,
    }),
  );

  const [sheet, setSheet] = createSignal(false);
  createEffect(
    () => ({ ready: ready(), blocked: sheets.settingsOpen() || sheets.moreOpen() }),
    ({ ready: on, blocked }) => {
      if (!on || blocked) {
        setSheet(false);
        return;
      }
      const wait = window.setTimeout(() => setSheet(true), SUN_OFFER_DELAY_MS);
      return () => window.clearTimeout(wait);
    },
  );
  onCleanup(() => setSheet(false));

  const enable = () => {
    settings.setTripSun(true);
    dismissed.dismiss(SUN_OFFER_ID);
    setSheet(false);
  };
  const decline = () => {
    dismissed.dismiss(SUN_OFFER_ID);
    setSheet(false);
  };

  return (
    <Show when={ready()}>
      <Alert id={SUN_OFFER_ID} lang={props.lang} icon={<SunIcon size={13} />} class="shrink-0">
        <div class="flex flex-wrap items-center gap-2">
          <span>{t("sunOffer", props.lang)}</span>
          <button
            type="button"
            onClick={enable}
            class="app-press rounded-full bg-primary px-2.5 py-0.5 text-[0.75rem] font-bold text-primary-foreground"
          >
            {t("sunOfferTry", props.lang)}
          </button>
        </div>
      </Alert>
      <Modal
        open={sheet()}
        onClose={decline}
        title={t("sunOfferTitle", props.lang)}
        lang={props.lang}
        action={
          <button
            type="button"
            onClick={enable}
            class="app-press flex h-8 w-full items-center justify-center rounded-lg bg-primary text-[0.81rem] font-semibold text-primary-foreground"
          >
            {t("sunOfferTry", props.lang)}
          </button>
        }
      >
        <p class="text-sm leading-relaxed text-muted-foreground">{t("sunOfferBody", props.lang)}</p>
      </Modal>
    </Show>
  );
}

/** 08:00 — a typical morning commute, the clock Shade On You made people pick at night. */
const MORNING_MINUTES = 8 * 60;

const PRESETS = ["live", "today", "tomorrow"] as const;
type ClockPreset = (typeof PRESETS)[number] | "custom";

function morningOf(at: Date, days: number): Date {
  return hkInstant(hkNow(addHkDays(at, days)), MORNING_MINUTES);
}

function sameStamp(a: Date, b: Date): boolean {
  return formatHkYmd(a) === formatHkYmd(b) && formatHkHm(a) === formatHkHm(b);
}

function presetOf(value: Date | null, at: Date): ClockPreset {
  if (value === null) return "live";
  if (sameStamp(value, morningOf(at, 0))) return "today";
  if (sameStamp(value, morningOf(at, 1))) return "tomorrow";
  return "custom";
}

function clockChip(value: Date | null, lang: Lang, at: Date): string {
  if (!value) return t("sunClockLive", lang);
  const hm = formatHkHm(value);
  if (sameHkDay(value, at)) return `${t("tripSun", lang)} · ${hm}`;
  if (sameHkDay(value, addHkDays(at, 1))) {
    return `${t("tripSun", lang)} · ${t("sunClockTomorrow", lang)} ${hm}`;
  }
  const parts = hkNow(value);
  const date = lang === "zh" ? `${parts.month}月${parts.day}日` : `${parts.day}/${parts.month}`;
  return `${t("tripSun", lang)} · ${date} ${hm}`;
}

const FIELD =
  "h-11 w-full rounded-2xl border border-border bg-raised px-3.5 tnum text-[0.94rem] font-semibold text-foreground outline-none";

const PRESET_LABEL: Record<
  (typeof PRESETS)[number],
  "sunClockNext" | "sunClockTodayAm" | "sunClockTomorrowAm"
> = {
  live: "sunClockNext",
  today: "sunClockTodayAm",
  tomorrow: "sunClockTomorrowAm",
};

/**
 * The clock 行程日照 is scored at, on Plan.
 *
 * Live next-bus is the default. A picked Hong Kong wall-clock is how a rider
 * at night asks about a morning ride — the thing a live ETA cannot say.
 */
export function TripSunClock(props: {
  lang: Lang;
  /** Null means the next live bus, not "now". */
  value: Date | null;
  onChange: (at: Date | null) => void;
}) {
  const wide = createWide();
  const [open, setOpen] = createSignal(false);
  const at = () => new Date(now());
  const preset = () => presetOf(props.value, at());

  const ymd = () => formatHkYmd(props.value ?? at());
  const hm = () => formatHkHm(props.value ?? at());

  const pickPreset = (choice: (typeof PRESETS)[number]) => {
    if (choice === "live") props.onChange(null);
    else props.onChange(morningOf(at(), choice === "today" ? 0 : 1));
  };

  const pickFields = (nextYmd: string, nextHm: string) => {
    const parsed = parseHkYmdHm(nextYmd, nextHm);
    if (parsed) props.onChange(parsed);
  };

  return (
    <Show when={settings.tripSun()}>
      <button
        type="button"
        onClick={() => setOpen(true)}
        class="app-press flex h-8 w-fit items-center gap-1.5 rounded-full bg-secondary px-3 text-[0.81rem] font-bold text-muted-foreground transition-colors duration-state"
        aria-haspopup="dialog"
        aria-expanded={open() ? "true" : "false"}
      >
        <SunIcon size={13} />
        <span class="tnum">{clockChip(props.value, props.lang, at())}</span>
      </button>

      <Modal
        open={open()}
        onClose={() => setOpen(false)}
        title={t("sunClock", props.lang)}
        description={t("sunClockHint", props.lang)}
        lang={props.lang}
        side={wide() ? "right" : "bottom"}
      >
        <div class="flex flex-col gap-4">
          <div
            role="tablist"
            aria-label={t("sunClock", props.lang)}
            class="relative flex items-center rounded-full bg-secondary p-[3px]"
          >
            <SlidingPill active={preset()} class="inset-y-[3px] rounded-full bg-card shadow-card" />
            <For each={PRESETS}>
              {(choice) => {
                const current = () => preset() === choice;
                return (
                  <button
                    type="button"
                    role="tab"
                    aria-selected={current() ? "true" : "false"}
                    data-pill-active={current() ? "true" : "false"}
                    onClick={() => pickPreset(choice)}
                    class={[
                      "app-press relative z-10 flex h-7 min-w-0 grow items-center justify-center rounded-full px-2 text-[0.75rem] font-bold leading-none transition-colors duration-state",
                      {
                        "text-foreground": current(),
                        "text-subtle-foreground": !current(),
                      },
                    ]}
                  >
                    {t(PRESET_LABEL[choice], props.lang)}
                  </button>
                );
              }}
            </For>
          </div>

          <div class="grid grid-cols-2 gap-2.5">
            <label class="flex flex-col gap-1.5">
              <span class="px-1 text-[0.75rem] font-bold uppercase tracking-[0.16em] text-subtle-foreground">
                {t("sunClockDate", props.lang)}
              </span>
              <input
                type="date"
                class={FIELD}
                value={ymd()}
                aria-label={t("sunClockDate", props.lang)}
                onInput={(event) => pickFields(event.currentTarget.value, hm())}
              />
            </label>
            <label class="flex flex-col gap-1.5">
              <span class="px-1 text-[0.75rem] font-bold uppercase tracking-[0.16em] text-subtle-foreground">
                {t("sunClockTime", props.lang)}
              </span>
              <input
                type="time"
                class={FIELD}
                value={hm()}
                aria-label={t("sunClockTime", props.lang)}
                onInput={(event) => pickFields(ymd(), event.currentTarget.value)}
              />
            </label>
          </div>
        </div>
      </Modal>
    </Show>
  );
}
