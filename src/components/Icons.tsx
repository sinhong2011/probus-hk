import type { JSX } from "@solidjs/web";
import IconArrowBothDirectionVertical from "~icons/lineicons/arrow-both-direction-vertical-1";
import IconBookmark from "~icons/lineicons/bookmark";
import IconBus from "~icons/lineicons/bus";
import IconChevronLeft from "~icons/lineicons/chevron-left";
import IconChevronRight from "~icons/lineicons/chevron-right";
import IconCloudDownload from "~icons/lineicons/cloud-download";
import IconCog from "~icons/lineicons/cog";
import IconEraser from "~icons/lineicons/eraser";
import IconMapMarker from "~icons/lineicons/map-marker";
import IconMegaphone from "~icons/lineicons/megaphone-1";
import IconMenu from "~icons/lineicons/menu";
import IconMinus from "~icons/lineicons/minus";
import IconReload from "~icons/lineicons/reload";
import IconRoute from "~icons/lineicons/route-1";
import IconSearch from "~icons/lineicons/search-alt";
import IconShip from "~icons/lineicons/ship";
import IconTimer from "~icons/lineicons/timer";
import IconTrain from "~icons/lineicons/train-1";
import IconTrash from "~icons/lineicons/trash-can";
import IconXmark from "~icons/lineicons/xmark";

/**
 * Lineicons (MIT), inlined at build time by unplugin-icons so only the icons
 * imported here reach the bundle - no icon font, no runtime fetch. They are
 * filled paths that inherit `currentColor`, so colour comes from the parent.
 */

export interface IconProps {
  /** Rendered size in pixels; the underlying SVG scales to it. */
  size?: number;
  class?: string;
}

type IconComponent = (props: Record<string, unknown>) => JSX.Element;

function wrap(Component: IconComponent) {
  return (props: IconProps): JSX.Element => {
    const size = () => `${props.size ?? 22}px`;
    return (
      <Component
        width={size()}
        height={size()}
        class={props.class}
        aria-hidden="true"
        style={{ "flex-shrink": 0 }}
      />
    );
  };
}

export const PinIcon = wrap(IconMapMarker as IconComponent);
export const SearchIcon = wrap(IconSearch as IconComponent);
export const BookmarkIcon = wrap(IconBookmark as IconComponent);
export const SettingsIcon = wrap(IconCog as IconComponent);
export const ChevronLeftIcon = wrap(IconChevronLeft as IconComponent);
export const ChevronRightIcon = wrap(IconChevronRight as IconComponent);
export const RefreshIcon = wrap(IconReload as IconComponent);
/** Used for the inbound/outbound toggle on a route. */
export const SwapIcon = wrap(IconArrowBothDirectionVertical as IconComponent);
/**
 * Walking appears beside a number of minutes, never beside a heading, so the
 * icon marks a duration rather than a direction - Lineicons has no walking
 * figure, and its `direction` signpost was reading as a road sign.
 */
export const WalkIcon = wrap(IconTimer as IconComponent);
export const GripIcon = wrap(IconMenu as IconComponent);
export const MinusIcon = wrap(IconMinus as IconComponent);
export const CloseIcon = wrap(IconXmark as IconComponent);
export const BackspaceIcon = wrap(IconEraser as IconComponent);
export const DownloadCloudIcon = wrap(IconCloudDownload as IconComponent);
export const BusIcon = wrap(IconBus as IconComponent);
export const RouteIcon = wrap(IconRoute as IconComponent);
export const MegaphoneIcon = wrap(IconMegaphone as IconComponent);
export const TrainIcon = wrap(IconTrain as IconComponent);
export const FerryIcon = wrap(IconShip as IconComponent);
export const TrashIcon = wrap(IconTrash as IconComponent);
