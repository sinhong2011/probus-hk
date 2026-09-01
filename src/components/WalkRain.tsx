import { Show, createEffect, createSignal, onCleanup } from "solid-js";
import { Alert } from "./Alert";
import { Chip } from "./Chrome";
import { Modal } from "./Modal";
import { DropIcon } from "./Icons";
import { t, type Lang } from "~/lib/i18n";
import type { LatLng } from "~/lib/geo";
import { RAIN_OFFER_DELAY_MS, RAIN_OFFER_ID } from "~/data/walkRain";
import { useWalkRain } from "~/data/useWalkRain";
import { dismissed } from "~/stores/dismissed";
import { settings } from "~/stores/settings";
import { sheets } from "~/stores/sheets";

export function WalkRainChip(props: { at: LatLng | null; hasWalk?: boolean; lang: Lang }) {
  const rain = useWalkRain(() => ({
    at: props.at,
    hasWalk: props.hasWalk ?? props.at !== null,
  }));
  return (
    <Show when={rain()?.chip}>
      {(chip) => (
        <Chip tone="warn" class="shrink-0" label={chip()}>
          <DropIcon size={11} />
          <span>{chip()}</span>
        </Chip>
      )}
    </Show>
  );
}

/**
 * One-time offer, same shape as 行程日照: a banner, then a sheet, only while
 * Hong Kong is wet, a walk exists, and the setting is still off.
 */
export function WalkRainOffer(props: { lang: Lang; at: LatLng | null; hasWalk: boolean }) {
  const rain = useWalkRain(() => ({ at: props.at, hasWalk: props.hasWalk }));
  const ready = () => rain()?.offer === true;

  const [sheet, setSheet] = createSignal(false);
  createEffect(
    () => ({ ready: ready(), blocked: sheets.settingsOpen() || sheets.moreOpen() }),
    ({ ready: on, blocked }) => {
      if (!on || blocked) {
        setSheet(false);
        return;
      }
      const wait = window.setTimeout(() => setSheet(true), RAIN_OFFER_DELAY_MS);
      return () => window.clearTimeout(wait);
    },
  );
  onCleanup(() => setSheet(false));

  const enable = () => {
    settings.setWalkRain(true);
    dismissed.dismiss(RAIN_OFFER_ID);
    setSheet(false);
  };
  const decline = () => {
    dismissed.dismiss(RAIN_OFFER_ID);
    setSheet(false);
  };

  return (
    <Show when={ready()}>
      <Alert
        id={RAIN_OFFER_ID}
        lang={props.lang}
        tone="warn"
        icon={<DropIcon size={13} />}
        class="shrink-0"
      >
        <div class="flex flex-wrap items-center gap-2">
          <span>{t("rainOffer", props.lang)}</span>
          <button
            type="button"
            onClick={enable}
            class="app-press rounded-full bg-primary px-2.5 py-0.5 text-[0.75rem] font-bold text-primary-foreground"
          >
            {t("rainOfferTry", props.lang)}
          </button>
        </div>
      </Alert>
      <Modal
        open={sheet()}
        onClose={decline}
        title={t("rainOfferTitle", props.lang)}
        lang={props.lang}
        action={
          <button
            type="button"
            onClick={enable}
            class="app-press flex h-8 w-full items-center justify-center rounded-lg bg-primary text-[0.81rem] font-semibold text-primary-foreground"
          >
            {t("rainOfferTry", props.lang)}
          </button>
        }
      >
        <p class="text-sm leading-relaxed text-muted-foreground">
          {t("rainOfferBody", props.lang)}
        </p>
      </Modal>
    </Show>
  );
}
