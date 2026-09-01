# Walk rain + ride-sun map — design

Optional weather on the walk ProBus already draws, and a picture of the
chosen ride’s sun. Not a weather app, and not covered-path routing.

## Walk rain

Off until asked for. One setting, **行路避雨**.

When on, and Hong Kong is wet (any of the 18 HKO districts recorded rain in
the past hour, or a thunderstorm / rainstorm warning is up):

- A chip on the walk that already exists — Nearby’s walk minutes, the route
  map’s dotted line, Plan’s walk rows: “落緊雨 · 行去會濕” or the warning’s
  name. District rain at the rider (or the stop) is the chip; a warning
  without local millimetres still speaks.
- RainViewer radar tiles on the route map and the search/plan map, under the
  walk line. Dry sky: no overlay. RainViewer only publishes through z7, so
  the map overzooms that tile at street zoom rather than showing their
  "Zoom Level Not Supported" placeholder.

HKO `rhrread` and `warnsum` are fetched in the browser (open CORS). The
gridded 2-hour nowcast is not (no CORS, 2.7 MB). Tropical cyclone signals
alone are not rain.

The offer is one note, same shape as 行程日照: only while the setting is
off, not dismissed, a walk exists, and HK is wet. Banner then a sheet.
`walk-rain-offer`. Night with no rain stays quiet.

## Ride sun on the map

When 行程日照 is on and both stops are chosen, the published polyline
between them is overpainted: shade (recommended window is the dark one on
that stretch) vs sun (the recommended window is the bright one) vs overhead.
No percentages. Night stretches are omitted. The operator-coloured route
line stays underneath. The plan map paints the selected journey the same
way, at the same clock the chips use.

## Honesty

Sun chips keep a line “天空氣何，未計樓” until an occlusion pass exists.
Rain chips are district-hour rain, not “this street in eight minutes”.
