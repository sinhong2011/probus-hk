# MotherBus · 香港到站時間

Ad-free real-time arrivals for Hong Kong buses, minibuses, MTR, light rail and
ferries. No account, no tracking, no server of its own — the browser talks to
the operators' open data directly, and the whole route database is cached for
offline use.

## Deploy

[![Deploy to Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/sinhong2011/motherbus)
[![Deploy to Netlify](https://www.netlify.com/img/deploy/button.svg)](https://app.netlify.com/start/deploy?repository=https://github.com/sinhong2011/motherbus)
[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/sinhong2011/motherbus)

Each target is already configured in the repository, so the buttons need no
further settings:

| Target | Config | Build | Output |
| --- | --- | --- | --- |
| Vercel | `vercel.json` | `bun run build` | `dist` |
| Netlify | `netlify.toml` | `bun run build` | `dist` |
| Cloudflare Pages | `public/_redirects` | `bun run build` | `dist` |
| Docker | `Dockerfile`, `nginx.conf` | — | port 8080 |

All three static hosts need the same two things, and all three have them here: a
catch-all rewrite to `index.html`, because the router owns every path, and a
`no-cache` header on `sw.js`, because a held service worker is an app that can
never update.

### Docker

```sh
docker build -t motherbus .
docker run --rm -p 8080:8080 motherbus
```

Nothing runs at request time — it is static files behind nginx.

## Develop

Requires [Bun](https://bun.sh) 1.4.

```sh
bun install
bun run dev        # http://localhost:5173
bun run build      # production build into dist/
bun run preview    # serve that build
```

### Checks

```sh
bun run test       # unit tests
bun run e2e        # end-to-end, against the production build and the dev server
bunx tsc --noEmit  # types
```

The end-to-end suite runs twice: once against the built app, and once against
the dev server. The second pass exists because Solid's development-only guards
catch reactivity mistakes that are stripped from production — the kind that
blank the whole screen — and a suite that only tested the build missed them.

### Messages

Translations live in `messages/{zh,en}.json` and are compiled by Paraglide:

```sh
bun run messages
```

## How it works

- **Data** — the route, stop and fare database comes from
  [hkbus/hk-independent-bus-eta](https://github.com/hkbus/hk-independent-bus-eta)'s
  published dataset, cached in IndexedDB and revalidated by ETag. Arrival times
  come straight from each operator: KMB, Citybus, NLB, GMB, MTR heavy rail,
  light rail and MTR Bus, each with its own adapter under `src/data/eta/`.
- **Offline** — a Serwist service worker precaches the shell, holds the route
  database, and serves arrival times network-first with a short grace window so
  a tunnel does not blank the screen.
- **Reminders** — an arrival alert watches the feed and says when the bus is
  nearly at your stop; an alight reminder watches where you are and says when
  the stop you are riding to is close. Both go to a system notification and to
  an in-app banner, because neither channel is available everywhere. They live
  entirely in the browser: nothing is registered with a push service, so a
  reminder needs the tab to still be open.
- **Timetables** — where an operator publishes no live arrivals, or has stopped
  running for the night, departures are projected from the published frequency
  bands and labelled as estimates rather than passed off as live.

## Licence

Transport data belongs to its respective operators and to data.gov.hk under
their own terms.
