import { render } from "@solidjs/web";
import "./app.css";
import { App } from "./app";
import { whenIdle } from "./lib/idle";

/*
 * `navigator.standalone` exists on iOS Safari and nowhere else, and is true
 * only for a home-screen app - exactly the case where the status bar is drawn
 * over the page and `pt-safe-top` has to reserve room for it. Set before the
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
 */
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // An unavailable worker only costs offline support; the app still runs.
    });
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
