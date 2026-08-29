# Changelog

Kept by [release-please](https://github.com/googleapis/release-please) from the
commits on `main`. The entry below was written by hand to open the file; every
entry after it is generated.

## [0.2.2](https://github.com/sinhong2011/probus-hk/compare/v0.2.1...v0.2.2) (2026-08-29)


### Bug Fixes

* show one arrival per stop row, and lift the sheet above the page on iOS ([#7](https://github.com/sinhong2011/probus-hk/issues/7)) ([9473e2b](https://github.com/sinhong2011/probus-hk/commit/9473e2b5fa071c3795962b6299f2cbb374c35110))

## [0.2.1](https://github.com/sinhong2011/probus-hk/compare/v0.2.0...v0.2.1) (2026-08-29)


### Bug Fixes

* pin the Solid packages to the versions the app was built against ([3af8b6f](https://github.com/sinhong2011/probus-hk/commit/3af8b6f32134e2088e9b8276855683ecd5cf5a86))

## 0.2.0

### The app has a name

**ProBus HK** in English, **撚手巴士hk** in Chinese — the wordmark, the install
name, the tab title and the share sheet all follow the language the rider has
chosen. The stored data does not: the bookmarks, reminders, trips, settings and
the cached route database keep their old keys, because renaming a key empties it
on every device that already has one.

### Features

- **Live buses on the route map.** Where the vehicles actually are, placed along
  the route shape and paced from the feed rather than the published timetable,
  with an honest line for every way that can fail — no feed, nothing running,
  a shape that does not match the stops.
- **Arrival and alight reminders.** Arm one on a stop and put the phone away;
  system notifications where the browser allows them.
- **Bookmarks that can be filed and sorted.** Groups the rider names on the
  spot, a filter above the list, and an order that outlives the visit.
- **A screen for every rail line**, off the rail index, with platforms and the
  trains in both directions from any station.
- **The ride you are already on.** Board and alight are picked on the stop list,
  and the band above it keeps the ride while the list scrolls.
- **An About card**: version, build, sources, and what stays on the device.
- **Searching and planning share one screen**, switched by a pill rather than
  split across two tabs.

### Foundations

- One motion scale, one type ramp, and a set of chrome primitives every screen
  is now built from.
- The route database and the arrival feeds answer what the screens ask of them,
  including the stop codes on the poles.

### Fixes

- The travelling pill no longer argues with the router over `data-active`, so
  the search/plan switch keeps its pill after a navigation.
- Switching between the search and plan halves no longer replays the page-enter
  animation, which read as the whole app reloading.
- A jump to a stop scrolls the list inside its card, not the card and the pane
  around it, and holds its aim while the opened stop is still filling in.
