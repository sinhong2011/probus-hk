import { createSignal } from "solid-js";

/*
 * The app-level sheets: the "more" menu a phone's tab bar opens, and the
 * settings drawer both shells share. They live in a store rather than in the
 * tab bar because more than one thing opens them - the bar, the sidebar, the
 * ⌥6 key, and the old `/settings` address all land here.
 *
 * App-wide store, written from event handlers and the router alike; Solid 2
 * wants that declared rather than inferred.
 */
const [settingsOpen, setSettingsOpen] = createSignal(false, { ownedWrite: true });
const [moreOpen, setMoreOpen] = createSignal(false, { ownedWrite: true });

/*
 * Whether settings has ever been asked for: the panel's code is a lazy chunk,
 * and this is what tells the shell to start fetching it. Never unset - once
 * loaded, the mounted drawer is what animates the next open.
 */
const [settingsWanted, setSettingsWanted] = createSignal(false, { ownedWrite: true });

/*
 * The search-range sheet: a map with the radius drawn on it. Opened from the
 * nearby screen's header and from the settings drawer alike, so it lives here
 * with the others. Wanted works as for settings - the map library is a heavy
 * chunk, fetched the first time anyone asks.
 */
const [rangeOpen, setRangeOpen] = createSignal(false, { ownedWrite: true });
const [rangeWanted, setRangeWanted] = createSignal(false, { ownedWrite: true });

export const sheets = {
  settingsOpen,
  settingsWanted,
  moreOpen,

  openSettings() {
    // One sheet at a time: settings called from the "more" menu replaces it.
    setMoreOpen(false);
    setSettingsWanted(true);
    setSettingsOpen(true);
  },
  closeSettings() {
    setSettingsOpen(false);
  },

  rangeOpen,
  rangeWanted,

  openRange() {
    // One sheet at a time: asked for from settings, it takes settings' place.
    setSettingsOpen(false);
    setMoreOpen(false);
    setRangeWanted(true);
    setRangeOpen(true);
  },
  closeRange() {
    setRangeOpen(false);
  },

  openMore() {
    setMoreOpen(true);
  },
  closeMore() {
    setMoreOpen(false);
  },
};
