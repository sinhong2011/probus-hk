import { Outlet, useNavigate, useRouterState } from "@tanstack/solid-router";
import { Errored, Loading } from "@solidjs/web";
import { Show, createEffect, createSignal, onCleanup } from "solid-js";
import type { JSX } from "@solidjs/web";
import { DbProvider } from "~/data/context";
import { RouteDbError } from "~/data/db";
import { AlertWatcher } from "~/components/AlertWatcher";
import { AppMark } from "~/components/AppMark";
import {
  BusIcon,
  CheckIcon,
  ChevronRightIcon,
  ClipboardIcon,
  DownloadCloudIcon,
  RefreshIcon,
  WarningIcon,
} from "~/components/Icons";
import { TabBar } from "~/components/TabBar";
import { Toaster } from "~/components/Toaster";
import { APP_VERSION, BUILD_SHA } from "~/lib/build";
import { t, type Lang } from "~/lib/i18n";
import { installTooltips } from "~/lib/tooltip";
import { installTrailEffects } from "~/stores/trail";
import { settings } from "~/stores/settings";

/** Shown while the ~1.7 MB route database loads on a cold, uncached start. */
function Splash() {
  return (
    <div class="flex min-h-dvh flex-col items-center justify-center gap-4 bg-background text-foreground">
      <div class="motion-safe:animate-[app-pulse_1.6s_ease-in-out_infinite]">
        <AppMark size={62} />
      </div>
      <span class="text-[0.88rem] font-semibold text-subtle-foreground">
        {t("loadingData", settings.lang())}
      </span>
    </div>
  );
}

/**
 * Best-effort description of whatever the boundary caught: the message, and
 * under it the first few frames of the stack, which is where the fix is.
 */
function describeError(err: () => unknown): string {
  try {
    const value = err();
    if (!(value instanceof Error)) return String(value);
    const head = `${value.name}: ${value.message}`;
    // Chrome repeats the message as the stack's first line; Firefox does not.
    const stack = value.stack ?? "";
    const frames = (stack.startsWith(head) ? stack.slice(head.length) : stack)
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, 8);
    return frames.length === 0 ? head : `${head}\n${frames.join("\n")}`;
  } catch (thrown) {
    return `error accessor threw: ${String(thrown)}`;
  }
}

/**
 * What actually went wrong, for whoever is going to fix it.
 *
 * Folded away by default: a rider does not need a stack trace, but the one
 * who reports the bug does, and "it broke" is not a report. The text wraps
 * rather than scrolling sideways - the frame that runs off the right edge is
 * the one that mattered - and one press copies the whole thing, version and
 * page included, so a report arrives with everything on it.
 */
function ErrorDetail(props: { text: string; lang: Lang; open?: boolean }) {
  const [copied, setCopied] = createSignal(false, { ownedWrite: true });
  let timer: number | undefined;
  onCleanup(() => clearTimeout(timer));

  const where = `${window.location.pathname}${window.location.search}`;
  const build = `v${APP_VERSION} · ${BUILD_SHA}`;
  const report = () => `${props.text}\n\n${build} · ${where}\n${navigator.userAgent}`;

  const copy = () => {
    void navigator.clipboard
      ?.writeText(report())
      .then(() => {
        setCopied(true);
        clearTimeout(timer);
        timer = window.setTimeout(() => setCopied(false), 2_000);
      })
      .catch(() => undefined);
  };

  return (
    <details class="group mt-8 w-full text-left" open={props.open}>
      <summary class="app-tap flex h-9 cursor-pointer list-none select-none items-center gap-1.5 rounded-lg px-2 text-[0.75rem] font-semibold text-faint-foreground [&::-webkit-details-marker]:hidden">
        <ChevronRightIcon
          size={12}
          class="transition-transform duration-state ease-out group-open:rotate-90"
        />
        {t("errorDetails", props.lang)}
      </summary>
      <div class="mt-1.5 overflow-hidden rounded-xl border border-border bg-card shadow-card">
        <pre class="app-scroll max-h-44 whitespace-pre-wrap px-3.5 py-3 font-mono text-[0.72rem] leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">
          {props.text}
        </pre>
        <div class="flex items-center justify-between gap-3 border-t border-border py-1.5 pl-3.5 pr-1.5">
          <span class="tnum truncate text-[0.7rem] font-medium text-faint-foreground">
            {build} · {where}
          </span>
          <button
            type="button"
            class="app-press flex h-7 shrink-0 items-center gap-1.5 rounded-lg bg-secondary px-2.5 text-[0.72rem] font-bold text-foreground"
            onClick={copy}
          >
            <Show when={copied()} fallback={<ClipboardIcon size={12} />}>
              <CheckIcon size={12} />
            </Show>
            {t(copied() ? "detailsCopied" : "copyDetails", props.lang)}
          </button>
        </div>
      </div>
    </details>
  );
}

/**
 * The screen when the app itself has broken.
 *
 * Not the data screen: that one counts down and retries on its own, because
 * a network that is not answering usually answers a moment later. A bug does
 * not - retrying it every five seconds is a loop, not a recovery - so this
 * screen says what happened in plain words, offers the two things that do
 * help (a clean reload, or the home screen if the broken one is the problem)
 * and puts the real cause where it can be copied into a report.
 */
function Crashed(props: { reset: () => void; detail: string }) {
  const lang = () => settings.lang();
  const navigate = useNavigate();

  const home = () => {
    void navigate({ to: "/" });
    props.reset();
  };

  return (
    <div class="flex min-h-dvh flex-col items-center justify-center bg-background px-6 py-16 text-center text-foreground">
      <div class="flex w-full max-w-sm flex-col items-center lg:max-w-md">
        <div class="flex size-14 items-center justify-center rounded-2xl bg-destructive/10 text-destructive lg:size-16">
          <WarningIcon size={24} />
        </div>

        <span class="mt-4 text-[1rem] font-bold lg:text-[1.13rem]">{t("crashTitle", lang())}</span>
        <span class="mt-1.5 text-[0.88rem] font-medium leading-relaxed text-subtle-foreground">
          {t("crashHint", lang())}
        </span>

        <div class="mt-6 flex items-center gap-2">
          <button
            type="button"
            class="app-press flex h-10 items-center gap-2 rounded-xl bg-primary px-5 text-[0.88rem] font-bold text-primary-foreground"
            onClick={() => window.location.reload()}
          >
            <RefreshIcon size={14} />
            {t("reload", lang())}
          </button>
          <button
            type="button"
            class="app-press flex h-10 items-center rounded-xl bg-secondary px-4 text-[0.88rem] font-bold text-foreground"
            onClick={home}
          >
            {t("goHome", lang())}
          </button>
        </div>

        <ErrorDetail text={props.detail} lang={lang()} open={import.meta.env.DEV} />
      </div>
    </div>
  );
}

/*
 * How many times running the database has refused to load, kept outside the
 * component because every failure mounts a fresh one. It decays: a rider who
 * got in, used the app and came back an hour later is on their first attempt
 * again, not their fifth.
 */
let attempts = 0;
let attemptedAt = 0;

/**
 * How long to wait before trying again: 5s, 10s, 20s, 40s, then a minute.
 *
 * Long enough not to hammer a source that is genuinely down, short enough that
 * a blip has fixed itself before a rider standing at a stop has looked up.
 */
function nextWait(): number {
  if (Date.now() - attemptedAt > 2 * 60_000) attempts = 0;
  attempts += 1;
  attemptedAt = Date.now();
  return Math.min(5 * 2 ** (attempts - 1), 60);
}

/**
 * The screen when the database will not load.
 *
 * It does the waiting itself. A rider who has hit this is standing somewhere
 * with a phone that is not working, and the last thing to ask of them is to
 * keep pressing a button: the app counts down and retries on its own, and the
 * moment the browser says a connection is back it goes without being asked -
 * so coming up out of a tunnel is enough, and the app is loaded by the time
 * the phone comes back out of a pocket.
 *
 * Being offline and being told no by a working connection are different
 * problems with different answers, so they are not given the same sentence.
 * Retry stays: it is the one thing a rider can do, and a countdown they cannot
 * skip is its own kind of rude.
 */
function LoadFailed(props: { reset: () => void; detail?: string }) {
  const lang = () => settings.lang();
  const wait = nextWait();

  /*
   * Written from timers and from browser events, which Solid 2 counts as an
   * owned scope; saying so here is the same declaration the app-wide stores
   * make.
   */
  const [online, setOnline] = createSignal(navigator.onLine, { ownedWrite: true });
  const [left, setLeft] = createSignal(wait, { ownedWrite: true });
  const [working, setWorking] = createSignal(false, { ownedWrite: true });

  const retry = () => {
    if (working()) return;
    setWorking(true);
    props.reset();
  };

  /*
   * There is nothing to retry against a dead network, so the countdown waits
   * with the rider instead of spending attempts on a request that cannot
   * leave the phone.
   */
  createEffect(
    () => online(),
    (connected) => {
      if (!connected) return;
      const timer = setInterval(() => {
        setLeft((n) => {
          if (n > 1) return n - 1;
          retry();
          return 0;
        });
      }, 1_000);
      return () => clearInterval(timer);
    },
  );

  let grace: number | undefined;
  const wentOnline = () => {
    setOnline(true);
    /*
     * A connection that has just come back is not always usable on its first
     * packet. The pause turns a retry that would have failed into one that
     * works, and gives the rider a moment to read that the network is back
     * rather than watching the screen change under them.
     */
    grace = window.setTimeout(retry, 800);
  };
  const wentOffline = () => setOnline(false);

  window.addEventListener("online", wentOnline);
  window.addEventListener("offline", wentOffline);
  onCleanup(() => {
    window.removeEventListener("online", wentOnline);
    window.removeEventListener("offline", wentOffline);
    clearTimeout(grace);
  });

  return (
    <div class="flex min-h-dvh flex-col items-center justify-center bg-background px-6 py-16 text-center text-foreground">
      <div class="flex w-full max-w-sm flex-col items-center lg:max-w-md">
        {/* The mark keeps breathing while the app is still trying, and stops
            being restless the moment it is actually working on something. */}
        <div
          class={[
            "flex size-14 items-center justify-center rounded-2xl bg-secondary text-subtle-foreground lg:size-16",
            { "motion-safe:animate-[app-pulse_2.4s_ease-in-out_infinite]": !working() },
          ]}
        >
          <Show when={online()} fallback={<DownloadCloudIcon size={24} />}>
            <BusIcon size={24} />
          </Show>
        </div>

        <span class="mt-4 text-[1rem] font-bold lg:text-[1.13rem]">
          {t(online() ? "dataError" : "offlineTitle", lang())}
        </span>
        <span class="mt-1.5 text-[0.88rem] font-medium leading-relaxed text-subtle-foreground">
          {t(online() ? "dataErrorHint" : "offlineHint", lang())}
        </span>

        <button
          type="button"
          class="app-press mt-6 flex h-10 items-center gap-2 rounded-xl bg-primary px-5 text-[0.88rem] font-bold text-primary-foreground disabled:opacity-70"
          disabled={working()}
          onClick={retry}
        >
          <span class={{ "app-spin": working() }}>
            <RefreshIcon size={14} />
          </span>
          {t(working() ? "retrying" : "retry", lang())}
        </button>

        {/*
         * What the app is doing while the rider is not doing anything. Both
         * states are on the row and readable without pressing or hovering
         * anything: either a countdown that will fire by itself, or the reason
         * there is no countdown to show.
         */}
        <div class="mt-3.5 flex h-5 items-center gap-1.5 text-[0.75rem] font-semibold text-faint-foreground">
          <Show
            when={online()}
            fallback={
              <>
                <span
                  class="size-1.5 rounded-full bg-faint-foreground motion-safe:animate-[app-pulse_1.6s_ease-in-out_infinite]"
                  aria-hidden="true"
                />
                {t("waitingForNetwork", lang())}
              </>
            }
          >
            <Show when={left() > 0 && !working()}>
              {t("retryAuto", lang())}
              <span class="tnum">· {left()}s</span>
            </Show>
          </Show>
        </div>

        {/* Developers get the real cause; riders get the plain message - a
            failed fetch has nothing more to tell them. */}
        <Show when={import.meta.env.DEV && props.detail}>
          {(detail) => <ErrorDetail text={detail()} lang={lang()} open />}
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
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  // The router holds a match in `pending` while its component chunk is still
  // in flight, which is exactly the wait this bar is for.
  const isRouting = useRouterState({
    select: (state) => state.isLoading || state.status === "pending",
  });
  let shell!: HTMLDivElement;

  /** Which screen a path belongs to - `/route/1+...` and `/route/1+...` are one. */
  const screen = (path: string) => {
    const first = path.split("/")[1] ?? "";
    /*
     * Searching and planning are two halves of one screen, and the switch
     * between them is a control sitting on it - not a way out of it. Replaying
     * the page-enter there faded the title, the switch the rider had just
     * pressed and both columns back in from nothing, which is what the whole
     * app reloading looks like.
     */
    return first === "plan" ? "search" : first;
  };

  createEffect(
    () => pathname(),
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
      shell.classList.remove("app-page-in");
      void shell.offsetWidth;
      shell.classList.add("app-page-in");
    },
  );

  return (
    <>
      <Show when={isRouting()}>
        <div class="pointer-events-none fixed inset-x-0 top-0 z-40 h-0.5 overflow-hidden">
          <div class="app-page-wait h-full bg-primary" />
        </div>
      </Show>

      <div
        ref={shell}
        // A named hook rather than a utility class: what the page shell is
        // styled with changes, that it is the page shell does not.
        data-page-shell
        /* No cap: the screens themselves decide what to do with a wide window -
           another column of cards, a wider map - and a shell that stopped at
           110rem simply left a margin down both sides of a large monitor. */
        class="w-full"
        // Cards inside the page animate too, and their events bubble; only the
        // shell's own animation should clear the class.
        onAnimationEnd={(event) => {
          if (event.target === shell) shell.classList.remove("app-page-in");
        }}
      >
        {props.children}
      </div>
    </>
  );
}

/**
 * Everything every screen sits inside.
 *
 * This is the router's root route, so it is mounted once and stays mounted:
 * the database is opened here rather than per screen, and the tab bar, the
 * reminder watcher and the toaster outlive whichever page is showing.
 */
export function Root() {
  // Inside the router, because it watches the location to remember which tab a
  // detail screen belongs to.
  installTrailEffects();

  // The document-level tooltip layer: installed once, for every screen.
  installTooltips();

  return (
    <Errored
      fallback={(err, reset) => (
        // The data not arriving is waited out; anything else is a bug.
        <Show
          when={err() instanceof RouteDbError}
          fallback={<Crashed reset={reset} detail={describeError(err)} />}
        >
          <LoadFailed reset={reset} detail={describeError(err)} />
        </Show>
      )}
    >
      <DbProvider>
        <Loading fallback={<Splash />}>
          {/*
            Each screen lays itself out: a single column on a phone, and on a
            wide screen either a card grid or a two-pane split, so the extra
            width carries more of the list instead of stretching every row
            across it.
          */}
          <div
            /* What a modal drawer scales back behind itself: the whole app,
               tab bar included, the way a phone treats its own sheets. */
            data-drawer-wrapper
            class={[
              "min-h-dvh bg-background text-foreground transition-[padding] duration-state ease-[var(--ease-spring)]",
              // The sidebar floats inset from the window, so the page clears
              // the panel and the gutter it sits in.
              settings.railOpen() ? "lg:pl-[15.75rem]" : "lg:pl-[5.25rem]",
            ]}
          >
            <PageShell>
              <Outlet />
            </PageShell>
            {/* Always present: it is how you get back out of a route or stop
                you drilled into. */}
            <TabBar lang={settings.lang()} />
            {/*
             * Reminders live above the screens rather than on one of them: an
             * alert armed on a route has to keep watching after the rider has
             * navigated away, which is the entire point.
             */}
            <AlertWatcher lang={settings.lang()} />
            <Toaster lang={settings.lang()} />
          </div>
        </Loading>
      </DbProvider>
    </Errored>
  );
}
