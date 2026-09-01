# Trip sun — design

A shade story for the ride ProBus already knows: this boarding stop, this
alighting stop, this departure. Not a walking-navigation app, and not a
percentage badge for a whole route.

## What the rider sees

One object, **行程日照**, with up to three chapters: wait, ride, walk. Copy is
a sentence, never “陰影 77%”, until a later occlusion pass has buildings.

- Ride chosen (board + alight): chip on the route-page ride band and on each
  plan-journey leg — “呢程 · 坐右邊窗”. A second line only when the sun
  clearly flips along the way.
- Board only: do not guess the whole route. Keep asking for the alight stop.
  Waiting at that kerb may still say whether this pavement is the sunny one.
- After sunset, or on heavy-rail MTR: omit. Overhead summer sun: “頭頂好曬，
  邊邊窗都差唔多” rather than a forced side.
- “右邊窗”, not “右邊”: Hong Kong doors are on the left.

## How it is counted (v1)

NOAA/Meeus solar azimuth and elevation, in Hong Kong wall-clock, sampled along
the published waypoint polyline between the two stops (stop-to-stop chords if
geometry is missing). Each sample is classified left / right / ahead / behind /
overhead / night from heading versus azimuth. The recommended window is the
side away from the sun for the majority of sunlit, non-overhead metres.

Waiting uses a Hong Kong kerb heuristic, not 3D yet: the stop sits on the left
of the moving bus, buildings behind it. Sun from the road side → this pavement
is exposed; sun from the building side → this pavement is the shadier guess.
Walk-after (plan only) is the bearing of the last-mile chord versus the sun:
walking into it or with it at your back.

## Opt-in

Off until asked for, like the vehicle markers. A setting under Display.

The offer is one note, shown only while the sun is high enough that the
feature would have something to say, and only once a ride (board and alight)
is actually chosen — the moment the advice would appear. A quiet banner sits
on that screen; a sheet follows after a short pause so it does not interrupt
the tap that chose the stop. Either “試吓” or closing it is remembered
(`trip-sun-offer`) and it never returns. Night, heavy-rail MTR, and a setting
already on all skip the offer. Settings remains the way back in.

## Honesty

v1 is sky geometry. It does not claim buildings, tunnels, or tree canopy. A
later pass feeds the same story object from tiled CSDI iB1000 heights and OSM
tunnel/covered/PTI polygons. Pedestrian alternatives for the walk chapter are
later still. Running loops and night CCTV routing are out.

## Files

- `src/lib/solar.ts` — position of the sun
- `src/data/tripSun.ts` — wait / ride / walk scoring and copy
- `src/data/useRouteShape.ts` — cached waypoints, shared with the map
- Ride band on `RouteDetail.tsx`, chips on `Plan.tsx`
- Plan clock: when the setting is on, score a picked Hong Kong wall-clock
  (default = next live bus). Night planning a morning ride is the point.
