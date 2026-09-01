import { Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js";
import { Alert } from "./Alert";
import { Chip } from "./Chrome";
import { Modal } from "./Modal";
import { SunIcon } from "./Icons";
import { t, type Lang } from "~/lib/i18n";
import { solarPosition } from "~/lib/solar";
import { SUN_OFFER_DELAY_MS, SUN_OFFER_ID, sunOfferReady, type TripSunCopy } from "~/data/tripSun";
import { dismissed } from "~/stores/dismissed";
import { settings } from "~/stores/settings";
import { sheets } from "~/stores/sheets";
import { minute } from "~/stores/clock";

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
