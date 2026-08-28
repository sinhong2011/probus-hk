import { render } from "@solidjs/web";
/*
 * IBM Plex Sans, weight axis only, self-hosted through Fontsource.
 *
 * The whole app is a number you read in a glance, and Plex is the grotesque
 * whose figures survive that: its 1 carries a flag and a foot, so 11 cannot be
 * mistaken for anything else at a bus stop. Google Fonts would cost a second
 * round trip to another origin before any text could paint, and would leave the
 * app dependent on that origin to look right offline.
 */
import "@fontsource-variable/ibm-plex-sans/wght.css";
import "./app.css";
import { App } from "./app";

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
