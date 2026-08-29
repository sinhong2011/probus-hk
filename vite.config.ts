import { defineConfig } from "vitest/config";
import solid from "vite-plugin-solid";
import tailwindcss from "@tailwindcss/vite";
import Icons from "unplugin-icons/vite";
import { serwist } from "@serwist/vite";
import { paraglideVitePlugin } from "@inlang/paraglide-js";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";

/**
 * MapLibre 6 loads its tile-parsing Web Worker as a separate ESM file, resolved
 * at runtime from `import.meta.url`. A bundler that does not know to emit that
 * file leaves the worker 404ing - and because MapLibre waits for the worker
 * before requesting any tile, the map silently stays blank with no error.
 *
 * This serves the worker (and the shared chunk it imports) from a stable path
 * in dev and copies both into the build, so `setWorkerUrl` has something real
 * to point at.
 */
function maplibreWorker(): Plugin {
  const files = ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"];
  const from = (name: string) =>
    fileURLToPath(new URL(`./node_modules/maplibre-gl/dist/${name}`, import.meta.url));

  return {
    name: "motherbus:maplibre-worker",

    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const name = files.find((f) => req.url?.startsWith(`/maplibre/${f}`));
        if (!name) return next();
        res.setHeader("Content-Type", "text/javascript");
        res.end(readFileSync(from(name)));
      });
    },

    generateBundle() {
      for (const name of files) {
        this.emitFile({
          type: "asset",
          fileName: `maplibre/${name}`,
          source: readFileSync(from(name)),
        });
      }
    },
  };
}

/**
 * A dev server over HTTPS, when there is a certificate to serve it with.
 *
 * Geolocation, notifications and the service worker are all secure-context
 * features: they work on localhost, and stop working the moment the app is
 * opened from a phone on the same network over plain HTTP - which is exactly
 * where a transit app has to be tested. Run `npm run cert` once and the dev
 * server picks the pair up from here; without it, nothing changes.
 */
function devHttps() {
  const key = fileURLToPath(new URL("./.certs/dev-key.pem", import.meta.url));
  const cert = fileURLToPath(new URL("./.certs/dev.pem", import.meta.url));
  if (!existsSync(key) || !existsSync(cert)) return undefined;
  return { key: readFileSync(key), cert: readFileSync(cert) };
}

const https = devHttps();

/**
 * Which build this is, stamped in so the About screen can name itself.
 *
 * The release number moves once a release; the commit names the exact code a
 * rider is running, which is the half a bug report is actually worth. Static
 * hosts hand the sha over in an environment variable, a working copy has git
 * to ask, and a source tarball with neither still builds - it just says "dev".
 */
function buildSha(): string {
  const fromHost =
    process.env.VERCEL_GIT_COMMIT_SHA ??
    process.env.CF_PAGES_COMMIT_SHA ??
    process.env.COMMIT_REF ??
    process.env.GITHUB_SHA;
  if (fromHost) return fromHost.slice(0, 7);

  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], {
      stdio: ["ignore", "pipe", "ignore"],
      encoding: "utf8",
    }).trim();
  } catch {
    return "dev";
  }
}

const pkg = JSON.parse(
  readFileSync(fileURLToPath(new URL("./package.json", import.meta.url)), "utf8"),
) as { version: string };

export default defineConfig({
  server: {
    https,
    // Served over TLS it is worth reaching from a phone, which means binding
    // to more than loopback.
    host: https ? true : undefined,
  },
  plugins: [
    // Compiles messages/{locale}.json into tree-shakeable functions. Chosen over
    // a runtime i18n library because it has no framework coupling at all, which
    // matters on Solid 2 where the usual adapters still target Solid 1.
    paraglideVitePlugin({
      project: "./project.inlang",
      outdir: "./src/paraglide",
      strategy: ["localStorage", "preferredLanguage", "baseLocale"],
    }),
    solid(),
    tailwindcss(),
    // Inlines only the Lineicons actually imported, as Solid components.
    Icons({ compiler: "solid", autoInstall: false }),
    maplibreWorker(),
    serwist({
      swSrc: "src/sw.ts",
      swDest: "sw.js",
      globDirectory: "dist",
      /*
       * Scripts, styles, markup - and the one font file. Serwist precaches the
       * first three by default, which left an offline cold start painting the
       * whole app in a system fallback: the stylesheet was cached, the face it
       * asked for was not. Only the Latin subset is named; the extended one is
       * for words this app does not have, and Chinese comes from the device.
       */
      globPatterns: ["**/*.{js,css,html}", "**/*-latin-wght-normal-*.woff2"],
      injectionPoint: "self.__SW_MANIFEST",
      rollupFormat: "iife",
      // Only ship a worker in real builds; it would fight HMR in development.
      disable: process.env.NODE_ENV !== "production",
    }),
  ],
  resolve: {
    alias: { "~": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_SHA__: JSON.stringify(buildSha()),
  },
  build: { target: "es2022" },
  test: {
    // The unit suite covers pure logic - timetable maths, geometry, feed
    // parsing - so it runs in Node. Anything needing a real browser lives in
    // tests/e2e and is driven by Playwright instead.
    environment: "node",
    include: ["tests/unit/**/*.test.ts"],
    exclude: ["tests/e2e/**", "node_modules/**", "dist/**"],
  },
});
