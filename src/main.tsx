import { render } from "@solidjs/web";
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
