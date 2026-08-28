import { createEffect } from "solid-js";
import { installPersistence, persistedSignal } from "./persisted";
import type { Lang } from "~/lib/i18n";

export type ThemeChoice = "auto" | "light" | "dark";

const KEY = "motherbus:settings";

interface Persisted {
  lang: Lang;
  theme: ThemeChoice;
  radiusM: number;
  refreshSeconds: number;
  showScheduled: boolean;
}

const DEFAULTS: Persisted = {
  lang: "zh",
  theme: "auto",
  // 400 m is roughly a five-minute walk and covers a whole junction's stops.
  radiusM: 400,
  refreshSeconds: 20,
  showScheduled: true,
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
};

export const RADIUS_CHOICES = [200, 400, 800] as const;
export const REFRESH_CHOICES = [10, 20, 30] as const;

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
      const root = document.documentElement;
      // "auto" removes the attribute so the CSS media query decides.
      if (choice === "auto") root.removeAttribute("data-theme");
      else root.setAttribute("data-theme", choice);

      root.lang = language === "zh" ? "zh-HK" : "en";
    },
  );
}
