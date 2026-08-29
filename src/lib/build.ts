/**
 * What this build is.
 *
 * Both values are substituted at build time (see `define` in the Vite config),
 * so they cost nothing at runtime and cannot drift from the bundle they are
 * printed on. The sha is what makes a bug report actionable - a rider reading
 * "0.1.0 · 2467892" off the About card names the exact code they are running.
 */
declare const __APP_VERSION__: string;
declare const __BUILD_SHA__: string;

export const APP_VERSION = __APP_VERSION__;

/** Short commit, or `dev` where the build had no repository to ask. */
export const BUILD_SHA = __BUILD_SHA__;

export const REPO_URL = "https://github.com/sinhong2011/probus-hk";
