import { createEffect } from "solid-js";
import { persistedCollection } from "./collection";
import type { Lang } from "~/lib/i18n";

export type ThemeChoice = "auto" | "light" | "dark";
/** Nearby can be read as a list of kerbs, or as one queue of departures. */
export type NearbyMode = "stop" | "routes";
/** How the bookmark list is ordered. `manual` is the hand-dragged order. */
export type SavedOrder = "manual" | "eta" | "distance" | "route";

interface Persisted {
  lang: Lang;
  theme: ThemeChoice;
  radiusM: number;
  refreshSeconds: number;
  showScheduled: boolean;
  /**
   * Where the app may draw the buses it thinks are on the route: as badges on
   * the map, as glyphs riding the rail between stops, and as the line on an
   * open stop saying how many stops short of it the nearest one still is.
   *
   * Three switches rather than one, all off until asked for. They are the same
   * inference - nobody publishes where a bus is, so every one of them is
   * worked backwards out of a run of arrival times - but they are not the same
   * offer: a bus drawn on a map is a claim about a place, a glyph on the rail
   * is a claim about a gap between two stops, and a count of stops is the
   * loosest of the three. A rider who trusts one need not take all three, and
   * turning the feed off entirely stops the work rather than hiding it.
   */
  vehiclesOnMap: boolean;
  vehiclesOnList: boolean;
  vehiclesAway: boolean;
  nearbyMode: NearbyMode;
  savedOrder: SavedOrder;
  /** How long before an arrival a reminder should fire, in minutes. */
  alertLeadMinutes: number;
  /** How close to the stop an alight reminder should fire, in metres. */
  alertRadiusM: number;
  /** Desktop only: whether the sidebar names its destinations or just shows them. */
  railOpen: boolean;
  /**
   * The colour a group's tag wears, by group name. Only overrides live here -
   * a group with no entry takes a colour hashed from its name, so every tag
   * is coloured from the moment the group is invented.
   */
  groupColors: Record<string, string>;
}

const DEFAULTS: Persisted = {
  lang: "zh",
  theme: "auto",
  // 400 m is roughly a five-minute walk and covers a whole junction's stops.
  radiusM: 400,
  refreshSeconds: 20,
  showScheduled: true,
  vehiclesOnMap: false,
  vehiclesOnList: false,
  vehiclesAway: false,
  nearbyMode: "stop",
  savedOrder: "manual",
  alertLeadMinutes: 3,
  alertRadiusM: 300,
  railOpen: true,
  groupColors: {},
};

/**
 * One row. Settings are a single object rather than a list, and a collection
 * is a set of rows, so they are the one row it holds, under a fixed key.
 * Every field is optional in storage - a value an older build never wrote,
 * or a newer one adds, reads as its default.
 */
type Row = { id: "settings" } & Partial<Persisted>;
const ROW = "settings";

const store = persistedCollection<Row>({
  id: "settings",
  storageKey: "probus:db:settings",
  getKey: (row) => row.id,
  legacyKeys: ["probus:settings", "motherbus:settings"],
  revive: (raw) =>
    raw && typeof raw === "object" ? [{ id: ROW, ...(raw as Partial<Persisted>) }] : [],
});

/** One field of the settings row, read and written like its own signal. */
function field<K extends keyof Persisted>(key: K) {
  const read = () => (store.rows()[0]?.[key] ?? DEFAULTS[key]) as Persisted[K];
  const write = (value: Persisted[K]) => {
    if (store.collection.has(ROW)) {
      store.collection.update(ROW, (draft) => {
        (draft as Partial<Persisted>)[key] = value;
      });
    } else {
      store.collection.insert({ id: ROW, [key]: value } as Row);
    }
  };
  return [read, write] as const;
}

const [lang, setLang] = field("lang");
const [theme, setTheme] = field("theme");
const [radiusM, setRadiusM] = field("radiusM");
const [refreshSeconds, setRefreshSeconds] = field("refreshSeconds");
const [showScheduled, setShowScheduled] = field("showScheduled");
const [vehiclesOnMap, setVehiclesOnMap] = field("vehiclesOnMap");
const [vehiclesOnList, setVehiclesOnList] = field("vehiclesOnList");
const [vehiclesAway, setVehiclesAway] = field("vehiclesAway");
const [nearbyMode, setNearbyMode] = field("nearbyMode");
const [savedOrder, setSavedOrder] = field("savedOrder");
const [alertLeadMinutes, setAlertLeadMinutes] = field("alertLeadMinutes");
const [alertRadiusM, setAlertRadiusM] = field("alertRadiusM");
const [railOpen, setRailOpen] = field("railOpen");
const [groupColors, writeGroupColors] = field("groupColors");

/** Pins one group's tag colour; the map is copied because the row is a draft. */
function setGroupColor(name: string, color: string) {
  writeGroupColors({ ...groupColors(), [name]: color });
}

export const settings = {
  lang,
  setLang,
  theme,
  setTheme,
  radiusM,
  setRadiusM,
  refreshSeconds,
  setRefreshSeconds,
  showScheduled,
  setShowScheduled,
  vehiclesOnMap,
  setVehiclesOnMap,
  vehiclesOnList,
  setVehiclesOnList,
  vehiclesAway,
  setVehiclesAway,
  nearbyMode,
  setNearbyMode,
  savedOrder,
  setSavedOrder,
  alertLeadMinutes,
  setAlertLeadMinutes,
  alertRadiusM,
  setAlertRadiusM,
  railOpen,
  setRailOpen,
  groupColors,
  setGroupColor,
};

/**
 * Where the search-range slider can rest. The range itself is a plain number
 * of metres - any persisted value works - these are the notches a thumb can
 * actually hit, spaced the way distance is felt: each step roughly doubles.
 */
export const RADIUS_STEPS = [100, 200, 400, 800, 2000, 4000] as const;
export const REFRESH_CHOICES = [10, 20, 30] as const;
/** Lead times offered for an arrival reminder, in minutes. */
export const ALERT_LEAD_CHOICES = [1, 3, 5, 10] as const;
/** Distances offered for an alight reminder, in metres. */
export const ALERT_RADIUS_CHOICES = [200, 300, 500] as const;

/**
 * Puts a theme choice on the document.
 *
 * Its own function because the effect below is not the only caller: the theme
 * wipe needs the document already changed at the moment it asks the browser to
 * photograph it, and Solid's effects do not run that soon.
 */
export function reflectTheme(choice: ThemeChoice) {
  const root = document.documentElement;
  // "auto" removes the attribute so the CSS media query decides.
  if (choice === "auto") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", choice);
}

/**
 * Brings the settings in and reflects theme and language onto the document.
 *
 * Solid 2 splits an effect in two: the first function does the reactive reads,
 * the second performs the side effects with that value and is not tracked.
 */
export function installSettingsEffects() {
  store.install();

  createEffect(
    () => ({ theme: theme(), lang: lang() }),
    ({ theme: choice, lang: language }) => {
      reflectTheme(choice);
      document.documentElement.lang = language === "zh" ? "zh-HK" : "en";
    },
  );
}
