import { LngLatBounds, Map as MlMap, type ExpressionSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { FeatureCollection } from "geojson";
import { Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js";
import { MinusIcon, PinIcon, PlusIcon } from "~/components/Icons";
import { useDb } from "~/data/context";
import { fetchRouteShape, type Position } from "~/data/waypoints";
import type { Journey, Leg } from "~/data/planner";
import type { LatLng } from "~/lib/geo";
import { t, type Lang } from "~/lib/i18n";
import { whenIdleAfter } from "~/lib/idle";
import { measureLine, measureStops, sliceLine, stitchLines } from "~/lib/alongLine";
import {
  MAP_ACCENT,
  MAP_CONTROL,
  MAP_PRIMARY,
  MAP_STYLES,
  addFoldedAttribution,
  lineColour,
  prefersDark,
  upsertSource,
} from "~/lib/mapKit";
import { syncRainRadar } from "~/lib/mapRain";
import {
  clearSunRide,
  ensureSunRideLayer,
  SUN_OVERHEAD,
  SUN_SHADE,
  SUN_SUN,
  paintSunRide,
  sunRideCollection,
} from "~/lib/mapSun";
import { useWalkRain } from "~/data/useWalkRain";
import { now } from "~/stores/clock";
import { settings } from "~/stores/settings";

/**
 * The map under searching and planning: the canvas the results are drawn on.
 *
 * It is one map, not one per screen. Searching and planning are two halves of
 * one place - the mode switch between them says so - and a WebGL context, a
 * style and a first paint are a few hundred milliseconds of main thread that
 * should not be paid again for flicking the pill. So the MapLibre instance and
 * the element it paints into live at module level; each screen's component
 * adopts them into its own frame on the way in and lets go on the way out,
 * and the tiles a rider was just looking at are still there when they switch.
 *
 * What is drawn is declared, not commanded: pins for the places a search
 * matched, the journeys a plan found with the chosen one lit, the walking at
 * each end as a dotted line, and the rider's own position. The screens hand
 * those over as props and this component reconciles the sources - the same
 * shape RouteMap has, without the vehicles, because nothing here is moving.
 */

const SRC_PINS = "xp-pins";
const SRC_ME = "xp-me";
const SRC_LEGS = "xp-legs";
const SRC_WALKS = "xp-walks";
const SRC_SUN = "xp-sun-ride";
const LYR_PIN_HIT = "xp-pin-hit";
const LYR_LEG_HIT = "xp-leg-hit";
const LYR_SUN = "xp-sun-ride";

/** A place the search matched, or an end of the journey being planned. */
export interface ExplorePin {
  id: string;
  name: string;
  location: LatLng;
  /** An origin is hollow, a destination is lit; a plain match is a dot. */
  kind: "stop" | "origin" | "destination";
}

/** The two ends of a plan, for the walking lines and the framing. */
export interface ExploreEnds {
  from: LatLng | null;
  to: LatLng | null;
}

/**
 * One shared stage: the instance, the element it owns, and the theme it was
 * built for - a style swap is a rebuild, so the theme is part of its identity.
 */
interface Stage {
  instance: MlMap;
  host: HTMLDivElement;
  dark: boolean;
}

let stage: Stage | null = null;

/**
 * Route geometry, fetched once per route and kept for the session. A plan
 * redraws its journeys on every keystroke of a new destination, and the
 * shapes weigh hundreds of kilobytes - refetching them per redraw would be
 * paying the whole cost of the map for every letter typed.
 */
const shapeCache = new Map<string, Position[][] | null>();
const shapeInFlight = new Map<string, Promise<Position[][] | null>>();

function routeShape(key: string, load: () => Promise<Position[][] | null>) {
  if (shapeCache.has(key)) return shapeCache.get(key) ?? null;
  if (!shapeInFlight.has(key)) {
    shapeInFlight.set(
      key,
      load()
        .then((lines) => {
          shapeCache.set(key, lines);
          return lines;
        })
        .catch(() => {
          shapeCache.set(key, null);
          return null;
        })
        .finally(() => shapeInFlight.delete(key)),
    );
  }
  return null;
}

const point = (at: LatLng): Position => [at.lng, at.lat];

/**
 * The ride of one leg, as a line on the map.
 *
 * The honest fallback is the chain of its own stops, available synchronously;
 * once the route's published geometry has arrived the chain is replaced by the
 * slice of the real road between boarding and alighting. A slice, not the
 * whole line: a plan's answer is "ride from here to here", and drawing the
 * rest of the route makes every alternative look like it goes everywhere.
 */
function legLine(stops: Position[], leg: Leg, shape: Position[][] | null): Position[] {
  const chain = stops.slice(leg.boardSeq - 1, leg.alightSeq);
  if (!shape) return chain;
  const measured = measureLine(stitchLines(shape));
  const at = measureStops(measured, stops);
  if (!at) return chain;
  const from = at.measures[leg.boardSeq - 1];
  const to = at.measures[leg.alightSeq - 1];
  if (from === undefined || to === undefined || to <= from) return chain;
  return sliceLine(at.line, from, to);
}

/** Every stop of the leg's route, in the operator's own order. */
function legStops(
  stopList: Record<string, { location: LatLng } | undefined>,
  leg: Leg,
): Position[] {
  const ids = leg.route.stops[leg.co] ?? [];
  const positions: Position[] = [];
  for (const id of ids) {
    const stop = stopList[id];
    if (stop) positions.push(point(stop.location));
  }
  return positions;
}

const EMPTY: FeatureCollection = { type: "FeatureCollection", features: [] };

function buildStage(dark: boolean): Stage {
  const host = document.createElement("div");
  /*
   * Inline, not a class: MapLibre's stylesheet puts `position: relative` on
   * its own container, which beats a class of the same specificity and left
   * the host zero pixels tall inside its frame. An inline style outranks it.
   */
  host.style.position = "absolute";
  host.style.inset = "0";
  const instance = new MlMap({
    container: host,
    style: dark ? MAP_STYLES.dark : MAP_STYLES.light,
    center: [114.17, 22.31],
    zoom: 10,
    // Added below instead, so it sits bottom-left clear of the sheet's corner.
    attributionControl: false,
    dragRotate: false,
    // See RouteMap: a symbol cross-fade keeps the render loop hot for nothing.
    fadeDuration: 0,
    /*
     * The stage is a primary surface, but on a 3x phone the device's own
     * ratio is nine canvases of pixels for one of picture. Two is where the
     * labels stop being visibly soft and the GPU stops visibly paying.
     */
    pixelRatio: Math.min(window.devicePixelRatio, 2),
    /*
     * No two-finger rule here. The map on a route page sits in a scrolling
     * list and must not swallow its drags; this one is the screen's canvas
     * with the list floating over it, and a finger on the map means the map.
     */
  });
  addFoldedAttribution(instance);
  return { instance, host, dark };
}

/**
 * The furniture, added once per stage: empty sources and the layers that
 * read them, in back-to-front order - journeys under pins under the rider.
 * Everything after this is `setData`, which is what keeps a keystroke from
 * costing a layer teardown.
 */
function ensureLayers(instance: MlMap, dark: boolean) {
  if (instance.getLayer("xp-me-dot")) return;

  for (const id of [SRC_LEGS, SRC_WALKS, SRC_SUN, SRC_PINS, SRC_ME]) {
    if (!instance.getSource(id)) instance.addSource(id, { type: "geojson", data: EMPTY });
  }

  const primary = dark ? MAP_PRIMARY.dark : MAP_PRIMARY.light;
  const surface = dark ? "#0c0f14" : "#ffffff";
  const ink = dark ? "#b9c0cc" : "#4a5160";

  const selected: ExpressionSpecification = ["==", ["get", "selected"], 1];

  /*
   * Every alternative is drawn and the chosen one is lit: dimmed lines are
   * the other answers still on offer, and tapping one is how it is chosen.
   * The casing goes under the lit line only - an outline on every dimmed
   * alternative turned the harbour into a wiring diagram.
   */
  instance.addLayer({
    id: "xp-leg-casing",
    type: "line",
    source: SRC_LEGS,
    layout: { "line-cap": "round", "line-join": "round" },
    filter: ["==", ["get", "selected"], 1],
    paint: {
      "line-color": "#000000",
      "line-opacity": 0.35,
      "line-width": ["interpolate", ["linear"], ["zoom"], 10, 6, 16, 10],
    },
  });
  instance.addLayer({
    id: "xp-leg-line",
    type: "line",
    source: SRC_LEGS,
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-color": ["get", "colour"],
      "line-opacity": ["case", selected, 1, 0.3],
      "line-width": [
        "interpolate",
        ["linear"],
        ["zoom"],
        10,
        ["case", selected, 3.5, 2.5],
        16,
        ["case", selected, 6, 4],
      ],
    },
  });
  /*
   * The chosen ride's sun, over the operator colour: shade vs sun vs
   * overhead, no percentages. Empty until 行程日照 is on and a ride exists.
   */
  instance.addLayer({
    id: LYR_SUN,
    type: "line",
    source: SRC_SUN,
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-color": ["match", ["get", "tone"], "shade", SUN_SHADE, "sun", SUN_SUN, SUN_OVERHEAD],
      "line-width": ["interpolate", ["linear"], ["zoom"], 10, 3.5, 16, 7],
      "line-opacity": 0.9,
    },
  });
  /*
   * The walking is part of the journey and drawn as what it is: a dotted
   * run in no operator's colour, from door to kerb, kerb to kerb, kerb to
   * door. Only the chosen journey's - see the data effect.
   */
  instance.addLayer({
    id: "xp-walk-line",
    type: "line",
    source: SRC_WALKS,
    layout: { "line-cap": "round" },
    paint: {
      "line-color": ink,
      "line-width": 2.5,
      "line-dasharray": [0.1, 2],
      "line-opacity": 0.9,
    },
  });
  // A line four pixels wide is nothing to aim a thumb at; this invisible
  // band over every alternative is what actually takes the tap.
  instance.addLayer({
    id: LYR_LEG_HIT,
    type: "line",
    source: SRC_LEGS,
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-width": 22, "line-opacity": 0 },
  });

  /*
   * Pins. A matched stop is a dot in the app's own colour; the plan's origin
   * is a hollow ring - the same mark the planner's gutter draws - and its
   * destination the lit disc the journey is aimed at.
   */
  const origin: ExpressionSpecification = ["==", ["get", "kind"], "origin"];
  const destination: ExpressionSpecification = ["==", ["get", "kind"], "destination"];
  instance.addLayer({
    id: "xp-pin-halo",
    type: "circle",
    source: SRC_PINS,
    filter: ["==", ["get", "kind"], "destination"],
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 11, 12, 16, 17],
      "circle-color": primary,
      "circle-opacity": 0.18,
      "circle-blur": 0.4,
    },
  });
  instance.addLayer({
    id: "xp-pin-dot",
    type: "circle",
    source: SRC_PINS,
    paint: {
      "circle-radius": [
        "interpolate",
        ["linear"],
        ["zoom"],
        11,
        ["case", destination, 7, 5],
        16,
        ["case", destination, 9, 7],
      ],
      "circle-color": ["case", origin, surface, primary],
      "circle-stroke-color": ["case", origin, ink, surface],
      "circle-stroke-width": 2.5,
    },
  });
  instance.addLayer({
    id: LYR_PIN_HIT,
    type: "circle",
    source: SRC_PINS,
    paint: { "circle-radius": 16, "circle-color": "rgba(0,0,0,0)" },
  });
  /*
   * Every pin says its name; MapLibre drops the ones that would collide, and
   * the ends of a journey win that contest - they are what the map is about.
   */
  instance.addLayer({
    id: "xp-pin-label",
    type: "symbol",
    source: SRC_PINS,
    layout: {
      "text-field": ["get", "name"],
      "text-size": ["case", ["==", ["get", "kind"], "stop"], 10.5, 11.5],
      "text-variable-anchor": ["top"],
      "text-radial-offset": 0.9,
      "text-justify": "center",
      "text-max-width": 8,
      "text-padding": 4,
      "symbol-sort-key": ["case", ["==", ["get", "kind"], "stop"], 2, 0],
    },
    paint: {
      "text-color": ["case", ["==", ["get", "kind"], "stop"], ink, primary],
      "text-halo-color": dark ? "#000000" : "#ffffff",
      "text-halo-width": 1.6,
    },
  });

  instance.addLayer({
    id: "xp-me-halo",
    type: "circle",
    source: SRC_ME,
    paint: { "circle-radius": 17, "circle-color": MAP_ACCENT, "circle-opacity": 0.16 },
  });
  instance.addLayer({
    id: "xp-me-dot",
    type: "circle",
    source: SRC_ME,
    paint: {
      "circle-radius": 7,
      "circle-color": MAP_ACCENT,
      "circle-stroke-color": "#0c0f14",
      "circle-stroke-width": 2.5,
    },
  });
}

export function ExploreMap(props: {
  lang: Lang;
  me?: LatLng | null;
  /** Places to mark - search matches, or the two ends of a plan. */
  pins?: ExplorePin[];
  /** The journeys a plan found, every one drawn, one of them lit. */
  journeys?: Journey[];
  selectedId?: string | null;
  /** The plan's own ends, for the walking lines and the framing. */
  ends?: ExploreEnds;
  /**
   * When 行程日照 is on, the clock the chosen ride is coloured at. Null
   * means the next live bus, same as the chips — scored as now until an
   * ETA arrives.
   */
  sunAt?: Date | null;
  onSelectPin?: (id: string) => void;
  onSelectJourney?: (id: string) => void;
  /**
   * Pin-drop mode, the way a maps app picks a place: a pin stands fixed over
   * the visible centre and the map is dragged underneath it. The pin lifts
   * while the map moves and settles when it stops - the map is what the
   * hand is holding, not the pin.
   */
  pinned?: boolean;
  /**
   * The place under the pin's tip, reported whenever the map comes to rest.
   * "Visible centre" accounts for the sheet: the pin stands in the middle of
   * the part of the canvas a rider can actually see.
   */
  onViewChange?: (at: LatLng) => void;
  /**
   * The share of the frame's height a sheet rests over, kept clear when the
   * map frames something - what it frames has to land in the part of the
   * canvas a rider can actually see.
   */
  insetFraction?: number;
}) {
  const db = useDb();
  let frame!: HTMLDivElement;

  const rain = useWalkRain(() => ({
    at: props.me ?? props.ends?.from ?? null,
    hasWalk: (props.journeys?.length ?? 0) > 0,
  }));

  const [map, setMap] = createSignal<MlMap | null>(null);
  /** See RouteMap: WebGL is not everywhere, and a black rectangle says nothing. */
  const [usable, setUsable] = createSignal<boolean | null>(null);
  /** Bumped when a fetched shape lands, so drawn journeys pick it up. */
  const [shapesAt, setShapesAt] = createSignal(0, { ownedWrite: true });

  /*
   * Built after the screen has arrived, exactly as the route map is: the list
   * is what a rider came for and it paints first; the map fills its frame
   * once the entrance has played out and the browser has a moment.
   */
  const [settled, setSettled] = createSignal(false, { ownedWrite: true });
  onCleanup(whenIdleAfter(() => setSettled(true), 320, 1_000));

  createEffect(
    () => (settled() ? prefersDark(settings.theme()) : null),
    (dark) => {
      if (dark === null) return;

      // A theme is a style and a style swap is a rebuild; the stage that was
      // kept for the last screen is only kept while it still matches.
      if (stage && stage.dark !== dark) {
        stage.instance.remove();
        stage = null;
      }
      const adopted = stage !== null;
      if (!stage) stage = buildStage(dark);
      const { instance, host } = stage;

      frame.appendChild(host);

      const ready = () => {
        ensureLayers(instance, dark);
        // The host may have been measured in the last screen's frame, or in
        // no frame at all.
        instance.resize();
        setUsable(true);
        setMap(instance);
      };
      if (adopted) ready();
      else instance.once("load", ready);

      const giveUp = window.setTimeout(() => setUsable((v) => v ?? false), 6_000);

      // The frame's size follows the window and the shell around it; the
      // canvas only follows the frame when told.
      const watch =
        typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => instance.resize());
      watch?.observe(frame);

      return () => {
        clearTimeout(giveUp);
        watch?.disconnect();
        setMap(null);
        /*
         * Let go, do not tear down: the stage outlives the screen so the next
         * one adopts it warm. Detach only if the host is still ours - by the
         * time this cleanup runs, the next screen may already have taken it.
         */
        if (stage && stage.host.parentElement === frame) stage.host.remove();
      };
    },
  );

  createEffect(
    () => ({ instance: map(), tiles: rain()?.tiles ?? null }),
    ({ instance, tiles }) => {
      if (!instance) return;
      const before = instance.getLayer("xp-leg-casing") ? "xp-leg-casing" : undefined;
      syncRainRadar(instance, tiles, before);
    },
  );

  // The taps, bound per screen: the singleton outlives any one screen's
  // callbacks, so the handlers are registered on the way in and taken off on
  // the way out rather than baked into the stage.
  createEffect(
    () => map(),
    (instance) => {
      if (!instance) return;

      const pickPin = (event: { features?: { properties?: { id?: unknown } }[] }) => {
        const id = event.features?.[0]?.properties?.id;
        if (typeof id === "string") props.onSelectPin?.(id);
      };
      const pickLeg = (event: { features?: { properties?: { journey?: unknown } }[] }) => {
        const id = event.features?.[0]?.properties?.journey;
        if (typeof id === "string") props.onSelectJourney?.(id);
      };
      const finger = () => {
        instance.getCanvas().style.cursor = "pointer";
      };
      const rest = () => {
        instance.getCanvas().style.cursor = "";
      };

      instance.on("click", LYR_PIN_HIT, pickPin);
      instance.on("click", LYR_LEG_HIT, pickLeg);
      for (const layer of [LYR_PIN_HIT, LYR_LEG_HIT]) {
        instance.on("mouseenter", layer, finger);
        instance.on("mouseleave", layer, rest);
      }
      return () => {
        instance.off("click", LYR_PIN_HIT, pickPin);
        instance.off("click", LYR_LEG_HIT, pickLeg);
        for (const layer of [LYR_PIN_HIT, LYR_LEG_HIT]) {
          instance.off("mouseenter", layer, finger);
          instance.off("mouseleave", layer, rest);
        }
      };
    },
  );

  /*
   * Where the pin's tip is: the centre of the visible canvas, which is not
   * the centre of the map while a sheet rests over its foot. Reported when
   * the map comes to rest, not on every frame - the nearest-stop lookup the
   * planner runs on it walks every stop there is.
   */
  const [lifted, setLifted] = createSignal(false, { ownedWrite: true });
  const underPin = (instance: MlMap): LatLng => {
    const inset = props.insetFraction ?? 0;
    const point = instance.unproject([
      frame.clientWidth / 2,
      (frame.clientHeight * (1 - inset)) / 2,
    ]);
    return { lat: point.lat, lng: point.lng };
  };

  createEffect(
    () => ({ instance: map(), wanted: Boolean(props.pinned) }),
    ({ instance, wanted }) => {
      if (!instance || !wanted) return;

      const lift = () => setLifted(true);
      const rest = () => {
        setLifted(false);
        props.onViewChange?.(underPin(instance));
      };
      instance.on("movestart", lift);
      instance.on("moveend", rest);
      // Where the pin already stands counts as its first answer.
      props.onViewChange?.(underPin(instance));

      /*
       * A pin over a whole-territory view points at nothing anyone means.
       * Entered from far out, the camera comes down to street level - at the
       * rider, or failing that at an end already chosen - and a rider who was
       * already reading streets keeps the view they were reading.
       */
      if (instance.getZoom() < 13) {
        const start = props.me ?? props.ends?.from ?? props.ends?.to;
        instance.easeTo({
          ...(start ? { center: point(start) } : {}),
          zoom: 15,
          padding: framePadding(),
          duration: still() ? 0 : 500,
        });
      }

      return () => {
        setLifted(false);
        instance.off("movestart", lift);
        instance.off("moveend", rest);
      };
    },
  );

  // The rider's own position, its own source so it moves without touching
  // anything else.
  createEffect(
    () => ({ instance: map(), me: props.me ?? null }),
    ({ instance, me }) => {
      if (!instance) return;
      upsertSource(instance, SRC_ME, {
        type: "FeatureCollection",
        features: me
          ? [
              {
                type: "Feature",
                properties: {},
                geometry: { type: "Point", coordinates: point(me) },
              },
            ]
          : [],
      });
    },
  );

  createEffect(
    () => ({ instance: map(), pins: props.pins ?? [] }),
    ({ instance, pins }) => {
      if (!instance) return;
      upsertSource(instance, SRC_PINS, {
        type: "FeatureCollection",
        features: pins.map((pin) => ({
          type: "Feature",
          properties: { id: pin.id, name: pin.name, kind: pin.kind },
          geometry: { type: "Point", coordinates: point(pin.location) },
        })),
      });
    },
  );

  /** Every leg's line, chains first, upgraded as the real roads arrive. */
  const legLines = createMemo(() => {
    shapesAt();
    const journeys = props.journeys ?? [];
    const stopList = db().stopList;
    return journeys.map((journey) => ({
      journey,
      legs: journey.legs.map((leg) => {
        const shape = routeShape(leg.route.key, () =>
          fetchRouteShape(leg.route).then((lines) => {
            // Landed after this pass: redraw with the road instead of the chain.
            setShapesAt((n) => n + 1);
            return lines;
          }),
        );
        return {
          leg,
          colour: lineColour(leg.route),
          line: legLine(legStops(stopList, leg), leg, shape),
        };
      }),
    }));
  });

  createEffect(
    () => ({
      instance: map(),
      drawn: legLines(),
      selectedId: props.selectedId ?? null,
      ends: props.ends ?? null,
    }),
    ({ instance, drawn, selectedId, ends }) => {
      if (!instance) return;

      const legs: FeatureCollection["features"] = [];
      const walks: FeatureCollection["features"] = [];

      // Unchosen first, chosen last, so the lit journey draws over the dim ones.
      const ordered = [...drawn].sort(
        (a, b) => Number(a.journey.id === selectedId) - Number(b.journey.id === selectedId),
      );

      for (const { journey, legs: parts } of ordered) {
        const lit = journey.id === selectedId;
        for (const part of parts) {
          if (part.line.length < 2) continue;
          legs.push({
            type: "Feature",
            properties: { journey: journey.id, colour: part.colour, selected: lit ? 1 : 0 },
            geometry: { type: "LineString", coordinates: part.line },
          });
        }
        if (!lit) continue;

        /*
         * The walking, chosen journey only: each dotted run joins where you
         * are to where you board, alighting to reboarding, alighting to where
         * you are going. Drawn for every journey it was a cobweb.
         */
        const stitches: [LatLng | null | undefined, LatLng | null | undefined][] = [];
        const first = journey.legs[0];
        const last = journey.legs[journey.legs.length - 1];
        if (first) stitches.push([ends?.from, first.boardStop.location]);
        for (let i = 1; i < journey.legs.length; i += 1) {
          stitches.push([
            journey.legs[i - 1]?.alightStop.location,
            journey.legs[i]?.boardStop.location,
          ]);
        }
        if (last) stitches.push([last.alightStop.location, ends?.to]);
        for (const [a, b] of stitches) {
          if (!a || !b) continue;
          walks.push({
            type: "Feature",
            properties: {},
            geometry: { type: "LineString", coordinates: [point(a), point(b)] },
          });
        }
      }

      upsertSource(instance, SRC_LEGS, { type: "FeatureCollection", features: legs });
      upsertSource(instance, SRC_WALKS, { type: "FeatureCollection", features: walks });
    },
  );

  /*
   * The lit journey's first outdoor ride, coloured the same way the route
   * map colours a chosen stretch. Night and mixed stay unpainted. The clock
   * is the one the chips use, so the picture matches the sentence.
   */
  createEffect(
    () => ({
      instance: map(),
      drawn: legLines(),
      selectedId: props.selectedId ?? null,
      at: props.sunAt ?? new Date(now()),
      enabled: settings.tripSun(),
    }),
    ({ instance, drawn, selectedId, at, enabled }) => {
      if (!instance) return;
      ensureSunRideLayer(instance, SRC_SUN, LYR_SUN, "xp-walk-line");
      if (!enabled || !selectedId) {
        clearSunRide(instance, SRC_SUN);
        return;
      }
      const chosen = drawn.find((entry) => entry.journey.id === selectedId);
      const first = chosen?.legs[0];
      if (!first || first.leg.route.co[0] === "mtr" || first.line.length < 2) {
        clearSunRide(instance, SRC_SUN);
        return;
      }
      const line = measureLine(first.line);
      paintSunRide(
        instance,
        SRC_SUN,
        sunRideCollection({
          line,
          from: 0,
          to: line.length,
          departAt: at,
          arriveAt: new Date(at.getTime() + first.leg.minutes * 60_000),
        }),
      );
    },
  );

  /** Camera padding: even all round, plus whatever a sheet is resting over. */
  const framePadding = () => {
    const bottom = Math.round(frame.clientHeight * (props.insetFraction ?? 0));
    return { top: 48, left: 48, right: 48, bottom: 48 + bottom };
  };
  const still = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // The stage answers to gestures, but a mouse has no pinch and no position:
  // the same corner controls the route map wears, in the same coat.
  const zoomStep = (delta: number) => {
    const instance = map();
    if (instance) instance.zoomTo(instance.getZoom() + delta, { duration: 240 });
  };
  const recentre = () => {
    const instance = map();
    const me = props.me;
    if (instance && me) instance.easeTo({ center: [me.lng, me.lat], zoom: 15, duration: 500 });
  };

  /*
   * Where the camera goes, and when it is allowed to move at all.
   *
   * It moves when what the map is about changes - a new set of matches, a
   * different journey chosen - and never because the same answer was computed
   * again. The key is the identity of the subject; a camera that refits under
   * a rider who has started panning reads as the map fighting them.
   */
  const subject = createMemo<{ key: string; bounds: LngLatBounds } | null>(() => {
    const journeys = props.journeys ?? [];
    const chosen = journeys.find((j) => j.id === (props.selectedId ?? "")) ?? journeys[0];

    if (chosen) {
      const bounds = new LngLatBounds();
      const drawn = legLines().find((entry) => entry.journey.id === chosen.id);
      for (const part of drawn?.legs ?? []) for (const at of part.line) bounds.extend(at);
      for (const end of [props.ends?.from, props.ends?.to]) if (end) bounds.extend(point(end));
      if (bounds.isEmpty()) return null;
      // The chosen journey's ends name the frame; its roads only fill it out,
      // so a shape arriving later does not count as a new subject.
      return { key: `journey:${chosen.id}`, bounds };
    }

    const pins = props.pins ?? [];
    if (pins.length > 0) {
      const bounds = new LngLatBounds();
      for (const pin of pins) bounds.extend(point(pin.location));
      if (props.me) bounds.extend(point(props.me));
      return { key: `pins:${pins.map((pin) => pin.id).join("|")}`, bounds };
    }

    return null;
  });

  let framedKey = "";
  createEffect(
    () => ({ instance: map(), at: subject() }),
    ({ instance, at }) => {
      if (!instance || !at || at.key === framedKey) return;
      framedKey = at.key;
      instance.fitBounds(at.bounds, {
        padding: framePadding(),
        maxZoom: 15.5,
        duration: still() ? 0 : 500,
      });
    },
  );

  return (
    <div ref={frame} class="relative size-full overflow-hidden bg-map" aria-label="map">
      <Show when={usable() === false}>
        <div class="absolute inset-x-0 top-0 flex items-center justify-center px-5 py-2">
          <span class="text-[0.75rem] font-semibold text-subtle-foreground">
            {t("mapUnavailable", props.lang)}
          </span>
        </div>
      </Show>

      <Show when={usable()}>
        {/* A pair, spaced as one: in and out are halves of one control. */}
        <div class="absolute right-2.5 top-2.5 z-10 flex flex-col gap-1">
          <button
            type="button"
            aria-label={t("mapZoomIn", props.lang)}
            onClick={() => zoomStep(1)}
            class={MAP_CONTROL}
          >
            <PlusIcon size={15} />
          </button>
          <button
            type="button"
            aria-label={t("mapZoomOut", props.lang)}
            onClick={() => zoomStep(-1)}
            class={MAP_CONTROL}
          >
            <MinusIcon size={15} />
          </button>
        </div>
        {/* Where am I, at the same corner it holds on the route map - lifted
            clear of whatever sheet is resting over the stage. */}
        <Show when={props.me}>
          <div
            class="absolute right-2.5 z-10"
            style={{ bottom: `calc(${(props.insetFraction ?? 0) * 100}% + 0.625rem)` }}
          >
            <button
              type="button"
              aria-label={t("mapMyLocation", props.lang)}
              onClick={recentre}
              class={MAP_CONTROL}
            >
              <PinIcon size={15} />
            </button>
          </div>
        </Show>
      </Show>

      {/*
       * The drop pin. DOM, not a map layer: it stands still over the canvas
       * while the world is dragged underneath, which is the entire gesture.
       * The tip is the point being chosen; the shadow stays on the ground
       * while the pin lifts, which is what reads as "not yet placed".
       */}
      <Show when={props.pinned}>
        <div
          class="pointer-events-none absolute left-1/2 z-10"
          style={{ top: `${(1 - (props.insetFraction ?? 0)) * 50}%` }}
        >
          <span
            class={[
              "absolute -left-1 -top-0.5 h-1 w-2 rounded-full bg-black/35 blur-[1.5px]",
              "motion-safe:transition-transform motion-safe:duration-state",
              lifted() ? "scale-75" : "",
            ]}
          />
          <svg
            width="30"
            height="40"
            viewBox="0 0 30 40"
            class={[
              "absolute bottom-0 left-1/2 -translate-x-1/2",
              "motion-safe:transition-transform motion-safe:duration-state",
              lifted() ? "-translate-y-2.5" : "",
            ]}
            aria-hidden="true"
          >
            <path
              d="M15 38.5 L9.5 22.5 A 11 11 0 1 1 20.5 22.5 Z"
              fill="var(--primary)"
              stroke="#ffffff"
              stroke-width="2.2"
              stroke-linejoin="round"
            />
            <circle cx="15" cy="12.5" r="4" fill="#ffffff" />
          </svg>
        </div>
      </Show>
    </div>
  );
}

export default ExploreMap;
