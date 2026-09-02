import { render } from "@solidjs/web";
import "./app.css";
import { App } from "./app";
import { whenIdle } from "./lib/idle";

/*
 * `navigator.standalone` exists on iOS Safari and nowhere else, and is true
 * only for a home-screen app - exactly the case where the status bar is drawn
 * over the page and safe-area spacing has to account for it. Set before the
 * first render so no screen paints at the wrong offset.
 */
if ((navigator as Navigator & { standalone?: boolean }).standalone) {
  document.documentElement.dataset.iosStandalone = "";
}

const root = document.getElementById("root");
if (!root) throw new Error("#root is missing from index.html");

render(() => <App />, root);

/**
 * Registered after load so the worker never competes with the first paint or
 * the route database download, which is what the user is actually waiting for.
 *
 * When a new worker ships, `skipWaiting` in the worker activates it at once;
 * reloading here is what puts the new shell on screen. Without it an installed
 * PWA can keep running the precached bundle that was current when it was last
 * opened, which is how a fix on main can look missing in production.
 */
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  let reloading = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!reloading) return;
    reloading = false;
    window.location.reload();
  });

  const checkForWorker = () => {
    void navigator.serviceWorker.getRegistration().then((registration) => registration?.update());
  };

  window.addEventListener("load", () => {
    void navigator.serviceWorker
      .register("/sw.js")
      .then((registration) => {
        registration.addEventListener("updatefound", () => {
          const worker = registration.installing;
          // First install: no controller yet, so do not reload the page the
          // rider is already looking at.
          if (!worker || !navigator.serviceWorker.controller) return;
          worker.addEventListener("statechange", () => {
            if (worker.state === "activated") reloading = true;
          });
        });
        return registration.update();
      })
      .catch(() => {
        // An unavailable worker only costs offline support; the app still runs.
      });
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") checkForWorker();
  });
}

/*
 * The map is the one heavy thing in the app - a megabyte of MapLibre that
 * takes a good part of a second to parse on a phone - and it is only ever
 * wanted on a route page. Fetching and evaluating it here, once the first
 * screen is up and the browser is idle, means the tap that opens a route
 * pays for none of it. Skipped in tests so a warm-up never shadows a real
 * transition being measured.
 */
if (!import.meta.env.DEV || !navigator.webdriver) {
  window.addEventListener("load", () => {
    whenIdle(() => void import("./components/RouteMap"), 15_000);
  });
}
