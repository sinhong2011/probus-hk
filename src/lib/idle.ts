/**
 * Run something once the browser has nothing better to do.
 *
 * `requestIdleCallback` where it exists; iOS Safari still lacks it, and
 * there a short timer is the nearest thing to "after the current work".
 * The deadline keeps a busy page honest: idle time may never come while a
 * list of forty rows is filling in, and work that must happen eventually
 * should not wait on it forever.
 */
export function whenIdle(fn: () => void, deadlineMs: number): () => void {
  if (typeof requestIdleCallback === "function") {
    const handle = requestIdleCallback(() => fn(), { timeout: deadlineMs });
    return () => cancelIdleCallback(handle);
  }
  const handle = window.setTimeout(fn, Math.min(deadlineMs, 300));
  return () => clearTimeout(handle);
}

/**
 * The same, but not before a moment has passed.
 *
 * "Idle" arrives the instant a screen has painted - before its entrance has
 * finished playing - so work that would stall the entrance has to be held
 * back by at least its length, and then wait for a quiet moment on top.
 */
export function whenIdleAfter(fn: () => void, notBeforeMs: number, deadlineMs: number): () => void {
  let cancelIdle: (() => void) | undefined;
  const timer = window.setTimeout(() => {
    cancelIdle = whenIdle(fn, deadlineMs);
  }, notBeforeMs);
  return () => {
    clearTimeout(timer);
    cancelIdle?.();
  };
}
