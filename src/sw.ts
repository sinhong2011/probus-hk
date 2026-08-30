/// <reference lib="webworker" />
import {
  CacheFirst,
  ExpirationPlugin,
  NetworkFirst,
  Serwist,
  StaleWhileRevalidate,
  type PrecacheEntry,
  type SerwistGlobalConfig,
} from "serwist";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: [
    /**
     * The route database is the one thing that must survive going offline -
     * without it there is no app at all. It is served from cache immediately
     * and refreshed in the background; IndexedDB holds the parsed copy, this
     * just avoids re-downloading 1.7 MB.
     */
    {
      matcher: ({ url }) => url.hostname === "data.hkbus.app",
      handler: new StaleWhileRevalidate({
        cacheName: "mb-route-db",
        plugins: [new ExpirationPlugin({ maxEntries: 4, maxAgeSeconds: 7 * 24 * 60 * 60 })],
      }),
    },

    /**
     * The rail fare table: a quarter of a megabyte of station pairs that moves
     * about once a year. It is not precached - a rider who never prices a
     * train ride should not pay for it on install - but once it has been
     * fetched it stays, so the fare is still there in a tunnel.
     */
    {
      matcher: ({ url, sameOrigin }) => sameOrigin && url.pathname === "/rail-fares.json",
      handler: new StaleWhileRevalidate({
        cacheName: "mb-rail-fares",
        plugins: [new ExpirationPlugin({ maxEntries: 2, maxAgeSeconds: 30 * 24 * 60 * 60 })],
      }),
    },

    /**
     * Arrival times are worthless when stale, so they always try the network
     * first. The short cache exists only so a brief tunnel does not blank the
     * screen - and the UI still shows how old the reading is.
     */
    {
      matcher: ({ url }) =>
        url.hostname === "data.etabus.gov.hk" ||
        url.hostname === "rt.data.gov.hk" ||
        url.hostname === "data.etagmb.gov.hk",
      handler: new NetworkFirst({
        cacheName: "mb-eta",
        networkTimeoutSeconds: 6,
        plugins: [new ExpirationPlugin({ maxEntries: 120, maxAgeSeconds: 120 })],
      }),
    },

    // Route geometry never changes for a given route id.
    {
      matcher: ({ url }) => url.hostname === "hkbus.github.io",
      handler: new CacheFirst({
        cacheName: "mb-waypoints",
        plugins: [new ExpirationPlugin({ maxEntries: 60, maxAgeSeconds: 30 * 24 * 60 * 60 })],
      }),
    },

    // Vector tiles and glyphs: immutable, and expensive to refetch.
    {
      matcher: ({ url }) => url.hostname.endsWith("basemaps.cartocdn.com"),
      handler: new CacheFirst({
        cacheName: "mb-tiles",
        plugins: [new ExpirationPlugin({ maxEntries: 600, maxAgeSeconds: 30 * 24 * 60 * 60 })],
      }),
    },
  ],
});

serwist.addEventListeners();
