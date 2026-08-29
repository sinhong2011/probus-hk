/**
 * Getting a rider's attention when the app is not the thing they are looking
 * at.
 *
 * Two channels, because neither is enough on its own. A system notification is
 * the only one that works with the phone in a pocket, but it needs a permission
 * the browser may refuse and iOS grants it only to an installed PWA. An in-app
 * banner always works and is useless once the screen is off. Every alert goes
 * to both, and the caller never has to know which one landed.
 */

export type NotifyPermission = "unsupported" | "default" | "granted" | "denied";

export function notifyPermission(): NotifyPermission {
  if (typeof Notification === "undefined") return "unsupported";
  return Notification.permission as NotifyPermission;
}

/**
 * Asks once, on a real gesture. Browsers ignore - and Safari penalises - a
 * request made on load, so this is only ever called from a button.
 */
export async function requestNotifyPermission(): Promise<NotifyPermission> {
  if (typeof Notification === "undefined") return "unsupported";
  if (Notification.permission !== "default") return Notification.permission as NotifyPermission;
  try {
    return (await Notification.requestPermission()) as NotifyPermission;
  } catch {
    return "denied";
  }
}

/**
 * Posts a system notification, preferring the service worker.
 *
 * `new Notification()` throws on Android Chrome for a page with a worker
 * registered, and a worker notification is the only kind that survives the tab
 * being closed - so the registration is asked first and the constructor is the
 * fallback for browsers that have no worker running.
 */
export async function systemNotify(title: string, body: string, tag: string): Promise<boolean> {
  if (notifyPermission() !== "granted") return false;

  const options: NotificationOptions = {
    body,
    tag,
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    // The whole point is to interrupt: an alert that is silently replaced by
    // the next one is an alert the rider never saw.
    renotify: true,
    requireInteraction: false,
  } as NotificationOptions;

  try {
    const registration = await navigator.serviceWorker?.getRegistration();
    if (registration) {
      await registration.showNotification(title, options);
      return true;
    }
  } catch {
    // Fall through to the constructor.
  }

  try {
    new Notification(title, options);
    return true;
  } catch {
    return false;
  }
}

/** A short double buzz - long enough to feel through a pocket, short enough
 *  not to be the thing a rider remembers about the app. */
export function buzz() {
  try {
    navigator.vibrate?.([120, 60, 120]);
  } catch {
    // Vibration is a nicety; a device that refuses it changes nothing.
  }
}
