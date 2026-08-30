import { useLocation } from "@tanstack/solid-router";
import { createEffect, createSignal } from "solid-js";
import type { MessageKey } from "~/lib/i18n";

/** Every path that is a tab, and the label the tab bar gives it. */
const TABS: Record<string, MessageKey> = {
  "/": "home",
  "/saved": "saved",
  "/search": "search",
  "/rail": "rail",
  "/notices": "notices",
  "/settings": "settings",
};

/**
 * Screens that always belong to a tab whatever the history says: planning and
 * browsing are two halves of searching, so they light that tab even on a cold
 * open from a shared link.
 */
const SECTIONS: [string, string][] = [
  ["/plan", "/search"],
  ["/browse", "/search"],
  // A line page belongs to the railway even on a cold open from a shared link.
  ["/rail/", "/rail"],
];

export interface Crumb {
  href: string;
  label: string;
}

/*
 * App-wide store, written from an effect on the location, so the writes have to
 * be declared intentional.
 */
const [origin, setOrigin] = createSignal<string>("/", { ownedWrite: true });
const [places, setPlaces] = createSignal<string[]>([], { ownedWrite: true });

/**
 * Where you are, and how you got there.
 *
 * A route or a stop is not a tab, so drilling into one used to leave the whole
 * navigation unlit and the way back unnamed. Two things are remembered: the tab
 * you left from, which gives every detail screen an owner for the tab bar, and
 * the screens you passed through, so a stop opened from a route can say so
 * instead of pretending you arrived from the tab directly.
 */
export const trail = {
  origin,
  originLabel: (): MessageKey => TABS[origin()] ?? "home",

  /** The screens between the tab and `pathname`, in the order you saw them. */
  ancestors: (pathname: string): string[] => {
    const seen = places();
    const at = seen.indexOf(pathname);
    return at >= 0 ? seen.slice(0, at) : seen;
  },

  /** True while the current screen belongs to this tab, directly or not. */
  owns: (href: string, pathname: string): boolean => {
    if (pathname in TABS) return pathname === href;
    const section = SECTIONS.find(([prefix]) => pathname.startsWith(prefix));
    if (section) return section[1] === href;
    return origin() === href;
  },

  isTab: (pathname: string): boolean => pathname in TABS,
};

export function installTrailEffects() {
  const location = useLocation();

  createEffect(
    () => location().pathname,
    (pathname) => {
      // Reaching a tab is arriving somewhere new: the trail behind you is spent.
      if (pathname in TABS) {
        setOrigin(pathname);
        setPlaces([]);
        return;
      }

      // Planning is the other half of searching rather than a step inside it,
      // so switching to it starts a fresh trail under the same tab.
      if (pathname === "/plan") {
        setOrigin("/search");
        setPlaces([]);
        return;
      }

      setPlaces((prev) => {
        const at = prev.indexOf(pathname);
        // Going back up a trail you already walked truncates it rather than
        // appending, so bouncing between two stops cannot grow it forever.
        if (at >= 0) return prev.slice(0, at + 1);
        return [...prev, pathname];
      });
    },
  );
}
