import { defineConfig } from "vitest/config";
import solid from "vite-plugin-solid";
import tailwindcss from "@tailwindcss/vite";
import Icons from "unplugin-icons/vite";
import { serwist } from "@serwist/vite";
import { paraglideVitePlugin } from "@inlang/paraglide-js";
import { readFileSync } from "node:fs";
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

export default defineConfig({
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
      injectionPoint: "self.__SW_MANIFEST",
      rollupFormat: "iife",
      // Only ship a worker in real builds; it would fight HMR in development.
      disable: process.env.NODE_ENV !== "production",
    }),
  ],
  resolve: {
    alias: { "~": fileURLToPath(new URL("./src", import.meta.url)) },
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
