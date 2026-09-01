import { For, Show, createEffect, createSignal } from "solid-js";
import { ExternalIcon, MapIcon, PinIcon, RefreshIcon } from "./Icons";
import { Modal } from "./Modal";
import { CAMERA_REFRESH_MS, cameraImage, type NearbyCamera } from "~/data/cameras";
import { clockTime } from "~/lib/format";
import { formatDistance } from "~/lib/geo";
import { mapLink, type MapProvider } from "~/lib/externalLinks";
import { pick, t, type Lang } from "~/lib/i18n";

const MAP_CHOICES: { id: MapProvider; label: "mapGoogle" | "mapApple" | "mapSystem" }[] = [
  { id: "google", label: "mapGoogle" },
  { id: "apple", label: "mapApple" },
  { id: "geo", label: "mapSystem" },
];

/**
 * The road the bus is on, seen rather than inferred.
 *
 * An arrival time is the operator's guess; the Transport Department's camera
 * at the junction is the road itself. A rider whose countdown has stopped
 * moving opens this to answer the only question that matters at a kerb -
 * is the traffic moving - and the picture answers it in one glance.
 *
 * The department takes a new picture every two minutes, so the sheet fetches
 * on that clock while it is up and says when the picture it shows was taken.
 * A refresh that fails keeps the picture it has: a two-minute-old road beats
 * an error where a road should be.
 */
export function CameraSheet(props: {
  open: boolean;
  onClose: () => void;
  near: NearbyCamera;
  lang: Lang;
}) {
  /** The picture on show - swapped only once its replacement has arrived. */
  const [shown, setShown] = createSignal<string | null>(null);
  const [failed, setFailed] = createSignal(false);
  const [takenAt, setTakenAt] = createSignal<Date | null>(null);

  createEffect(
    () => (props.open ? props.near.camera.key : null),
    (key) => {
      if (!key) return;
      let alive = true;

      const fetchPicture = () => {
        // Loaded off-DOM and swapped in whole, so a refresh never blanks the
        // sheet while the next picture is still on the wire.
        const url = cameraImage(key, Date.now());
        const img = new Image();
        img.onload = () => {
          if (!alive) return;
          setShown(url);
          setTakenAt(new Date());
          setFailed(false);
        };
        img.onerror = () => {
          if (!alive) return;
          if (!shown()) setFailed(true);
        };
        img.src = url;
      };

      setShown(null);
      setTakenAt(null);
      setFailed(false);
      fetchPicture();
      const timer = setInterval(fetchPicture, CAMERA_REFRESH_MS);

      return () => {
        alive = false;
        clearInterval(timer);
      };
    },
  );

  const caption = () => {
    const distance = formatDistance(props.near.metres);
    const at = takenAt();
    return at ? `${distance} · ${t("updatedAt", props.lang)} ${clockTime(at)}` : distance;
  };

  return (
    <Modal
      open={props.open}
      onClose={props.onClose}
      title={pick(props.near.camera.name, props.lang)}
      lang={props.lang}
      aside={
        <div class="flex flex-col items-end gap-1" aria-label={caption()}>
          <span class="flex items-center gap-1">
            <PinIcon size={11} class="text-faint-foreground" />
            <span class="tnum text-[0.81rem] font-semibold text-subtle-foreground">
              {formatDistance(props.near.metres)}
            </span>
          </span>
          <Show when={takenAt()}>
            {(at) => (
              <span class="flex items-center gap-1">
                <RefreshIcon size={10} class="text-faint-foreground" />
                <span class="tnum text-[0.69rem] font-medium text-faint-foreground">
                  {t("updatedAt", props.lang)} {clockTime(at())}
                </span>
              </span>
            )}
          </Show>
        </div>
      }
    >
      <div class="flex flex-col gap-1.5">
        {/* The department's pictures are 4:3; the frame holds that shape from
            the first paint so nothing jumps when the picture lands. */}
        <div class="relative aspect-[4/3] w-full overflow-hidden rounded-2xl bg-secondary">
          <Show when={shown()} fallback={<span class="app-shimmer absolute inset-0" />}>
            {(src) => (
              <img
                src={src()}
                alt={pick(props.near.camera.name, props.lang)}
                class="absolute inset-0 size-full object-cover"
              />
            )}
          </Show>
          <Show when={failed()}>
            <span class="absolute inset-0 flex items-center justify-center bg-secondary text-[0.88rem] font-semibold text-muted-foreground">
              {t("cameraFailed", props.lang)}
            </span>
          </Show>
        </div>

        {/* One line: the source is a footnote, the maps are the action. A
            heading plus three full pills was a second block under a picture
            that already fills the sheet. */}
        <div class="flex items-center gap-2">
          <p class="min-w-0 grow truncate text-[0.69rem] font-medium text-faint-foreground">
            {t("cameraSource", props.lang)}
          </p>
          {/* One compact control, not a row of loose words: the maps share a
              pill, with a hairline between each, so they still look like
              buttons at this size. */}
          <nav
            aria-label={t("cameraOpenMap", props.lang)}
            class="flex h-6 shrink-0 items-stretch overflow-hidden rounded-full border border-border bg-secondary"
          >
            <span class="flex items-center pl-1.5 text-faint-foreground" aria-hidden="true">
              <MapIcon size={11} />
            </span>
            <For each={MAP_CHOICES}>
              {(choice, index) => (
                <a
                  href={mapLink(choice.id, props.near.camera.location, props.lang)}
                  target="_blank"
                  rel="noreferrer"
                  class={[
                    "app-press flex items-center px-2 text-[0.69rem] font-bold text-muted-foreground transition-colors duration-state hover:text-foreground",
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
    </Modal>
  );
}
