import { createRouter, useIsRouting, useLocation } from "@solidjs/router";
import { Errored, Loading } from "@solidjs/web";
import { Show, createEffect, lazy } from "solid-js";
import type { JSX } from "@solidjs/web";
import { DbProvider } from "~/data/context";
import { AppMark } from "~/components/AppMark";
import { TabBar } from "~/components/TabBar";
import { t } from "~/lib/i18n";
import { installClock } from "~/stores/clock";
import { installFrequentEffects } from "~/stores/frequent";
import { installSavedEffects } from "~/stores/saved";
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

const Router = createRouter({
  routes: [
    { path: "/", component: Nearby },
    { path: "/search", component: Search },
    { path: "/plan", component: Plan },
    { path: "/notices", component: Notices },
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
      <span class="text-[0.8rem] font-semibold text-subtle-foreground">
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

function LoadFailed(props: { reset: () => void; detail?: string }) {
  return (
    <div class="flex min-h-dvh flex-col items-center justify-center gap-4 bg-background px-10 text-center text-foreground">
      <span class="text-[0.9rem] font-bold">{t("dataError", settings.lang())}</span>
      <button
        class="rounded-lg bg-primary px-5 py-2.5 text-[0.8rem] font-bold text-primary-foreground"
        onClick={props.reset}
      >
        {t("retry", settings.lang())}
      </button>
      {/* Developers get the real cause; users get the plain message. */}
      <Show when={import.meta.env.DEV && props.detail}>
        <pre class="mt-2 max-w-full overflow-x-auto text-left text-[0.6rem] text-faint-foreground">
          {props.detail}
        </pre>
      </Show>
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

  createEffect(
    () => location.pathname,
    () => {
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
              fallback={(err, reset) => (
                <LoadFailed reset={reset} detail={describeError(err)} />
              )}
            >
            <DbProvider>
              <Loading fallback={<Splash />}>
                {/*
                  Each screen lays itself out: a single column on a phone, and
                  on a wide screen either a card grid or a two-pane split, so
                  the extra width carries more of the list instead of stretching
                  every row across it.
                */}
                <div class="min-h-dvh bg-background text-foreground lg:pl-22">
                  <PageShell>{route.children}</PageShell>
                  {/* Always present: it is how you get back out of a route or
                      stop you drilled into. */}
                  <TabBar lang={settings.lang()} />
                </div>
              </Loading>
            </DbProvider>
          </Errored>
        );
      }}
    </Router>
  );
}
