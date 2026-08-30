import {
  createRootRoute,
  createRoute,
  createRouter,
  lazyRouteComponent,
} from "@tanstack/solid-router";
import { NotFound } from "~/routes/NotFound";
import { Root } from "~/routes/Root";

/*
 * Every screen is its own chunk. A rider who opens the app to see when the next
 * bus is should not be made to download the railway map, the journey planner
 * and the settings screen first, and on a phone on mobile data that is the
 * difference between a cold start that feels instant and one that does not.
 */
const lazyScreen = (load: () => Promise<unknown>) => lazyRouteComponent(load as never, "default");

/*
 * An address that means nothing gets a page that says so. It used to fall
 * through to the nearby screen, which was kinder in intent than in effect: a
 * rider following a stale link was shown a different screen with no word
 * about why, and a mistyped one looked like it had worked.
 */
const rootRoute = createRootRoute({ component: Root, notFoundComponent: () => <NotFound /> });

/** A search value the app wrote itself, read back defensively. */
const asText = (value: unknown): string | undefined =>
  typeof value === "string" && value !== "" ? value : undefined;

/** Same, for a value that is only ever a whole number. */
const asCount = (value: unknown): number | undefined => {
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
};

const nearbyRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: lazyScreen(() => import("~/routes/Nearby")),
});

const searchRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/search",
  component: lazyScreen(() => import("~/routes/Search")),
});

/*
 * Both halves of the search screen keep their endpoints in the URL, so a
 * planned journey survives a reload and can be sent to someone else.
 */
/*
 * Absent keys are left out rather than set to `undefined`. A search schema
 * that always names a key makes the key required, and every link to the
 * screen then has to spell out the endpoints it does not have.
 */
const endpointSearch = (search: Record<string, unknown>) => {
  const from = asText(search.from);
  const to = asText(search.to);
  return { ...(from !== undefined && { from }), ...(to !== undefined && { to }) };
};

const planRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/plan",
  validateSearch: endpointSearch,
  component: lazyScreen(() => import("~/routes/Plan")),
});

const noticesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/notices",
  component: lazyScreen(() => import("~/routes/Notices")),
});

const railRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/rail",
  validateSearch: endpointSearch,
  component: lazyScreen(() => import("~/routes/Rail")),
});

// Static before dynamic: `/rail/map` is the map, not a line whose code is
// "map". The router ranks it that way on its own, and listing it first says so.
const railMapRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/rail/map",
  component: lazyScreen(() => import("~/routes/RailMap")),
});

const railLineRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/rail/$code",
  component: lazyScreen(() => import("~/routes/RailLine")),
});

const browseRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/browse",
  component: lazyScreen(() => import("~/routes/Browse")),
});

const browseCategoryRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/browse/$id",
  component: lazyScreen(() => import("~/routes/Browse")),
});

const savedRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/saved",
  component: lazyScreen(() => import("~/routes/Saved")),
});

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings",
  component: lazyScreen(() => import("~/routes/Settings")),
});

const routeDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/route/$key",
  // Which stop along the route to open at, so a saved trip and a shared link
  // both land on the right row rather than the top of the list.
  validateSearch: (search: Record<string, unknown>) => {
    const stop = asCount(search.stop);
    return stop === undefined ? {} : { stop };
  },
  component: lazyScreen(() => import("~/routes/RouteDetail")),
});

const stopDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/stop/$id",
  component: lazyScreen(() => import("~/routes/StopDetail")),
});

const routeTree = rootRoute.addChildren([
  nearbyRoute,
  searchRoute,
  planRoute,
  noticesRoute,
  railRoute,
  railMapRoute,
  railLineRoute,
  browseRoute,
  browseCategoryRoute,
  savedRoute,
  settingsRoute,
  routeDetailRoute,
  stopDetailRoute,
]);

export const router = createRouter({
  routeTree,
  /*
   * Fetch a screen's chunk when a rider looks like they are about to ask for
   * it - a pointer settling on a tab, a finger landing on a row - so the tap
   * itself has nothing left to wait for. It is not an affordance and shows
   * nothing; a tap that never comes costs one cached chunk.
   */
  defaultPreload: "intent",
  // Top of the page for somewhere new, and back where you were when you go
  // back - which for a long list of stops is the whole point of going back.
  scrollRestoration: true,
});

declare module "@tanstack/solid-router" {
  interface Register {
    router: typeof router;
  }
}
