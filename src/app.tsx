import { QueryClientProvider } from "@tanstack/solid-query";
import { RouterProvider } from "@tanstack/solid-router";
import { installArrivalsEffects } from "~/data/arrivals";
import { installLiveEffects } from "~/data/live";
import { queryClient } from "~/lib/query";
import { router } from "~/router";
import { installAlertEffects } from "~/stores/alerts";
import { installClock } from "~/stores/clock";
import { installFrequentEffects } from "~/stores/frequent";
import { installSavedEffects } from "~/stores/saved";
import { installTripEffects } from "~/stores/trips";
import { installSettingsEffects } from "~/stores/settings";
import { installDismissedEffects } from "~/stores/dismissed";

/**
 * The app is the stores plus the router.
 *
 * Everything a rider accumulates - saved stops, armed reminders, the language
 * and refresh cadence, the shared one-second tick every countdown reads - is
 * installed once here, above the router, so it survives every navigation and
 * is already warm by the time the first screen asks for it. Every request
 * goes through one query cache, so two screens asking the same question share
 * one answer. The shell the screens sit inside is the router's root route; see
 * `~/routes/Root`.
 */
export function App() {
  installSettingsEffects();
  installDismissedEffects();
  installSavedEffects();
  installTripEffects();
  installAlertEffects();
  installFrequentEffects();
  installClock();
  installLiveEffects();
  installArrivalsEffects();

  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}
