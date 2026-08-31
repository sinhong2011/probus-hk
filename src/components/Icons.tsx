import type { JSX } from "@solidjs/web";
import IconAlarmClock from "~icons/lineicons/alarm-clock";
import IconArrowBothDirectionVertical from "~icons/lineicons/arrow-both-direction-vertical-1";
import IconBookmark from "~icons/lineicons/bookmark";
import IconBus from "~icons/lineicons/bus";
import IconChevronLeft from "~icons/lineicons/chevron-left";
import IconChevronRight from "~icons/lineicons/chevron-right";
import IconCloudDownload from "~icons/lineicons/cloud-download";
import IconCheck from "~icons/lineicons/checkmark";
import IconCog from "~icons/lineicons/cog";
import IconExpand from "~icons/lineicons/expand-square-4";
import IconFlag from "~icons/lineicons/flag-1";
import IconFunnel from "~icons/lineicons/funnel-1";
import IconGithub from "~icons/lineicons/github";
import IconGridAlt from "~icons/lineicons/grid-alt";
import IconLayers from "~icons/lineicons/layers-1";
import IconLayout from "~icons/lineicons/layout-9";
import IconMap from "~icons/lineicons/map";
import IconMapMarker from "~icons/lineicons/map-marker";
import IconMegaphone from "~icons/lineicons/megaphone-1";
import IconMenu from "~icons/lineicons/menu";
import IconMonitor from "~icons/lineicons/monitor";
import IconNight from "~icons/lineicons/night";
import IconMinus from "~icons/lineicons/minus";
import IconPin from "~icons/lineicons/pin";
import IconPlus from "~icons/lineicons/plus";
import IconReload from "~icons/lineicons/reload";
import IconRoute from "~icons/lineicons/route-1";
import IconSearch from "~icons/lineicons/search-alt";
import IconStarFat from "~icons/lineicons/star-fat";
import IconStarFill from "~icons/lineicons/star-fill";
import IconInformation from "~icons/lineicons/information";
import IconClipboard from "~icons/lineicons/clipboard";
import IconWarning from "~icons/lineicons/warning";
import IconSortAmount from "~icons/lineicons/sort-amount-asc";
import IconSun from "~icons/lineicons/sun";
import IconTag from "~icons/lineicons/tag";
import IconShare from "~icons/lineicons/share-1";
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

export const DialpadIcon = wrap(IconGridAlt as IconComponent);
export const PinIcon = wrap(IconMapMarker as IconComponent);
export const MapIcon = wrap(IconMap as IconComponent);
export const SearchIcon = wrap(IconSearch as IconComponent);
export const BookmarkIcon = wrap(IconBookmark as IconComponent);
export const StarIcon = wrap(IconStarFat as IconComponent);
export const StarFillIcon = wrap(IconStarFill as IconComponent);
export const SettingsIcon = wrap(IconCog as IconComponent);
/** The rest of the navigation, behind one tab on a phone. */
export const MoreIcon = wrap(IconMenu as IconComponent);
export const ChevronLeftIcon = wrap(IconChevronLeft as IconComponent);
export const ChevronRightIcon = wrap(IconChevronRight as IconComponent);
export const RefreshIcon = wrap(IconReload as IconComponent);
/** Used for the inbound/outbound toggle on a route. */
export const SwapIcon = wrap(IconArrowBothDirectionVertical as IconComponent);
/**
 * Two arrows passing each other - an exchange, which is what the other
 * direction of a route is: the same road with its ends traded. Lineicons has
 * no such glyph, so it is drawn here at the weight the set is drawn at.
 */
export function ExchangeIcon(props: IconProps): JSX.Element {
  const size = () => `${props.size ?? 22}px`;
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size()}
      height={size()}
      class={props.class}
      fill="none"
      stroke="currentColor"
      stroke-width="1.7"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      style={{ "flex-shrink": 0 }}
    >
      <path d="M4 9.25h15" />
      <path d="m15.75 6 3.25 3.25L15.75 12.5" />
      <path d="M20 14.75H5" />
      <path d="M8.25 11.5 5 14.75l3.25 3.25" />
    </svg>
  );
}
/**
 * Walking appears beside a number of minutes, never beside a heading, so the
 * icon marks a duration rather than a direction - Lineicons has no walking
 * figure, and its `direction` signpost was reading as a road sign.
 */
export const WalkIcon = wrap(IconTimer as IconComponent);
export const GripIcon = wrap(IconMenu as IconComponent);
export const MinusIcon = wrap(IconMinus as IconComponent);
/** A thumbtack. `PinIcon` is the map marker; this is the one that holds a row at the top. */
export const ThumbtackIcon = wrap(IconPin as IconComponent);
export const PlusIcon = wrap(IconPlus as IconComponent);
export const CloseIcon = wrap(IconXmark as IconComponent);
export const ExpandIcon = wrap(IconExpand as IconComponent);
/**
 * The keyboard's own delete key - a tag pointing back at the last character
 * with a cross inside it. An eraser was reading as "wipe everything", which
 * is the clear key's job, and Lineicons has no backspace, so it is drawn here
 * at the weight the set is drawn at.
 */
export function BackspaceIcon(props: IconProps): JSX.Element {
  const size = () => `${props.size ?? 22}px`;
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size()}
      height={size()}
      class={props.class}
      fill="none"
      stroke="currentColor"
      stroke-width="1.7"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      style={{ "flex-shrink": 0 }}
    >
      <path d="M9.2 5.5h9.3a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H9.2a1.5 1.5 0 0 1-1.1-.5L3.7 13a1.5 1.5 0 0 1 0-2l4.4-5a1.5 1.5 0 0 1 1.1-.5Z" />
      <path d="m11.5 9.5 5 5" />
      <path d="m16.5 9.5-5 5" />
    </svg>
  );
}
export const DownloadCloudIcon = wrap(IconCloudDownload as IconComponent);
export const BusIcon = wrap(IconBus as IconComponent);
export const RouteIcon = wrap(IconRoute as IconComponent);
export const MegaphoneIcon = wrap(IconMegaphone as IconComponent);
export const TrainIcon = wrap(IconTrain as IconComponent);
export const FerryIcon = wrap(IconShip as IconComponent);
export const TrashIcon = wrap(IconTrash as IconComponent);
/** An alert the rider armed: a clock, because every alert is about a moment. */
export const AlarmIcon = wrap(IconAlarmClock as IconComponent);
export const CheckIcon = wrap(IconCheck as IconComponent);
export const FilterIcon = wrap(IconFunnel as IconComponent);
export const SortIcon = wrap(IconSortAmount as IconComponent);
/** Grouping, on the bookmark screen. */
export const LayersIcon = wrap(IconLayers as IconComponent);
/** One group's name, beside the field a rider types a new one into. */
export const TagIcon = wrap(IconTag as IconComponent);
/** A panel with its side column: the sidebar itself, used to show and hide it. */
export const SidebarIcon = wrap(IconLayout as IconComponent);
export const ShareIcon = wrap(IconShare as IconComponent);
/** Where a ride starts and where it ends. */
export const FlagIcon = wrap(IconFlag as IconComponent);
/** What else there is to know: the stop's own page, and everything at it. */
export const InfoIcon = wrap(IconInformation as IconComponent);
/** The app has hit an error of its own - not a network one. */
export const WarningIcon = wrap(IconWarning as IconComponent);
/** Copy the text beside it. */
export const ClipboardIcon = wrap(IconClipboard as IconComponent);
/** The repository the app is built from, on the one row that links to it. */
export const GithubIcon = wrap(IconGithub as IconComponent);
/**
 * An arrow leaving the corner - the row opens something outside the app.
 *
 * It sits where a chevron sits on an internal row, and the difference between
 * the two glyphs is the whole point: one goes deeper into the app, the other
 * hands the rider to somebody else's site. Drawn here because Lineicons only
 * has a chain link, which reads as "copy a URL" rather than "go there".
 */
export function ExternalIcon(props: IconProps): JSX.Element {
  const size = () => `${props.size ?? 22}px`;
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size()}
      height={size()}
      class={props.class}
      fill="none"
      stroke="currentColor"
      stroke-width="1.9"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      style={{ "flex-shrink": 0 }}
    >
      <path d="M9 15 15.5 8.5" />
      <path d="M9.75 8.5H15.5V14.25" />
    </svg>
  );
}
/* The three ways a screen can be lit: whatever the machine says, day, night. */
export const SystemIcon = wrap(IconMonitor as IconComponent);
export const SunIcon = wrap(IconSun as IconComponent);
export const MoonIcon = wrap(IconNight as IconComponent);

/**
 * A search range: the circle around you, with you at the middle of it.
 * Drawn here because Lineicons has rulers and crosshairs but nothing that
 * reads as "this far around me" at twelve pixels.
 */
export function RadiusIcon(props: IconProps): JSX.Element {
  const size = () => `${props.size ?? 22}px`;
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size()}
      height={size()}
      class={props.class}
      fill="none"
      stroke="currentColor"
      stroke-width="1.7"
      stroke-linecap="round"
      aria-hidden="true"
      style={{ "flex-shrink": 0 }}
    >
      <circle cx="12" cy="12" r="8.25" stroke-dasharray="3.1 3.36" />
      <circle cx="12" cy="12" r="2" fill="currentColor" stroke="none" />
    </svg>
  );
}
