import type { JSX } from "@solidjs/web";
import type { CategoryId } from "~/data/categories";
import {
  BoltIcon,
  BridgeIcon,
  BusIcon,
  CameraIcon,
  FerryIcon,
  IslandIcon,
  LinkIcon,
  MinibusIcon,
  MoonIcon,
  MountainIcon,
  PlaneIcon,
  RefreshIcon,
  StampIcon,
  TrainAltIcon,
  TrainIcon,
  UsersIcon,
  type IconProps,
} from "./Icons";

/**
 * A glyph for each route category.
 *
 * The tiles used to carry a coloured bar and nothing else, which told a rider
 * where one tile ended and the next began but not what was in it - six tiles
 * of identical shape, read one title at a time. A picture is read before the
 * words are, so the grid becomes something to scan rather than to read.
 *
 * Each glyph is about the journey rather than the vehicle wherever the
 * category is about a journey: a bridge for the cross-harbour routes, a
 * customs stamp for the boundary crossings, a camera for the sightseeing
 * runs, a crowd for the peak hour. Only the categories that *are* an operator
 * take a vehicle, and there the accent colour beside it is the brand.
 *
 * The map lives here rather than on the `Category` records so that the
 * catalogue stays data - it is read on a worker and in tests, neither of
 * which should be pulling components in behind it.
 */
const ICONS: Record<CategoryId, (props: IconProps) => JSX.Element> = {
  overnight: MoonIcon,
  airport: PlaneIcon,
  crossBoundary: StampIcon,
  crossHarbour: BridgeIcon,
  tourism: CameraIcon,
  hsr: TrainAltIcon,
  express: BoltIcon,
  peak: UsersIcon,
  feeder: LinkIcon,
  circular: RefreshIcon,
  islands: IslandIcon,
  kmb: BusIcon,
  citybus: BusIcon,
  nlb: MountainIcon,
  minibus: MinibusIcon,
  rail: TrainIcon,
  ferry: FerryIcon,
};

export function CategoryIcon(props: {
  id: CategoryId;
  size?: number;
  class?: string;
}): JSX.Element {
  const Glyph = () => ICONS[props.id];
  return <>{Glyph()({ size: props.size, class: props.class })}</>;
}
