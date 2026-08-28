import { createEffect, createSignal } from "solid-js";
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

function load(): Persisted {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Persisted>) } : DEFAULTS;
  } catch {
    // Private mode or a corrupt value: the defaults are a fine answer.
    return DEFAULTS;
  }
}

const initial = load();

/*
 * These are app-wide stores, written from event handlers, effects and component
 * setup alike. Solid 2 flags a write from inside an owned scope unless the
 * signal says that is intentional - which for a store it is.
 */
const [lang, setLang] = createSignal<Lang>(initial.lang, { ownedWrite: true });
const [theme, setTheme] = createSignal<ThemeChoice>(initial.theme, { ownedWrite: true });
const [radiusM, setRadiusM] = createSignal(initial.radiusM, { ownedWrite: true });
const [refreshSeconds, setRefreshSeconds] = createSignal(initial.refreshSeconds, { ownedWrite: true });
const [showScheduled, setShowScheduled] = createSignal(initial.showScheduled, { ownedWrite: true });

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
  createEffect(
    (): Persisted => ({
      lang: lang(),
      theme: theme(),
      radiusM: radiusM(),
      refreshSeconds: refreshSeconds(),
      showScheduled: showScheduled(),
    }),
    (value) => {
      try {
        localStorage.setItem(KEY, JSON.stringify(value));
      } catch {
        // Storage unavailable: the session still works, it just will not persist.
      }
    },
  );

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
