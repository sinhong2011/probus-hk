import { useLocation } from "@solidjs/router";
import { For, Show, createMemo } from "solid-js";
import { ChevronLeftIcon, ChevronRightIcon } from "./Icons";
import { CATEGORIES } from "~/data/categories";
import { useDb } from "~/data/context";
import { routeAt } from "~/data/db";
import { pick, t, type Lang } from "~/lib/i18n";
import { settings } from "~/stores/settings";
import { trail, type Crumb } from "~/stores/trail";
import type { RouteDb } from "~/data/types";

/**
 * The way back out of a detail screen, named rather than implied.
 *
 * A bare chevron says only "somewhere previous"; on a screen you may have
 * reached from the map, a search result or a bookmark, that is the one thing
 * worth saying. Each crumb is a real link to the place it names, so the trail
 * behaves the same whether you arrived by tapping, by a shared link, or by
 * reloading the page - unlike a history-based back, which does nothing at all
 * on a cold open.
 */
export function Breadcrumb(props: { crumbs: Crumb[] }) {
  return (
    <nav aria-label="breadcrumb" class="flex min-w-0 items-center gap-1">
      <For each={props.crumbs}>
        {(crumb, index) => (
          <>
            <Show when={index() > 0}>
              <span class="shrink-0 text-faint-foreground">
                <ChevronRightIcon size={11} />
              </span>
            </Show>

            <a
              href={crumb.href}
              class="mb-press flex h-8 min-w-0 shrink items-center gap-1 rounded-full bg-secondary pl-2 pr-3 text-[0.7rem] font-bold text-muted-foreground transition-colors duration-state active:text-foreground motion-safe:mb-rise"
            >
              <Show when={index() === 0}>
                <span class="shrink-0">
                  <ChevronLeftIcon size={13} />
                </span>
              </Show>
              <span class="truncate">{crumb.label}</span>
            </a>
          </>
        )}
      </For>
    </nav>
  );
}

/**
 * What to call a screen when it is behind you rather than in front of you.
 *
 * Returns null for anything that cannot be named usefully - a stop, whose name
 * would be as long as the crumb bar - so it drops out of the trail rather than
 * appearing as a blank.
 */
function labelFor(db: RouteDb, lang: Lang, path: string): string | null {
  if (path === "/browse") return t("categories", lang);

  if (path.startsWith("/browse/")) {
    const category = CATEGORIES.find((c) => c.id === path.slice("/browse/".length));
    return category ? pick(category.name, lang) : null;
  }

  if (path.startsWith("/route/")) {
    const route = routeAt(db, decodeURIComponent(path.slice("/route/".length)));
    return route ? `${t("routes", lang)} ${route.route}` : null;
  }

  return null;
}

/**
 * The whole trail for the screen you are on: the tab you left from, then every
 * named screen you passed through to get here.
 */
export function Trail(props: { extra?: Crumb[] }) {
  const db = useDb();
  const location = useLocation();
  const lang = settings.lang;

  const crumbs = createMemo<Crumb[]>(() => {
    const walked = trail
      .ancestors(location.pathname)
      .flatMap((path) => {
        const label = labelFor(db(), lang(), path);
        return label ? [{ href: path, label }] : [];
      });

    const all = [
      { href: trail.origin(), label: t(trail.originLabel(), lang()) },
      ...walked,
      // A parent that is true whatever the history says - a category page sits
      // under the category list even when you arrived by a shared link.
      ...(props.extra ?? []),
    ];

    /*
     * Deduped by label, keeping the most recent href: the two directions of one
     * route are different pages with the same name, and a trail reading
     * "路線 42 › 路線 42" says nothing except that you turned around. The crumb
     * should take you back to the direction you actually came through.
     */
    const byLabel = new Map<string, Crumb>();
    for (const crumb of all) byLabel.set(crumb.label, crumb);
    return [...byLabel.values()];
  });

  return <Breadcrumb crumbs={crumbs()} />;
}
