import { QueryClient } from "@tanstack/solid-query";

/**
 * The one cache every request in the app goes through.
 *
 * It lives here rather than in a component so that code with no owner - the
 * operator adapters, the settings screen's "clear cache" button, a unit test -
 * can reach it. Components get the same instance through the provider.
 *
 * Retrying is off by default because the app is a poll: a failed arrival
 * request is retried by the next tick anyway, and a retry storm on top of
 * that is what a rider on a bad connection least needs. Structural sharing is
 * off because the data is full of `Date`s, which it cannot compare, so it
 * would deep-walk every response only to give up.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      structuralSharing: false,
    },
  },
});
