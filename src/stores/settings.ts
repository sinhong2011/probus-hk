import { createEffect } from "solid-js";
import { installPersistence, persistedSignal } from "./persisted";
import type { Lang } from "~/lib/i18n";

export type ThemeChoice = "auto" | "light" | "dark";
/** Nearby can be read as a list of kerbs, or as one queue of departures. */
export type NearbyMode = "stop" | "routes";
/** How the bookmark list is ordered. `manual` is the hand-dragged order. */
export type SavedOrder = "manual" | "eta" | "distance" | "route";

// The old name, kept on purpose: renaming the key empties a rider's settings on every
// device that already has one.
const KEY = "motherbus:settings";

interface Persisted {
  lang: Lang;
  theme: ThemeChoice;
  radiusM: number;
  refreshSeconds: number;
  showScheduled: boolean;
  nearbyMode: NearbyMode;
  savedOrder: SavedOrder;
  /** How long before an arrival a reminder should fire, in minutes. */
  alertLeadMinutes: number;
  /** How close to the stop an alight reminder should fire, in metres. */
  alertRadiusM: number;
  /** Desktop only: whether the sidebar names its destinations or just shows them. */
  railOpen: boolean;
}

const DEFAULTS: Persisted = {
  lang: "zh",
  theme: "auto",
  // 400 m is roughly a five-minute walk and covers a whole junction's stops.
  radiusM: 400,
  refreshSeconds: 20,
  showScheduled: true,
  nearbyMode: "stop",
  savedOrder: "manual",
  alertLeadMinutes: 3,
  alertRadiusM: 300,
  railOpen: true,
};

/** A stored value missing a key, or written by an older build, keeps working. */
const revive = (raw: unknown): Persisted => ({ ...DEFAULTS, ...(raw as Partial<Persisted>) });

const [stored, setStored] = persistedSignal<Persisted>(KEY, DEFAULTS, revive);

/** One field of the settings object, read and written like its own signal. */
function field<K extends keyof Persisted>(key: K) {
  return [
    () => stored()[key],
    (value: Persisted[K]) => setStored((prev) => ({ ...prev, [key]: value })),
  ] as const;
}

const [lang, setLang] = field("lang");
const [theme, setTheme] = field("theme");
const [radiusM, setRadiusM] = field("radiusM");
const [refreshSeconds, setRefreshSeconds] = field("refreshSeconds");
const [showScheduled, setShowScheduled] = field("showScheduled");
const [nearbyMode, setNearbyMode] = field("nearbyMode");
const [savedOrder, setSavedOrder] = field("savedOrder");
const [alertLeadMinutes, setAlertLeadMinutes] = field("alertLeadMinutes");
const [alertRadiusM, setAlertRadiusM] = field("alertRadiusM");
const [railOpen, setRailOpen] = field("railOpen");

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
};

export const RADIUS_CHOICES = [200, 400, 800] as const;
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
 * Persists settings and reflects theme and language onto the document.
 *
 * Solid 2 splits an effect in two: the first function does the reactive reads,
 * the second performs the side effects with that value and is not tracked.
 */
export function installSettingsEffects() {
  installPersistence(KEY, stored, setStored, revive);

  createEffect(
    () => ({ theme: theme(), lang: lang() }),
    ({ theme: choice, lang: language }) => {
      reflectTheme(choice);
      document.documentElement.lang = language === "zh" ? "zh-HK" : "en";
    },
  );
}
