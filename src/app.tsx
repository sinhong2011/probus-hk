import { createRouter, useIsRouting, useLocation } from "@solidjs/router";
import { Errored, Loading } from "@solidjs/web";
import { Show, createEffect, lazy } from "solid-js";
import type { JSX } from "@solidjs/web";
import { DbProvider } from "~/data/context";
import { AlertWatcher } from "~/components/AlertWatcher";
import { AppMark } from "~/components/AppMark";
import { BusIcon, RefreshIcon } from "~/components/Icons";
import { TabBar } from "~/components/TabBar";
import { Toaster } from "~/components/Toaster";
import { t } from "~/lib/i18n";
import { installAlertEffects } from "~/stores/alerts";
import { installClock } from "~/stores/clock";
import { installFrequentEffects } from "~/stores/frequent";
import { installSavedEffects } from "~/stores/saved";
import { installTripEffects } from "~/stores/trips";
import { installSettingsEffects, settings } from "~/stores/settings";
import { installTrailEffects } from "~/stores/trail";

const Nearby = lazy(() => import("~/routes/Nearby"));
const Search = lazy(() => import("~/routes/Search"));
const Saved = lazy(() => import("~/routes/Saved"));
const Settings = lazy(() => import("~/routes/Settings"));
const RouteDetail = lazy(() => import("~/routes/RouteDetail"));
const StopDetail = lazy(() => import("~/routes/StopDetail"));
const Browse = lazy(() => import("~/routes/Browse"));
const Plan = lazy(() => import("~/routes/Plan"));
const Notices = lazy(() => import("~/routes/Notices"));
const Rail = lazy(() => import("~/routes/Rail"));
const RailLine = lazy(() => import("~/routes/RailLine"));

const Router = createRouter({
  routes: [
    { path: "/", component: Nearby },
    { path: "/search", component: Search },
    { path: "/plan", component: Plan },
    { path: "/notices", component: Notices },
    { path: "/rail", component: Rail },
    { path: "/rail/:code", component: RailLine },
    { path: "/browse", component: Browse },
    { path: "/browse/:id", component: Browse },
    { path: "/saved", component: Saved },
    { path: "/settings", component: Settings },
    { path: "/route/:key", component: RouteDetail },
    { path: "/stop/:id", component: StopDetail },
    { path: "*", component: Nearby },
  ],
});

/** Shown while the ~1.7 MB route database loads on a cold, uncached start. */
function Splash() {
  return (
    <div class="flex min-h-dvh flex-col items-center justify-center gap-4 bg-background text-foreground">
      <div class="motion-safe:animate-[mb-pulse_1.6s_ease-in-out_infinite]">
        <AppMark size={62} />
      </div>
      <span class="text-[0.88rem] font-semibold text-subtle-foreground">
        {t("loadingData", settings.lang())}
      </span>
    </div>
  );
}

/** Best-effort description of whatever the boundary caught. */
function describeError(err: () => unknown): string {
  try {
    const value = err();
    if (value instanceof Error) return `${value.name}: ${value.message}`;
    return String(value);
  } catch (thrown) {
    return `error accessor threw: ${String(thrown)}`;
  }
}

/**
 * The screen when the database will not load.
 *
 * Retry is the only thing a rider can do here, so it is the only thing that
 * looks like an action: one button directly under the sentence it answers,
 * sized like every other primary button in the app. The cause, when there is
 * one worth showing, is filed below the fold of the message rather than
 * wedged between the two - a stack trace should never come between someone
 * and the button that gets them out.
 */
function LoadFailed(props: { reset: () => void; detail?: string }) {
  return (
    <div class="flex min-h-dvh flex-col items-center justify-center bg-background px-6 py-16 text-center text-foreground">
      <div class="flex w-full max-w-sm flex-col items-center">
        <div class="flex size-14 items-center justify-center rounded-2xl bg-secondary text-subtle-foreground">
          <BusIcon size={24} />
        </div>

        <span class="mt-4 text-[1rem] font-bold">{t("dataError", settings.lang())}</span>
        <span class="mt-1.5 text-[0.88rem] font-medium leading-relaxed text-subtle-foreground">
          {t("dataErrorHint", settings.lang())}
        </span>

        <button
          type="button"
          class="mb-press mt-6 flex h-10 items-center gap-2 rounded-xl bg-primary px-5 text-[0.88rem] font-bold text-primary-foreground"
          onClick={props.reset}
        >
          <RefreshIcon size={14} />
          {t("retry", settings.lang())}
        </button>

        {/* Developers get the real cause; users get the plain message. */}
        <Show when={import.meta.env.DEV && props.detail}>
          <pre class="mt-10 max-w-full overflow-x-auto rounded-xl border border-border bg-card px-3.5 py-3 text-left text-[0.75rem] leading-relaxed text-faint-foreground">
            {props.detail}
          </pre>
        </Show>
      </div>
    </div>
  );
}

/**
 * The screen changing, and the wait before it can.
 *
 * Routes are code-split, so the first visit to one has to fetch it; without a
 * cue that is a second in which tapping a tab appears to have done nothing.
 * The bar creeps rather than filling, because the length of the download is not
 * something the app knows.
 */
function PageShell(props: { children: JSX.Element }) {
  const location = useLocation();
  const isRouting = useIsRouting();
  let shell!: HTMLDivElement;

  /** Which screen a path belongs to - `/route/1+...` and `/route/1+...` are one. */
  const screen = (path: string) => path.split("/")[1] ?? "";

  createEffect(
    () => location.pathname,
    (path, previous) => {
      /*
       * Only a change of screen animates. Swapping a route for its other
       * direction, or stepping from one stop to the next, is the same screen
       * showing different content - replaying the page-enter there made a
       * content update look like the whole app had reloaded.
       */
      if (previous !== undefined && screen(previous) === screen(path)) return;

      // A class already on the element does not replay, so it has to come off,
      // force a reflow, and go back on.
      shell.classList.remove("mb-page-in");
      void shell.offsetWidth;
      shell.classList.add("mb-page-in");
    },
  );

  return (
    <>
      <Show when={isRouting()}>
        <div class="pointer-events-none fixed inset-x-0 top-0 z-40 h-0.5 overflow-hidden">
          <div class="mb-page-wait h-full bg-primary" />
        </div>
      </Show>

      <div
        ref={shell}
        class="mx-auto w-full max-w-[110rem]"
        // Cards inside the page animate too, and their events bubble; only the
        // shell's own animation should clear the class.
        onAnimationEnd={(event) => {
          if (event.target === shell) shell.classList.remove("mb-page-in");
        }}
      >
        {props.children}
      </div>
    </>
  );
}

export function App() {
  installSettingsEffects();
  installSavedEffects();
  installTripEffects();
  installAlertEffects();
  installFrequentEffects();
  installClock();

  return (
    <Router>
      {(route) => {
        // Inside the router, because it watches the location to remember which
        // tab a detail screen belongs to.
        installTrailEffects();

        return (
          <Errored
            fallback={(err, reset) => <LoadFailed reset={reset} detail={describeError(err)} />}
          >
            <DbProvider>
              <Loading fallback={<Splash />}>
                {/*
                  Each screen lays itself out: a single column on a phone, and
                  on a wide screen either a card grid or a two-pane split, so
                  the extra width carries more of the list instead of stretching
                  every row across it.
                */}
                <div
                  class={[
                    "min-h-dvh bg-background text-foreground transition-[padding] duration-state ease-[var(--ease-spring)]",
                    // The sidebar floats inset from the window, so the page
                    // clears the panel and the gutter it sits in.
                    settings.railOpen() ? "lg:pl-[15.75rem]" : "lg:pl-[5.25rem]",
                  ]}
                >
                  <PageShell>{route.children}</PageShell>
                  {/* Always present: it is how you get back out of a route or
                      stop you drilled into. */}
                  <TabBar lang={settings.lang()} />
                  {/*
                   * Reminders live above the screens rather than on one of
                   * them: an alert armed on a route has to keep watching after
                   * the rider has navigated away, which is the entire point.
                   */}
                  <AlertWatcher lang={settings.lang()} />
                  <Toaster lang={settings.lang()} />
                </div>
              </Loading>
            </DbProvider>
          </Errored>
        );
      }}
    </Router>
  );
}
