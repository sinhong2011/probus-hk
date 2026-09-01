import { LngLatBounds, Map as MlMap, type ExpressionSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { FeatureCollection } from "geojson";
import { Portal, type JSX } from "@solidjs/web";
import { Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js";
import { Drawer } from "~/components/Drawer";
import {
  BusIcon,
  CloseIcon,
  ExpandIcon,
  MinusIcon,
  PinIcon,
  PlusIcon,
  RouteIcon,
} from "~/components/Icons";
import { t, type Lang } from "~/lib/i18n";
import { whenIdleAfter } from "~/lib/idle";
import { useInView } from "~/lib/inView";
import { fetchRouteShape, type Position } from "~/data/waypoints";
import {
  TRAFFIC_REFRESH_MS,
  fetchTrafficSpeeds,
  segmentsAlong,
  trafficLevel,
  trafficShapes,
} from "~/data/traffic";
import { measureOf, spreadMetres } from "~/data/placement";
import type { VehicleFeed } from "~/data/useVehicles";
import type { Company, KeyedRoute, StopEntry } from "~/data/types";
import { distanceM, walkMinutes, type LatLng } from "~/lib/geo";
import { measureLine, measureStops, pointAt, sliceLine, stitchLines } from "~/lib/alongLine";
import { kindOf } from "~/lib/operators";
import {
  MAP_ACCENT as ACCENT,
  MAP_STYLES as STYLES,
  addFoldedAttribution,
  MAP_CONTROL,
  lineColour,
  prefersDark,
  upsertSource,
} from "~/lib/mapKit";
import { settings } from "~/stores/settings";

/**
 * Where the sheet over an opened-out map rests, as shares of the panel: low
 * enough that the route is what the window is for, and pulled up, most of it.
 */
const SHEET_LOW = 0.26;
const SHEET_TALL = 0.9;

const SRC_LINE = "app-route";
const SRC_TRAFFIC = "app-traffic";
const SRC_STOPS = "app-stops";
const SRC_ME = "app-me";
const SRC_WALK = "app-walk";
const SRC_BUS = "app-buses";
const SRC_BAND = "app-bus-band";
const LYR_HIT = "app-stop-hit";
const LYR_LABEL = "app-stop-label";
function stopFeatures(
  coords: Position[],
  names: string[],
  nearestIndex?: number,
  selectedIndex?: number,
): FeatureCollection {
  return {
    type: "FeatureCollection",
    features: coords.map((coordinates, index) => ({
      type: "Feature",
      // An id, so a hover can be set on the feature without rewriting the source.
      id: index,
      properties: {
        index,
        // Every stop carries its own sign, because its own name is printed on
        // it - see `paintStopFlags`.
        icon: `${IMG_STOP}-${index}`,
        name: names[index] ?? "",
        terminus: index === 0 || index === coords.length - 1 ? 1 : 0,
        nearest: index === nearestIndex ? 1 : 0,
        selected: index === selectedIndex ? 1 : 0,
      },
      geometry: { type: "Point", coordinates },
    })),
  };
}

const IMG_STOP = "app-stop-flag";

/** `#rrggbb` at an opacity, for the halo gradients. */
function withAlpha(hex: string, alpha: number): string {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return hex;
  return `rgba(${parseInt(m[1]!, 16)}, ${parseInt(m[2]!, 16)}, ${parseInt(m[3]!, 16)}, ${alpha})`;
}

/** The sign a stop shows: its own, or the lit one while it is being read. */
const SELECTED = ["==", ["get", "selected"], 1] as ExpressionSpecification;

/*
 * Two states a stop moves through rather than flips into: how far it is
 * pointed at, and how far it is the stop being read, each 0 to 1. MapLibre
 * transitions a paint property's *value* but not a feature's state, so the
 * state is driven by hand over a few frames (see `tween`), and every paint
 * expression below reads the fraction rather than a flag - which is what lets
 * a ring grow under the pointer instead of appearing.
 */
const HOVER = ["number", ["feature-state", "hover"], 0] as ExpressionSpecification;
const LIT = ["number", ["feature-state", "lit"], 0] as ExpressionSpecification;
/** Over this many milliseconds, on a curve that arrives rather than stops. */
const STATE_MS = 220;
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

/** The name's colour: the route's own as a stop is read or pointed at. */
const labelColour = (colour: string, dark: boolean): ExpressionSpecification => [
  "case",
  SELECTED,
  colour,
  ["interpolate", ["linear"], HOVER, 0, dark ? "#b9c0cc" : "#4a5160", 1, colour],
];

/** A radius by zoom, opened out by a fraction of a state: base + reach * state. */
const ringRadius = (reach: number, state: ExpressionSpecification): ExpressionSpecification => [
  "interpolate",
  ["linear"],
  ["zoom"],
  11,
  ["+", 5.5, ["*", reach * 0.7, state]],
  14,
  ["+", 7.5, ["*", reach, state]],
  17,
  ["+", 9.5, ["*", reach * 1.3, state]],
];

/**
 * Drives one feature's state from where it is to a target over a few frames.
 * Keeps its own record of where each one is, because the map will not say,
 * and a hover that leaves halfway in has to come back from halfway.
 */
function stateTween(instance: MlMap) {
  const at = new Map<string, number>();
  const frames = new Map<string, number>();
  return (id: number, key: string, to: number) => {
    const slot = `${key}:${id}`;
    const from = at.get(slot) ?? 0;
    if (from === to) return;
    const started = performance.now();
    const pending = frames.get(slot);
    if (pending !== undefined) cancelAnimationFrame(pending);

    const step = (now: number) => {
      const t = Math.min(1, (now - started) / STATE_MS);
      const value = from + (to - from) * easeOut(t);
      at.set(slot, value);
      /*
       * The source may not be there yet, or may have gone in a style swap.
       * Checked rather than caught: a missing source does not make
       * `setFeatureState` throw, it makes the map fire its error event, and
       * that prints to the console from inside MapLibre where no catch here
       * can reach. The next state change starts a fresh tween.
       */
      if (!instance.getSource(SRC_STOPS)) {
        frames.delete(slot);
        return;
      }
      instance.setFeatureState({ source: SRC_STOPS, id }, { [key]: value });
      if (t < 1) frames.set(slot, requestAnimationFrame(step));
      else frames.delete(slot);
    };
    frames.set(slot, requestAnimationFrame(step));
  };
}
/**
 * The marker's drawing grid, before `icon-size` scales it: the artwork is laid
 * out as if in a 54x58 SVG viewBox whose bottom edge is the pavement, with
 * `headroom` more above it for the rings the lit sign wears - they reach past
 * the top of the sign's own disc, and a canvas simply drops whatever is drawn
 * outside it, which cut the top off the open stop's ring. The label layer
 * needs `height` to know how far above the stop the pole reaches.
 */
const FLAG = { width: 54, height: 62, headroom: 4, ratio: 3 };

/** The weighted cone the pole stands in, as SVG path data. */
const FLAG_BASE = "M25.5 47.5h3l3.3 6.6a1.3 1.3 0 0 1-1.16 2.35h-7.28a1.3 1.3 0 0 1-1.16-2.35z";
/**
 * The railway's mark: the train the 鐵路 tab wears (lineicons `train-1`, on
 * its 24-unit grid), so the station on the map and the tab that led to it
 * carry the same glyph.
 */
const RAIL_GLYPH = [
  "M12 13.313a1.75 1.75 0 1 0 0 3.5a1.75 1.75 0 0 0 0-3.5",
  "M3.875 5.5a2.25 2.25 0 0 1 2.25-2.25h11.75a2.25 2.25 0 0 1 2.25 2.25v11.75a2.25 2.25 0 0 1-2.25 2.25h-.69l1.22 1.22a.75.75 0 1 1-1.06 1.06l-2.28-2.28h-6.13l-2.28 2.28a.75.75 0 0 1-1.06-1.06l1.22-1.22h-.69a2.25 2.25 0 0 1-2.25-2.25zm14.75 0a.75.75 0 0 0-.75-.75H12.75v5.875h5.875zm-12.5-.75a.75.75 0 0 0-.75.75v5.125h5.875V4.75zm-.75 7.375v5.125c0 .414.336.75.75.75h11.75a.75.75 0 0 0 .75-.75v-5.125z",
];
/** The lettering on the sign, in the humanist sans the real boards are set in. */
const BOARD_FONT = 'system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif';

/**
 * Sets the lettering, and makes sure it took.
 *
 * A canvas silently ignores a `font` it cannot parse and keeps whatever it had,
 * which on a fresh context is `10px sans-serif`. Where that happens every line
 * is measured against a font half again too big, so a route number that fits
 * perfectly well is squeezed and then cut - 290 came out as "29...". Reading
 * the property back is the only way to tell, and a plain family always parses.
 */
function setBoardFont(ctx: CanvasRenderingContext2D, weight: number, px: number) {
  ctx.font = `${weight} ${px}px ${BOARD_FONT}`;
  if (!ctx.font.includes(`${px}px`)) ctx.font = `${weight} ${px}px sans-serif`;
}
/**
 * The route board on the sign: its plate, the white margin the number is never
 * allowed into, and the corner radius.
 *
 * Sized so the whole plate sits inside the disc with red showing all round.
 * A plate is a rectangle and a sign is a circle, so it is the corners that
 * decide how wide it can be: they reach `hypot(width / 2, 18 - top)` from the
 * centre, and past about 13.5 they cross the ring and the plate reads as
 * hanging out of the sign. Rounding them off is what buys the width back.
 */
const BOARD = { top: 9.5, width: 24, height: 10, margin: 3, radius: 3.5 };
/** Paper white for the route board, and the aged cream of a timetable sheet. */
const PAPER = "#ffffff";
const TIMETABLE = "#e8e3d6";

/** `roundRect` with a path of arcs behind it, for the browsers without it. */
function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath();
  if (typeof ctx.roundRect === "function") {
    ctx.roundRect(x, y, w, h, r);
    return;
  }
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** The operator's colour, lifted or dropped, for the shading of a face. */
function shade(colour: string, towards: "light" | "dark", amount: number) {
  const hex = colour.replace("#", "");
  const full = hex.length === 3 ? hex.replace(/./g, (c) => c + c) : hex;
  const n = Number.parseInt(full, 16);
  if (!Number.isFinite(n)) return colour;
  const target = towards === "light" ? 255 : 0;
  const channel = (shift: number) => {
    const value = (n >> shift) & 255;
    return Math.round(value + (target - value) * amount);
  };
  return `rgb(${channel(16)}, ${channel(8)}, ${channel(0)})`;
}

/** A face lit from above, which is what keeps the sign from reading as a sticker. */
function litFace(ctx: CanvasRenderingContext2D, colour: string, top: number, bottom: number) {
  const face = ctx.createLinearGradient(0, top, 0, bottom);
  face.addColorStop(0, shade(colour, "light", 0.22));
  face.addColorStop(1, shade(colour, "dark", 0.18));
  return face;
}

/**
 * Sets the font and returns the text, squeezed and if need be cut, so that a
 * line of the sign fits the board it is printed on. The real signs do the same
 * thing: a long name is set narrower, and past a point it is abbreviated.
 */
function fitText(
  ctx: CanvasRenderingContext2D,
  text: string,
  room: number,
  size: number,
  weight: number,
  floor: number,
) {
  let px = size;
  setBoardFont(ctx, weight, px);
  let width = ctx.measureText(text).width;

  /*
   * Squeezed step by step rather than in one go: scaling straight to the width
   * that "should" fit lands on the boundary, where a hair of rounding puts it
   * back over and a route number like 290 gets cut to 2... So each pass takes
   * a little more off than the arithmetic asks for, and stops at the floor.
   */
  while (width > room && px > floor) {
    px = Math.max(floor, px * Math.min(0.92, room / width));
    setBoardFont(ctx, weight, px);
    width = ctx.measureText(text).width;
  }
  if (width <= room) return text;

  let cut = text;
  while (cut.length > 1 && ctx.measureText(`${cut}…`).width > room) cut = cut.slice(0, -1);
  return `${cut}…`;
}

/**
 * The stop marker: a Hong Kong bus stop pole, drawn as the thing a rider is
 * actually looking for on the pavement.
 *
 * It is the real pole, in the order the real one is built - a round sign at the
 * top in the operator's own colour carrying the white route board and, under
 * it, the name of this stop; the timetable case; the galvanised post; and the
 * weighted cone it stands in. A plain dot said "a point on a line"; this says
 * "the stop is here", and the silhouette is one a rider can match against what
 * is in front of them.
 *
 * The name is the sign's small print, exactly as it is on the pavement: it is
 * there to confirm the stop once you are looking at it, not to be read across
 * the map. The name that carries at a glance is the one the label layer sets
 * beside the pole.
 *
 * The artwork is SVG geometry - the cone is literally path data - painted
 * through the canvas rather than shipped as an asset, because the colour, the
 * route number and the stop name are all only known once the route is, and
 * because MapLibre wants pixels it can put in its sprite. The foot of the cone
 * is the bottom edge of the image, so anchoring the icon there plants it on the
 * stop's own coordinate - a dot centred on the point sat half in the road,
 * which is not where the pole is.
 */
function stopFlagImage(
  colour: string,
  surface: string,
  number: string,
  name: string,
  /** Lit: the sign of the stop being read, ringed in its own colour. */
  selected = false,
) {
  const { width, height, headroom, ratio } = FLAG;
  const canvas = document.createElement("canvas");
  canvas.width = width * ratio;
  canvas.height = height * ratio;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.scale(ratio, ratio);
  // The artwork is laid out from the top of the sign; the headroom is above it.
  ctx.translate(0, headroom);

  const cx = width / 2;
  const cy = 18;
  const radius = 17;

  /*
   * The stop being read wears a ring: white against the disc, and a fine one
   * in its own colour outside that, so it is picked out from forty identical
   * signs at a glance. The glow under it is the map's, because the map can
   * animate it and a rasterised sign cannot.
   */
  if (selected) {
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.arc(cx, cy, radius + 1.8, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = withAlpha(colour, 0.55);
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(cx, cy, radius + 3.6, 0, Math.PI * 2);
    ctx.stroke();
  }

  /*
   * The pool of shade at the foot, which is what stops the pole from looking
   * pasted on top of the map rather than standing in it. Kept small and faint:
   * a pole stands on its own route line, and a broad shadow reads as a break
   * in the line rather than as ground under the pole.
   */
  const ground = ctx.createRadialGradient(cx, 56, 0, cx, 56, 7.5);
  ground.addColorStop(0, "rgba(0, 0, 0, 0.34)");
  ground.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = ground;
  ctx.beginPath();
  ctx.ellipse(cx, 56, 7.5, 2.4, 0, 0, Math.PI * 2);
  ctx.fill();

  // A lit edge and a shaded one, so post and cone read as galvanised steel.
  const steel = (from: string, mid: string, to: string) => {
    const gradient = ctx.createLinearGradient(cx - 6, 0, cx + 6, 0);
    gradient.addColorStop(0, from);
    gradient.addColorStop(0.42, mid);
    gradient.addColorStop(1, to);
    return gradient;
  };
  // The cone is darker than the post: at the sizes this is drawn it has to
  // read as the pole's foot, not as a second sign under the first.
  ctx.fillStyle = steel("#c6cdd8", "#98a1ae", "#5f6773");
  ctx.fill(new Path2D(FLAG_BASE));
  ctx.fillStyle = steel("#e9edf3", "#b2bac6", "#727a88");
  roundedRect(ctx, cx - 1.5, 32, 3, 16.5, 1.5);
  ctx.fill();

  // Sign and case cast the shadow that lifts them off a basemap busy with
  // roads of about the same width.
  ctx.save();
  ctx.shadowColor = "rgba(0, 0, 0, 0.5)";
  ctx.shadowBlur = 3;
  ctx.shadowOffsetY = 2;

  ctx.fillStyle = litFace(ctx, colour, 34.5, 48);
  roundedRect(ctx, 20.5, 34.5, 13, 13.5, 2.4);
  ctx.fill();

  ctx.fillStyle = litFace(ctx, colour, cy - radius, cy + radius);
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // The timetable behind its glass, down to the ruled lines of departures.
  ctx.fillStyle = TIMETABLE;
  roundedRect(ctx, 22.2, 36.2, 9.6, 10.1, 1);
  ctx.fill();
  ctx.fillStyle = colour;
  ctx.globalAlpha = 0.5;
  roundedRect(ctx, 23.4, 38.2, 7.2, 0.9, 0.45);
  ctx.fill();
  ctx.globalAlpha = 0.34;
  roundedRect(ctx, 23.4, 40.4, 7.2, 0.9, 0.45);
  ctx.fill();
  ctx.globalAlpha = 0.24;
  roundedRect(ctx, 23.4, 42.6, 7.2, 0.9, 0.45);
  ctx.fill();
  ctx.globalAlpha = 1;

  // A ring in the map's own colour, so the sign is cut out of the basemap the
  // same way the labels are haloed out of it.
  ctx.strokeStyle = surface;
  ctx.lineWidth = 2.6;
  ctx.beginPath();
  ctx.arc(cx, cy, radius - 1.3, 0, Math.PI * 2);
  ctx.stroke();

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  /*
   * The route board, carrying this route's own number - the part of the sign a
   * rider reads from across the street.
   *
   * The number is fitted to the board less its margins, never to the board
   * itself: set to the full width it reads as though it has burst out of the
   * plate, which is what the real ones never do. It starts at four fifths of
   * the plate's height and is squeezed from there, so 1 and 290 are set as
   * large as the plate allows and N269 comes down to meet it - which is what
   * the printed ones do too.
   */
  ctx.fillStyle = PAPER;
  roundedRect(ctx, cx - BOARD.width / 2, BOARD.top, BOARD.width, BOARD.height, BOARD.radius);
  ctx.fill();
  ctx.fillStyle = colour;
  ctx.fillText(
    fitText(ctx, number, BOARD.width - BOARD.margin * 2, BOARD.height * 0.8, 700, 4.6),
    cx,
    BOARD.top + BOARD.height / 2 + 0.2,
  );

  /*
   * And under it, printed straight onto the sign, the name of this stop. It is
   * set smaller than the number and given the disc's wider lower half: the
   * number is what has to survive first, and the name that carries at a glance
   * is the one the label layer sets above the pole.
   */
  ctx.fillStyle = PAPER;
  ctx.fillText(fitText(ctx, name, 25, 5.4, 600, 3.4), cx, 25.6);

  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return { width: canvas.width, height: canvas.height, data: new Uint8Array(pixels.data.buffer) };
}

/**
 * The sign a station shows, where the route is a railway.
 *
 * A bus pole on an MTR station is the wrong furniture: nobody waits for a
 * train under a route board and a timetable case. What marks a station on the
 * street is the railway's own mark on a post, and that is what this is - the
 * disc in the line's colour, carrying the rail glyph the app's own rail tab
 * wears, on a plain post with a flat foot. No route board, because a line is
 * known by its colour and not by a number; and no name in small print, because
 * the label layer names the station and the disc has the glyph to carry.
 *
 * Same grid and same foot as the pole, so it plants on the station's own
 * coordinate and the label layer's arithmetic holds without knowing which
 * sign it is standing over.
 */
function railSignImage(colour: string, surface: string, selected = false) {
  const { width, height, headroom, ratio } = FLAG;
  const canvas = document.createElement("canvas");
  canvas.width = width * ratio;
  canvas.height = height * ratio;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.scale(ratio, ratio);
  ctx.translate(0, headroom);

  const cx = width / 2;
  const cy = 18;
  const radius = 17;

  // The station being read wears the same rings the lit pole does.
  if (selected) {
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.arc(cx, cy, radius + 1.8, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = withAlpha(colour, 0.55);
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(cx, cy, radius + 3.6, 0, Math.PI * 2);
    ctx.stroke();
  }

  const ground = ctx.createRadialGradient(cx, 56, 0, cx, 56, 7.5);
  ground.addColorStop(0, "rgba(0, 0, 0, 0.34)");
  ground.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = ground;
  ctx.beginPath();
  ctx.ellipse(cx, 56, 7.5, 2.4, 0, 0, Math.PI * 2);
  ctx.fill();

  // The post and its foot: the same galvanised steel as the pole, without the
  // cone - a station sign is set into the pavement, not weighted on it.
  const steel = (from: string, mid: string, to: string) => {
    const gradient = ctx.createLinearGradient(cx - 6, 0, cx + 6, 0);
    gradient.addColorStop(0, from);
    gradient.addColorStop(0.42, mid);
    gradient.addColorStop(1, to);
    return gradient;
  };
  ctx.fillStyle = steel("#e9edf3", "#b2bac6", "#727a88");
  roundedRect(ctx, cx - 1.5, 32, 3, 22, 1.5);
  ctx.fill();
  ctx.fillStyle = steel("#c6cdd8", "#98a1ae", "#5f6773");
  roundedRect(ctx, cx - 5, 53, 10, 3, 1.5);
  ctx.fill();

  ctx.save();
  ctx.shadowColor = "rgba(0, 0, 0, 0.5)";
  ctx.shadowBlur = 3;
  ctx.shadowOffsetY = 2;
  ctx.fillStyle = litFace(ctx, colour, cy - radius, cy + radius);
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.strokeStyle = surface;
  ctx.lineWidth = 2.6;
  ctx.beginPath();
  ctx.arc(cx, cy, radius - 1.3, 0, Math.PI * 2);
  ctx.stroke();

  // The mark itself, in the sign's white, sized to sit inside the ring.
  const glyph = 21;
  ctx.save();
  ctx.translate(cx - glyph / 2, cy - glyph / 2);
  ctx.scale(glyph / 24, glyph / 24);
  ctx.fillStyle = PAPER;
  for (const d of RAIL_GLYPH) ctx.fill(new Path2D(d));
  ctx.restore();

  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return { width: canvas.width, height: canvas.height, data: new Uint8Array(pixels.data.buffer) };
}

/**
 * Paints one sign per stop, since each carries its own name, and clears the
 * signs left over from a longer route. A railway's stations get the station
 * sign instead of the pole.
 */
function paintStopFlags(
  instance: MlMap,
  colour: string,
  surface: string,
  rail: boolean,
  number: string,
  names: string[],
  painted: number,
) {
  // Two signs per stop: the one it carries, and the one it carries while it is
  // the stop being read - the same sign, lit.
  names.forEach((name, index) => {
    for (const on of [false, true]) {
      const id = `${IMG_STOP}-${index}${on ? "-on" : ""}`;
      const image = rail
        ? railSignImage(colour, surface, on)
        : stopFlagImage(colour, surface, number, name, on);
      if (!image) continue;
      if (instance.hasImage(id)) instance.updateImage(id, image);
      else instance.addImage(id, image, { pixelRatio: FLAG.ratio });
    }
  });

  for (let index = names.length; index < painted; index += 1) {
    for (const id of [`${IMG_STOP}-${index}`, `${IMG_STOP}-${index}-on`]) {
      if (instance.hasImage(id)) instance.removeImage(id);
    }
  }

  return names.length;
}

const IMG_BUS = "app-bus-disc";
/** The same vehicle facing the other way, for a heading with west in it. */
const IMG_BUS_WEST = "app-bus-disc-west";
const IMG_NOSE = "app-bus-nose";
/** The disc's own pixel grid, and the nose's, before `icon-size` scales them. */
const BUS = { size: 30, ratio: 3 };
const NOSE = { width: 30, height: 50, ratio: 3 };

/** What is drawn on the map: the vehicle the route is actually run with. */
type VehicleKind = "bus" | "minibus" | "rail";

/** The vehicle a route's operators put on it. */
function vehicleKind(cos: Company[]): VehicleKind {
  if (cos.some((co) => kindOf(co) === "rail")) return "rail";
  if (cos.some((co) => kindOf(co) === "minibus")) return "minibus";
  return "bus";
}

/** Window glass, lit from above: the one colour the three vehicles share. */
function glass(ctx: CanvasRenderingContext2D, top: number, bottom: number) {
  const face = ctx.createLinearGradient(0, top, 0, bottom);
  face.addColorStop(0, "#e4f2fb");
  face.addColorStop(1, "#93bddc");
  return face;
}

/** A row of windows, each a rounded pane of the same glass. */
function windows(
  ctx: CanvasRenderingContext2D,
  xs: number[],
  y: number,
  w: number,
  h: number,
  r = 0.55,
) {
  ctx.fillStyle = glass(ctx, y, y + h);
  for (const x of xs) {
    roundedRect(ctx, x, y, w, h, r);
    ctx.fill();
  }
}

/** A road wheel: black tyre, a lighter hub, seen side on. */
function wheel(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  ctx.fillStyle = "#22262c";
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#aab2bc";
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.42, 0, Math.PI * 2);
  ctx.fill();
}

/**
 * A body with its own radius at each corner - a cab nose rounds more than a
 * tail. Added to the current path, so a silhouette can be built from several.
 */
function carBody(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  [tl, tr, br, bl]: [number, number, number, number],
) {
  ctx.moveTo(x + tl, y);
  ctx.arcTo(x + w, y, x + w, y + h, tr);
  ctx.arcTo(x + w, y + h, x, y + h, br);
  ctx.arcTo(x, y + h, x, y, bl);
  ctx.arcTo(x, y, x + w, y, tl);
  ctx.closePath();
}

/** A wheel's outline, for the silhouette. */
function wheelPath(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  ctx.moveTo(cx + r, cy);
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
}

/** The thin dark edge that makes a drawing read as drawn rather than cut out. */
function outline(ctx: CanvasRenderingContext2D) {
  ctx.lineWidth = 0.6;
  ctx.strokeStyle = "rgba(0, 0, 0, 0.3)";
  ctx.stroke();
}

/**
 * One vehicle: its outline as a single path, for the halo and the shadow
 * under it, and the drawing itself.
 */
interface Vehicle {
  silhouette: (ctx: CanvasRenderingContext2D) => void;
  paint: (ctx: CanvasRenderingContext2D, colour: string) => void;
}

const BUS_BODY = { x: 3, y: 6.4, w: 24, h: 14.6, radii: [2, 3.6, 1.4, 1.4] as const };
const BUS_WHEELS = [
  [8.6, 21.6],
  [21.6, 21.6],
] as const;
const BUS_WHEEL_R = 2.7;

/**
 * A double-decker, side on, in the operator's livery: two rows of glass over
 * a belt line, the door behind the front axle, a headlamp at the nose.
 */
const bus: Vehicle = {
  silhouette(ctx) {
    const { x, y, w, h, radii } = BUS_BODY;
    carBody(ctx, x, y, w, h, [...radii]);
    for (const [cx, cy] of BUS_WHEELS) wheelPath(ctx, cx, cy, BUS_WHEEL_R);
  },
  paint(ctx, colour) {
    const { x, y, w, h, radii } = BUS_BODY;
    ctx.fillStyle = litFace(ctx, colour, y, y + h);
    ctx.beginPath();
    carBody(ctx, x, y, w, h, [...radii]);
    ctx.fill();
    outline(ctx);

    // The belt between the decks, a shade lighter than the panels around it.
    ctx.fillStyle = shade(colour, "light", 0.38);
    ctx.fillRect(x + 0.8, y + 6.7, w - 1.6, 0.9);

    // Upper deck: a run of panes and the raked windscreen over the driver.
    windows(ctx, [4.8, 8.6, 12.4, 16.2], y + 1.7, 3.2, 3.9, 0.7);
    windows(ctx, [20.6], y + 1.7, 4.8, 3.9, 1.2);
    // Lower deck: two panes, the door, and the driver's windscreen.
    windows(ctx, [4.8, 8.6], y + 8.6, 3.2, 3.7, 0.7);
    windows(ctx, [12.6], y + 8.6, 3.1, 5.3, 0.6);
    windows(ctx, [20.6], y + 8.6, 4.8, 3.7, 1);
    ctx.strokeStyle = "rgba(0, 0, 0, 0.28)";
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(14.15, y + 9);
    ctx.lineTo(14.15, y + 13.6);
    ctx.stroke();

    for (const [cx, cy] of BUS_WHEELS) wheel(ctx, cx, cy, BUS_WHEEL_R);

    ctx.fillStyle = "#ffd66b";
    ctx.beginPath();
    ctx.arc(x + w - 1.2, y + h - 2.2, 0.95, 0, Math.PI * 2);
    ctx.fill();
  },
};

const MINIBUS_BODY = { x: 4, y: 9.2, w: 22, h: 11.6, radii: [2.4, 4, 1.6, 1.6] as const };
const MINIBUS_WHEELS = [
  [9.2, 21.2],
  [21, 21.2],
] as const;
const MINIBUS_WHEEL_R = 2.5;

/**
 * A public light bus, side on: the cream coach the real ones are, wearing
 * the operator's colour as its roof and skirt - which is how a green minibus
 * is green.
 */
const minibus: Vehicle = {
  silhouette(ctx) {
    const { x, y, w, h, radii } = MINIBUS_BODY;
    carBody(ctx, x, y, w, h, [...radii]);
    for (const [cx, cy] of MINIBUS_WHEELS) wheelPath(ctx, cx, cy, MINIBUS_WHEEL_R);
  },
  paint(ctx, colour) {
    const { x, y, w, h, radii } = MINIBUS_BODY;
    const cream = ctx.createLinearGradient(0, y, 0, y + h);
    cream.addColorStop(0, "#fbf8ef");
    cream.addColorStop(1, "#e3dcc8");
    ctx.fillStyle = cream;
    ctx.beginPath();
    carBody(ctx, x, y, w, h, [...radii]);
    ctx.fill();

    // Roof and skirt in the operator's colour, cut to the body's own outline.
    ctx.save();
    ctx.clip();
    ctx.fillStyle = litFace(ctx, colour, y, y + 3);
    ctx.fillRect(x, y, w, 3);
    ctx.fillStyle = shade(colour, "dark", 0.08);
    ctx.fillRect(x, y + h - 1.9, w, 1.9);
    ctx.restore();
    ctx.beginPath();
    carBody(ctx, x, y, w, h, [...radii]);
    outline(ctx);

    windows(ctx, [5.6, 9.6, 13.6], y + 3.8, 3.4, 4, 0.7);
    windows(ctx, [18.2], y + 3.5, 6.3, 4.3, 1.5);
    ctx.strokeStyle = "rgba(0, 0, 0, 0.28)";
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(17.3, y + 3.8);
    ctx.lineTo(17.3, y + h - 1.9);
    ctx.stroke();

    for (const [cx, cy] of MINIBUS_WHEELS) wheel(ctx, cx, cy, MINIBUS_WHEEL_R);

    ctx.fillStyle = "#ffd66b";
    ctx.beginPath();
    ctx.arc(x + w - 1.2, y + h - 2.9, 0.85, 0, Math.PI * 2);
    ctx.fill();
  },
};

const TRAIN_BODY = { x: 1.5, y: 9.4, w: 27, h: 11.2, radii: [1.6, 5.6, 4.3, 1.6] as const };
const TRAIN_BOGIES = [
  [4.8, 5.4],
  [19.4, 5.4],
] as const;

/**
 * A railway car, side on: brushed steel with the line's colour along its
 * flank, a cab that slopes away at the nose, and bogies riding a rail - the
 * train the network map draws, not a bus with a different badge.
 */
const train: Vehicle = {
  silhouette(ctx) {
    const { x, y, w, h, radii } = TRAIN_BODY;
    carBody(ctx, x, y, w, h, [...radii]);
    for (const [bx, bw] of TRAIN_BOGIES) ctx.rect(bx, y + h, bw, 2);
  },
  paint(ctx, colour) {
    const { x, y, w, h, radii } = TRAIN_BODY;
    const steel = ctx.createLinearGradient(0, y, 0, y + h);
    steel.addColorStop(0, "#f4f6f9");
    steel.addColorStop(0.55, "#d3d9e2");
    steel.addColorStop(1, "#aab3bf");
    ctx.fillStyle = steel;
    ctx.beginPath();
    carBody(ctx, x, y, w, h, [...radii]);
    ctx.fill();

    // The line's colour, from the windows down to the skirt.
    ctx.save();
    ctx.clip();
    ctx.fillStyle = litFace(ctx, colour, y + 7.2, y + h);
    ctx.fillRect(x, y + 7.2, w, h - 7.2);
    ctx.restore();
    ctx.beginPath();
    carBody(ctx, x, y, w, h, [...radii]);
    outline(ctx);

    windows(ctx, [3.4, 7.3, 11.2, 15.1], y + 2.5, 3.2, 3.9, 0.7);
    // The cab window follows the nose: glass that leans back where the body does.
    ctx.fillStyle = glass(ctx, y + 2, y + 6.5);
    ctx.beginPath();
    ctx.moveTo(19.8, y + 2);
    ctx.lineTo(23.9, y + 2);
    ctx.quadraticCurveTo(27.1, y + 2.3, 27.4, y + 6.5);
    ctx.lineTo(19.8, y + 6.5);
    ctx.closePath();
    ctx.fill();
    // Door lines between the panes.
    ctx.strokeStyle = "rgba(0, 0, 0, 0.22)";
    ctx.lineWidth = 0.5;
    for (const dx of [6.75, 14.55]) {
      ctx.beginPath();
      ctx.moveTo(dx, y + 1.6);
      ctx.lineTo(dx, y + h - 0.8);
      ctx.stroke();
    }
    // The headlamp on the cab's nose.
    ctx.fillStyle = "#ffd66b";
    ctx.beginPath();
    ctx.arc(x + w - 1.9, y + h - 2.3, 0.8, 0, Math.PI * 2);
    ctx.fill();

    // Bogies, and the rail they ride.
    ctx.fillStyle = "#2b2f36";
    for (const [bx, bw] of TRAIN_BOGIES) {
      roundedRect(ctx, bx, y + h, bw, 2, 0.6);
      ctx.fill();
    }
    ctx.strokeStyle = "rgba(0, 0, 0, 0.42)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(1, y + h + 2.8);
    ctx.lineTo(29, y + h + 2.8);
    ctx.stroke();
  },
};

const VEHICLE: Record<VehicleKind, Vehicle> = { bus, minibus, rail: train };

/**
 * The vehicle itself, drawn as the thing it is.
 *
 * Not a badge with a pictogram on it: a route map is already a chain of
 * coloured discs, and one more disc among forty is furniture. What moves on
 * the map is a picture - a double-decker in its livery, a cream minibus under
 * a green roof, a steel railway car with the line's colour along it - side on,
 * the way a child draws one, so that the kind of vehicle is read before
 * anything else is. The heading is the nose in front of it, which turns with
 * the road while the drawing stays upright.
 *
 * A paper halo and a shadow are what let a red bus sit on a red line and a
 * silver train on a grey map: the halo cuts it out of whatever is under it,
 * the shadow lifts it off.
 *
 * Drawn facing right, and turned on the map to point the way it is going -
 * see the layer. `west` is the mirror image, for the half of the compass
 * where turning the right-facing drawing would put the wheels in the air.
 */
function busImage(colour: string, kind: VehicleKind, west = false) {
  const { size, ratio } = BUS;
  const canvas = document.createElement("canvas");
  canvas.width = size * ratio;
  canvas.height = size * ratio;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.scale(ratio, ratio);
  if (west) {
    ctx.translate(size, 0);
    ctx.scale(-1, 1);
  }

  const vehicle = VEHICLE[kind];

  ctx.save();
  ctx.shadowColor = "rgba(0, 0, 0, 0.45)";
  ctx.shadowBlur = 3;
  ctx.shadowOffsetY = 1.2;
  ctx.beginPath();
  vehicle.silhouette(ctx);
  ctx.lineJoin = "round";
  ctx.lineWidth = 2.2;
  ctx.strokeStyle = PAPER;
  ctx.stroke();
  ctx.restore();

  vehicle.paint(ctx, colour);

  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return { width: canvas.width, height: canvas.height, data: new Uint8Array(pixels.data.buffer) };
}

/**
 * The arrowhead in front of the bus, which is what says which way it is going.
 * Kept in its own image so it can be turned with the line while the disc, and
 * the bus drawn on it, stay upright.
 */
function noseImage(colour: string) {
  const { width, height, ratio } = NOSE;
  const canvas = document.createElement("canvas");
  canvas.width = width * ratio;
  canvas.height = height * ratio;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.scale(ratio, ratio);

  const cx = width / 2;
  ctx.beginPath();
  ctx.moveTo(cx, 1.5);
  ctx.lineTo(cx + 4.6, 8.5);
  ctx.lineTo(cx - 4.6, 8.5);
  ctx.closePath();
  /*
   * White inside a coloured edge, like the badge behind it. Solid colour made
   * it a twin of the route's own direction arrows, which are also small
   * coloured triangles sitting on the line - and two kinds of arrowhead a
   * centimetre apart is a puzzle, not a heading.
   */
  ctx.fillStyle = PAPER;
  ctx.lineJoin = "round";
  ctx.lineWidth = 2.2;
  ctx.strokeStyle = colour;
  ctx.stroke();
  ctx.fill();

  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return { width: canvas.width, height: canvas.height, data: new Uint8Array(pixels.data.buffer) };
}

/** Adds both vehicle images, or repaints them when the livery changes. */
function paintBus(instance: MlMap, colour: string, kind: VehicleKind) {
  for (const [id, image] of [
    [IMG_BUS, busImage(colour, kind)],
    [IMG_BUS_WEST, busImage(colour, kind, true)],
    [IMG_NOSE, noseImage(colour)],
  ] as const) {
    if (!image) continue;
    if (instance.hasImage(id)) instance.updateImage(id, image);
    else instance.addImage(id, image, { pixelRatio: BUS.ratio });
  }
}

/**
 * How large the sign is drawn at each zoom. Termini get the bigger one: the two
 * ends of a route are the first thing anyone looks for on it.
 */
const FLAG_SIZE = [
  { zoom: 11, plain: 0.68, terminus: 0.8 },
  { zoom: 14, plain: 1, terminus: 1.16 },
  { zoom: 17, plain: 1.36, terminus: 1.56 },
];
/** Stops either side of the nearest one that the opening view takes in. */
const NEIGHBOURS = 2;
const LABEL_SIZE = 10.5;
/** Clear air between the top of the sign and the name standing over it. */
const LABEL_GAP = 5;

function byZoom(value: (size: { plain: number; terminus: number }) => [number, number]) {
  const stops = FLAG_SIZE.flatMap((size): [number, ExpressionSpecification] => {
    const [terminus, plain] = value(size);
    return [size.zoom, ["case", ["==", ["get", "terminus"], 1], terminus, plain]];
  });
  return ["interpolate", ["linear"], ["zoom"], ...stops] as ExpressionSpecification;
}

const flagSize = () => byZoom((size) => [size.terminus, size.plain]);

/** The bus grows with the zoom too, but it is one size for every route. */
const busSize = () =>
  ["interpolate", ["linear"], ["zoom"], 11, 0.75, 14, 1, 17, 1.25] as ExpressionSpecification;

/**
 * The name sits above the sign, so its offset is the sign's own height - which
 * `icon-size` changes with the zoom, and so must this. Measured in ems of the
 * label, which is what `text-radial-offset` counts in.
 */
const labelOffset = () =>
  byZoom((size) => [
    Number(((FLAG.height * size.terminus + LABEL_GAP) / LABEL_SIZE).toFixed(2)),
    Number(((FLAG.height * size.plain + LABEL_GAP) / LABEL_SIZE).toFixed(2)),
  ]);

/** What the marker has been showing, so the next poll can be reconciled to it. */
interface Trail {
  measure: number;
  /** Metres the drawn position is ahead of the freshly computed one. */
  offset: number;
  offsetAt: number;
}

/** How long a correction takes to be absorbed. */
const SETTLE_MS = 700;
/**
 * A correction smaller than this is waited out rather than shown: the marker
 * holds while the new estimate catches up to it. A bus that visibly slides
 * backwards reads as broken far faster than one that is a hundred metres
 * optimistic, and small corrections are most of them. Bigger ones are eased
 * back instead - holding through those would freeze the marker for minutes.
 */
const BACKSLIDE_METRES = 120;

function easeOutCubic(t: number): number {
  return 1 - (1 - t) ** 3;
}

/**
 * The band is painted against the route line rather than in its colour: a red
 * smear under a red line is not a smear, it is a slightly thicker line.
 */
function bandColour(dark: boolean): string {
  return dark ? "#ffffff" : "#0c0f14";
}

/** Redraw cadence. A bus covers about half a pixel in this at street zoom. */
const CREEP_MS = 80;
/*
 * The creep's cadence while the map is the small card rather than the whole
 * screen. At preview zoom a bus covers less than a pixel in 80ms, so twelve
 * full WebGL renders a second were spent drawing the same picture - a cost a
 * phone pays in scroll frames and battery. Four a second still reads as
 * steady movement at that size; the opened-out map, where a rider is actually
 * watching a bus glide, keeps the fine cadence.
 */
const CREEP_PREVIEW_MS = 400;

/**
 * The DPR the map renders at. The whole screen earns the device's own ratio;
 * the preview card does not: on a 3x phone the card was pushing nine times
 * the pixels of a 1x canvas through a weak GPU for a thumbnail-sized frame,
 * and the style's first paint was the longest task on the page. Capped at
 * 1.5 the card stays crisp enough to read a route shape at arm's length and
 * costs less than half as much to draw, every draw.
 */
const mapPixelRatio = (full: boolean) =>
  full ? window.devicePixelRatio : Math.min(window.devicePixelRatio, 1.5);

export function RouteMap(props: {
  route: KeyedRoute;
  stops: { id: string; stop: StopEntry }[];
  /** Stop names, in list order, shown when a stop is picked on the map. */
  stopNames?: string[];
  /** Index of the stop nearest the user, highlighted on the map. */
  nearestIndex?: number;
  /** Index of the stop the list currently has open; the map follows it. */
  selectedIndex?: number;
  /** Whether the map fills the window, when the screen keeps that state. */
  expanded?: boolean;
  /** Told when the rider opens the map out or puts it back. */
  onExpandedChange?: (open: boolean) => void;
  /** Picking a stop on the map opens it in the list. */
  onSelectStop?: (index: number) => void;
  /**
   * Where the buses are, estimated from their arrival times, and why there are
   * none when there are none. Nobody publishes a position feed here, so these
   * are inferences - drawn, and labelled, as such. `undefined` is the answer
   * still being in flight.
   */
  feed?: VehicleFeed;
  me?: LatLng | null;
  /**
   * Tailwind height classes rather than a fixed value, so the map can be taller
   * where there is room for it - and `flex-1` where it should take all of it,
   * as it does in the column on a wide screen. A map you cannot see the shape
   * of the route in is decoration.
   */
  heightClass?: string;
  /**
   * The nearest stop of this route to the rider, if one is within reach:
   * the walk to it is drawn on the map - a dotted path with the minutes on
   * it - rather than said in a row under the frame.
   */
  walkTarget?: LatLng | null;
  lang: Lang;
  /** Shown in place of the map when it cannot render. */
  unavailableLabel: string;
  /**
   * Every stop on the route, for the sheet to show when it is pulled up: the
   * open stop is the answer to one question, and the list is the way to ask
   * the next one without leaving the map. Built only when it is on screen.
   */
  list?: () => JSX.Element;
}) {
  let container!: HTMLDivElement;
  /*
   * Whether the map's frame is anywhere near the screen. The bus creep below
   * redraws the map every 80ms, and it kept doing so with the map scrolled
   * well off the top - on a phone that was a WebGL render competing with the
   * stop list for every frame of the scroll. Nothing about an invisible map
   * is worth a frame; the redraws stop when it leaves and resume when it
   * comes back, and the next poll repositions everything regardless.
   */
  const [watchFrame, frameInView] = useInView();

  /*
   * When anything on the page last scrolled. On a phone the stop list scrolls
   * inside its own card with the map still on screen above it, so the frame
   * gate does nothing there - and a WebGL redraw every 80ms is exactly what a
   * scrolling list cannot afford to share the thread with. The creep waits
   * out the scroll (momentum included - iOS keeps firing scroll events
   * through the glide) and picks up where the buses now are; a pause of half
   * a second in a crawl measured in minutes is invisible.
   */
  let scrolledAt = 0;
  const noteScroll = () => {
    scrolledAt = Date.now();
  };
  // Capture, because scroll events do not bubble and any pane may be the one
  // scrolling.
  document.addEventListener("scroll", noteScroll, { capture: true, passive: true });
  onCleanup(() => document.removeEventListener("scroll", noteScroll, { capture: true }));
  /** How many stop signs are in the sprite - see `paintStopFlags`. */
  let painted = 0;
  /** How the map has framed itself so far - see the geometry effect. */
  let opened: "none" | "route" | "nearest" = "none";
  const [map, setMap] = createSignal<MlMap | null>(null);
  /**
   * MapLibre's own bottom-left control column - the ⓘ lives there, and any
   * control of ours that should stand in line with it mounts here rather
   * than measuring where the pill happens to be.
   */
  const [corner, setCorner] = createSignal<HTMLElement | null>(null);
  /** The state driver, once there is a map to drive. */
  const [tween, setTween] = createSignal<((id: number, key: string, to: number) => void) | null>(
    null,
  );
  const [shape, setShape] = createSignal<Position[][] | null>(null);
  /**
   * WebGL is not available everywhere - locked-down browsers, some embedded
   * webviews, GPU blocklists - and a basemap that never paints leaves a large
   * black rectangle where the map should be. The map collapses to a slim note
   * instead if it has not finished loading in a few seconds.
   */
  const [usable, setUsable] = createSignal<boolean | null>(null);

  /**
   * The map filling the window.
   *
   * Filling it in CSS rather than asking for the browser's fullscreen: iOS
   * Safari refuses `requestFullscreen` on anything but a video, and a route map
   * on a phone is exactly the thing a rider wants opened out.
   */
  const [ownExpanded, setOwnExpanded] = createSignal(false);
  /* Owned by the screen when it says so - the route page keeps it in the URL,
     so the back button is the way out - and by the map otherwise. */
  const expanded = () => props.expanded ?? ownExpanded();
  const setExpanded = (next: boolean | ((open: boolean) => boolean)) => {
    const open = typeof next === "function" ? next(expanded()) : next;
    if (props.onExpandedChange) props.onExpandedChange(open);
    else setOwnExpanded(open);
  };

  const stopPositions = (): Position[] =>
    props.stops.map((s) => [s.stop.location.lng, s.stop.location.lat]);
  const stopNames = (): string[] => props.stopNames ?? props.stops.map(() => "");

  /**
   * Where the flags are planted: the stop's own published coordinate, and
   * nothing else.
   *
   * They used to be pulled onto the drawn route line where they sat within a
   * hundred and sixty metres of it, on the theory that stop list and geometry
   * come from different publishers and the line is what the map is claiming.
   * That was wrong in the direction that matters. The stop coordinates come
   * from the operators' own lists and are kerbside, where the pole is; the
   * geometry is crawled road centreline. Snapping to it walked every stop into
   * the middle of the carriageway, and where the line doubles back or passes a
   * junction it could put a stop on the wrong street altogether. hkbus, whose
   * stop list this is, draws them raw, and so do we.
   */
  const markerPositions = createMemo(stopPositions);

  /*
   * The map is built after the page has arrived, not while it is arriving.
   *
   * Creating it means a WebGL context, a style, and the first draw - a few
   * hundred milliseconds of the main thread on a phone - and done during the
   * page's own entrance it was the entrance stuttering, every time. The rows
   * are what a rider came for and they paint first; the map fills its frame
   * once the entrance has played out and the browser has a moment. "Idle"
   * alone is not enough - it arrives the instant the rows have painted, with
   * the entrance still running - so the wait is at least the entrance's
   * length. The deadline is so a page that never goes idle still gets its map.
   */
  const [settled, setSettled] = createSignal(false, { ownedWrite: true });
  onCleanup(whenIdleAfter(() => setSettled(true), 320, 1_000));

  /*
   * Solid 2 splits every effect: the first function does the reactive reads and
   * the second acts on the result untracked, optionally returning a cleanup.
   */
  createEffect(
    () => (settled() ? prefersDark(settings.theme()) : null),
    (dark) => {
      if (dark === null) return;
      const instance = new MlMap({
        container,
        style: dark ? STYLES.dark : STYLES.light,
        center: [114.17, 22.31],
        zoom: 10,
        // Added below instead, so it sits bottom-left clear of the route title.
        attributionControl: false,
        // The map sits inside a scrolling page, so it must not swallow drags.
        dragRotate: false,
        /*
         * No label cross-fade. Every repaint - and the bus creep is a repaint
         * on a cadence - started a 300ms symbol fade that kept the render
         * loop hot long after the frame that caused it, which added up to a
         * map that was never actually idle. Labels popping in is the honest
         * version of tiles arriving, and it is over in one frame.
         */
        fadeDuration: 0,
        pixelRatio: mapPixelRatio(expanded()),
        /*
         * A map in the middle of a long list will otherwise eat every scroll
         * that starts on top of it. Two fingers pan, and the hint says so in
         * the reader's own language.
         */
        cooperativeGestures: true,
        locale: {
          "CooperativeGesturesHandler.MobileHelpText": t("mapGestureMobile", props.lang),
          "CooperativeGesturesHandler.WindowsHelpText": t("mapGestureDesktop", props.lang),
          "CooperativeGesturesHandler.MacHelpText": t("mapGestureMac", props.lang),
        },
      });

      addFoldedAttribution(instance);

      // Picking a stop on the map is the fast way into a forty-stop list. The
      // name and the flag are the stop as much as the dot under them is - a
      // tap on either picks it, not only one on the invisible circle.
      const tween = stateTween(instance);
      setTween(() => tween);
      let hovered: number | null = null;
      const hover = (index: number | null) => {
        if (hovered === index) return;
        if (hovered !== null) tween(hovered, "hover", 0);
        if (index !== null) tween(index, "hover", 1);
        hovered = index;
      };
      for (const layer of [LYR_HIT, LYR_LABEL]) {
        instance.on("click", layer, (event) => {
          const index = event.features?.[0]?.properties?.index;
          if (typeof index === "number") props.onSelectStop?.(index);
        });
        instance.on("mousemove", layer, (event) => {
          const index = event.features?.[0]?.properties?.index;
          hover(typeof index === "number" ? index : null);
        });
        instance.on("mouseenter", layer, () => {
          instance.getCanvas().style.cursor = "pointer";
        });
        instance.on("mouseleave", layer, () => {
          instance.getCanvas().style.cursor = "";
          hover(null);
        });
      }

      instance.on("load", () => {
        // The map is created during layout, so its container may still have
        // been zero-height when MapLibre measured it.
        instance.resize();
        setUsable(true);
        setMap(instance);
        setCorner(
          instance.getContainer().querySelector<HTMLElement>(".maplibregl-ctrl-bottom-left"),
        );
      });

      const giveUp = window.setTimeout(() => setUsable((v) => v ?? false), 6_000);

      return () => {
        clearTimeout(giveUp);
        setMap(null);
        setCorner(null);
        instance.remove();
      };
    },
  );

  // Geometry is fetched separately: some routes weigh hundreds of kilobytes, so
  // the map paints immediately and the line arrives when it arrives.
  createEffect(
    () => props.route,
    (route) => {
      let cancelled = false;
      setShape(null);
      void fetchRouteShape(route).then((lines) => {
        if (!cancelled) setShape(lines);
      });
      return () => {
        cancelled = true;
      };
    },
  );

  createEffect(
    () => ({
      instance: map(),
      // Without published geometry, joining the stops is the honest fallback.
      lines: shape() ?? [stopPositions()],
      positions: markerPositions(),
      names: stopNames(),
      colour: lineColour(props.route),
      number: props.route.route,
      // A railway's stations wear the station sign, not the bus pole.
      rail: props.route.co.some((co) => kindOf(co) === "rail"),
      nearestIndex: props.nearestIndex,
      dark: prefersDark(settings.theme()),
    }),
    ({ instance, lines, positions, names, colour, number, rail, nearestIndex, dark }) => {
      if (!instance) return;

      // What the map is painted on, which the signs are cut out of.
      const surface = dark ? "#0c0f14" : "#ffffff";

      upsertSource(instance, SRC_LINE, {
        type: "FeatureCollection",
        features: lines.map((coordinates) => ({
          type: "Feature",
          properties: {},
          geometry: { type: "LineString", coordinates },
        })),
      });
      upsertSource(instance, SRC_STOPS, stopFeatures(positions, names, nearestIndex));

      if (!instance.getLayer("app-route-line")) {
        instance.addLayer({
          id: "app-route-casing",
          type: "line",
          source: SRC_LINE,
          layout: { "line-cap": "round", "line-join": "round" },
          paint: {
            "line-color": "#000000",
            "line-opacity": 0.35,
            "line-width": ["interpolate", ["linear"], ["zoom"], 10, 5, 16, 9],
          },
        });
        instance.addLayer({
          id: "app-route-line",
          type: "line",
          source: SRC_LINE,
          layout: { "line-cap": "round", "line-join": "round" },
          paint: {
            "line-color": colour,
            "line-width": ["interpolate", ["linear"], ["zoom"], 10, 2.5, 16, 5],
          },
        });
        instance.addLayer({
          id: "app-route-arrows",
          type: "symbol",
          source: SRC_LINE,
          layout: {
            "symbol-placement": "line",
            "symbol-spacing": 110,
            "text-optional": true,
            "text-field": "\u25B6",
            "text-size": 10,
            "text-keep-upright": false,
            "text-allow-overlap": true,
          },
          paint: {
            "text-color": colour,
            "text-halo-color": "#000000",
            "text-halo-width": 1,
            "text-opacity": ["interpolate", ["linear"], ["zoom"], 12, 0, 13, 1],
          },
        });
        painted = paintStopFlags(instance, colour, surface, rail, number, names, painted);
        /*
         * A stop dot is four pixels across at best, which is nothing to aim a
         * thumb at. This invisible circle is what actually receives the tap.
         */
        instance.addLayer({
          id: LYR_HIT,
          type: "circle",
          source: SRC_STOPS,
          paint: { "circle-radius": 14, "circle-color": "rgba(0,0,0,0)" },
        });

        // A ring around the foot of the open stop's pole - where it stands,
        // which is the point the rest of the screen is talking about.
        instance.addLayer({
          id: "app-stop-selected",
          type: "circle",
          source: SRC_STOPS,
          paint: {
            "circle-radius": ringRadius(3, LIT),
            "circle-color": colour,
            "circle-opacity": LIT,
            "circle-stroke-color": "#ffffff",
            "circle-stroke-width": 2.5,
            "circle-stroke-opacity": LIT,
          },
        });

        // A soft pool of the route's colour spreading out from it, which is
        // what makes the pick read as a settle rather than a switch.
        instance.addLayer({
          id: "app-stop-selected-glow",
          type: "circle",
          source: SRC_STOPS,
          paint: {
            "circle-radius": ringRadius(14, LIT),
            "circle-color": colour,
            "circle-opacity": ["*", 0.18, LIT],
            "circle-blur": 0.6,
          },
        });

        // And a hollow one under whichever pole the pointer is over: the stop
        // that would be picked, shown before it is.
        instance.addLayer({
          id: "app-stop-hover",
          type: "circle",
          source: SRC_STOPS,
          paint: {
            "circle-radius": ringRadius(5, HOVER),
            "circle-color": colour,
            "circle-opacity": ["*", 0.14, HOVER],
            "circle-stroke-color": colour,
            "circle-stroke-width": 2,
            "circle-stroke-opacity": ["*", 0.95, HOVER],
          },
        });

        /*
         * Every stop says its name, not only the one that was tapped. A row of
         * anonymous dots asks the rider to guess which is theirs, and a map of
         * a bus route is mostly a question about where along it a name sits.
         *
         * The names are not all drawn at once - MapLibre drops any that would
         * collide, so zoomed out a forty-stop route shows the few that fit and
         * fills in the rest as you zoom. `symbol-sort-key` decides who wins
         * that contest: the open stop first, then where you are, then the two
         * ends of the route, then everything else.
         */
        instance.addLayer({
          id: LYR_LABEL,
          type: "symbol",
          source: SRC_STOPS,
          layout: {
            "icon-image": ["case", SELECTED, ["concat", ["get", "icon"], "-on"], ["get", "icon"]],
            // The foot of the pole is the stop; everything else is above it.
            "icon-anchor": "bottom",
            "icon-allow-overlap": true,
            "icon-size": flagSize(),
            "text-field": ["get", "name"],
            "text-size": ["case", ["==", ["get", "selected"], 1], 11.5, LABEL_SIZE],
            /*
             * The name stands directly over its own flag, clear of the top of
             * it. One fixed side rather than whichever has room: a name that
             * hops from one side of the pole to the other as the map pans
             * reads as a different stop's name, and one laid across the flag
             * reads as neither. The offset is derived from the flag's drawn
             * height, so the two never touch at any zoom.
             */
            "text-variable-anchor": ["bottom"],
            "text-radial-offset": labelOffset(),
            "text-justify": "center",
            // A flag with nowhere to put its name is still a flag.
            "text-optional": true,
            "text-max-width": 8,
            "text-padding": 4,
            "symbol-sort-key": [
              "case",
              ["==", ["get", "selected"], 1],
              0,
              ["==", ["get", "nearest"], 1],
              1,
              ["==", ["get", "terminus"], 1],
              2,
              3,
            ],
          },
          paint: {
            /*
             * The stop being read is white; the rest are quieter, so the map
             * still has a subject rather than forty equal shouts.
             */
            "text-color": labelColour(colour, dark),
            "text-halo-color": dark ? "#000000" : "#ffffff",
            "text-halo-width": 1.6,
          },
        });
      } else {
        instance.setPaintProperty("app-route-line", "line-color", colour);
        instance.setPaintProperty("app-stop-selected", "circle-color", colour);
        instance.setPaintProperty("app-stop-hover", "circle-stroke-color", colour);
        instance.setPaintProperty("app-stop-hover", "circle-color", colour);
        instance.setPaintProperty("app-stop-selected-glow", "circle-color", colour);
        instance.setPaintProperty(LYR_LABEL, "text-color", labelColour(colour, dark));
        // Colour, route number and stop names are all baked into the signs,
        // so they are repainted whenever any of them moves.
        painted = paintStopFlags(instance, colour, surface, rail, number, names, painted);
      }

      /*
       * The other half of the ordering the bus effect does: whichever of the
       * two ran last has to put the buses back on top, or a sign added after
       * the first bus arrived is drawn over the one thing on the map that is
       * moving now.
       */
      for (const id of ["app-bus-nose", "app-bus-dot"]) {
        if (instance.getLayer(id)) instance.moveLayer(id);
      }

      /*
       * Where the map opens. A rider on a route page is standing somewhere on
       * it, so the useful first view is the stops around them, not the whole
       * forty-stop line reduced to a thread - the 全程 button is there for
       * that. The whole route is only the opening view until the location
       * arrives; once it has, the map frames the nearest stop and its
       * neighbours and is then left alone, because refitting under a rider who
       * has started panning is worse than any first view.
       */
      if (opened === "nearest") return;

      const bounds = new LngLatBounds();
      if (nearestIndex === undefined) {
        for (const line of lines) for (const point of line) bounds.extend(point);
        for (const point of positions) bounds.extend(point);
      } else {
        const from = Math.max(0, nearestIndex - NEIGHBOURS);
        const to = Math.min(positions.length - 1, nearestIndex + NEIGHBOURS);
        for (let index = from; index <= to; index += 1) {
          const point = positions[index];
          if (point) bounds.extend(point);
        }
      }
      if (bounds.isEmpty()) return;

      instance.fitBounds(bounds, {
        padding: 48,
        duration: opened === "route" ? 500 : 0,
        maxZoom: nearestIndex === undefined ? 15 : 16,
      });
      opened = nearestIndex === undefined ? "route" : "nearest";
    },
  );

  /*
   * Selection lives in its own effect: folding it into the geometry effect
   * would refit the whole route every time a stop is opened, throwing the map
   * back to the top of the line each time.
   */
  createEffect(
    () => ({
      instance: map(),
      positions: markerPositions(),
      names: stopNames(),
      nearestIndex: props.nearestIndex,
      selectedIndex: props.selectedIndex,
    }),
    ({ instance, positions, names, nearestIndex, selectedIndex }) => {
      if (!instance || !instance.getSource(SRC_STOPS)) return;

      upsertSource(
        instance,
        SRC_STOPS,
        stopFeatures(positions, names, nearestIndex, selectedIndex),
      );

      const target = selectedIndex !== undefined ? positions[selectedIndex] : undefined;
      // Only chase the stop if it has gone off screen; panning under a rider
      // who is reading is worse than leaving the map where they put it.
      if (target && !instance.getBounds().contains(target)) {
        instance.easeTo({ center: target, duration: 420 });
      }
    },
  );

  /*
   * How the roads under this route are moving, painted on the line itself.
   *
   * The department's detectors cover the strategic network, so a route
   * colours through its trunk-road middle and stays quiet on the estate
   * streets at its ends. Free flow is not drawn at all - the layer marks
   * trouble - and the ribbon rides on top of the route line inside a casing
   * of the map's own surface, so a red stretch reads as the road's state and
   * never blurs into an operator whose brand is the same red.
   */
  const roadgoing = () =>
    props.route.co.some((co) => kindOf(co) === "bus" || kindOf(co) === "minibus");

  const [trafficSpeeds, setTrafficSpeeds] = createSignal<Map<number, number> | null>(null);

  /** The links riding this route's corridor, cut once per drawn shape. */
  const corridor = createMemo(() => {
    // Only the published geometry is a corridor; the straight hops the map
    // falls back to would sweep up roads the bus never touches.
    const lines = shape();
    const links = roadgoing() ? trafficShapes() : null;
    if (!lines || !links) return null;
    return segmentsAlong(lines, links);
  });

  createEffect(
    () => Boolean(map()) && frameInView() && roadgoing(),
    (watching) => {
      if (!watching) return;
      let alive = true;
      const poll = () => {
        void fetchTrafficSpeeds().then((speeds) => {
          if (alive && speeds) setTrafficSpeeds(speeds);
        });
      };
      poll();
      const timer = setInterval(poll, TRAFFIC_REFRESH_MS);
      return () => {
        alive = false;
        clearInterval(timer);
      };
    },
  );

  createEffect(
    () => ({
      instance: map(),
      ids: corridor(),
      speeds: trafficSpeeds(),
      dark: prefersDark(settings.theme()),
    }),
    ({ instance, ids, speeds, dark }) => {
      // The route layers own the stacking order; nothing to ride on yet.
      if (!instance || !instance.getLayer("app-route-line")) return;

      const links = trafficShapes();
      const features: GeoJSON.Feature[] = [];
      for (const id of ids ?? []) {
        const speed = speeds?.get(id);
        const level = speed === undefined ? null : trafficLevel(speed);
        if (!level) continue;
        for (const line of links?.get(id) ?? []) {
          features.push({
            type: "Feature",
            properties: { level },
            geometry: { type: "LineString", coordinates: line },
          });
        }
      }

      const surface = dark ? "#0c0f14" : "#ffffff";
      const slow = dark ? "#fbbf24" : "#f59e0b";
      const congested = dark ? "#ff5a5a" : "#e02020";
      const colour = ["match", ["get", "level"], "congested", congested, slow] as never;

      upsertSource(instance, SRC_TRAFFIC, { type: "FeatureCollection", features });

      if (!instance.getLayer("app-traffic-line")) {
        // Above the route line, below its arrows - part of the line, not of
        // the road labels and stops above it.
        instance.addLayer(
          {
            id: "app-traffic-casing",
            type: "line",
            source: SRC_TRAFFIC,
            layout: { "line-cap": "round", "line-join": "round" },
            paint: {
              "line-color": surface,
              "line-width": ["interpolate", ["linear"], ["zoom"], 10, 5, 16, 9],
            },
          },
          "app-route-arrows",
        );
        instance.addLayer(
          {
            id: "app-traffic-line",
            type: "line",
            source: SRC_TRAFFIC,
            layout: { "line-cap": "round", "line-join": "round" },
            paint: {
              "line-color": colour,
              "line-width": ["interpolate", ["linear"], ["zoom"], 10, 2.5, 16, 5],
            },
          },
          "app-route-arrows",
        );
      } else {
        instance.setPaintProperty("app-traffic-casing", "line-color", surface);
        instance.setPaintProperty("app-traffic-line", "line-color", colour);
      }
    },
  );

  const recentre = () => {
    const instance = map();
    const me = props.me;
    if (instance && me) instance.easeTo({ center: [me.lng, me.lat], zoom: 15, duration: 500 });
  };

  /*
   * The opened-out map rests a sheet over its foot and runs under the
   * notch: the bottom control column lifts clear of the one, the top
   * column drops clear of the other. Styling the columns styles everything
   * standing in them at once.
   */
  createEffect(
    () => ({ mount: corner(), up: expanded() }),
    ({ mount, up }) => {
      if (!mount) return;
      mount.style.bottom = up ? `${sheetHeight()}px` : "";
      const tops = mount.parentElement?.querySelector<HTMLElement>(".maplibregl-ctrl-top-left");
      if (tops) tops.style.top = up ? "max(0px, calc(env(safe-area-inset-top) - 10px))" : "";
    },
  );

  /**
   * Take me to the bus - and, pressed again, to the one behind it.
   *
   * A bus on a forty-stop route is one badge in a metre of line, and on a
   * phone most of that line is off screen - so the one question the map
   * exists to answer needs an answer that does not involve hunting. The
   * first press goes to the bus that matters most: the one the open stop is
   * waiting for, or failing that the one furthest along. Each press after
   * steps back through the rest and wraps, so a route with three buses is
   * three presses rather than a search - and with one bus, every press is
   * "find it again".
   */
  let visitedBus = "";
  const frameBuses = () => {
    const instance = map();
    const measured = track();
    if (!instance || !measured || trails.size === 0) return;

    const here = [...trails.entries()]
      .map(([id, trail]) => ({
        id,
        measure: trail.measure,
        position: pointAt(measured.line, trail.measure).position,
      }))
      // Front of the route first, so "next" reads down the stop list.
      .sort((a, b) => b.measure - a.measure);

    const selected = props.selectedIndex;
    const limit = selected === undefined ? undefined : measured.measures[selected];
    // The last bus still short of the open stop is the next to reach it.
    const coming = limit === undefined ? undefined : here.find((bus) => bus.measure <= limit);

    const at = here.findIndex((bus) => bus.id === visitedBus);
    // A remembered bus has gone - or nothing is remembered: start over at
    // the one that matters. Otherwise, the next one back.
    const target = (
      at === -1 ? (coming ?? here[0]) : here[(at + 1) % here.length]
    ) as (typeof here)[number];
    visitedBus = target.id;

    instance.easeTo({
      center: target.position,
      // Off-centre by half the sheet, so the bus does not land behind it.
      offset: expanded() ? [0, -sheetHeight() / 2] : [0, 0],
      // Close enough to read the road it is on, without throwing away a
      // wider view the rider has deliberately zoomed out to.
      zoom: Math.max(instance.getZoom(), 15),
      duration: 600,
    });
  };

  /**
   * The sheet over an opened-out map is the stop list, brought to the stop
   * the map is about. It rests low and can be pulled up; below its top rest
   * it does not scroll, because a finger moving up on content that can scroll
   * is scrolling it and the sheet would never rise - held low it is a window
   * onto its first rows and the whole sheet is what the finger moves. It
   * never goes away: pushed down it comes back, and only the button that
   * opened the map out puts it back.
   */
  const [listSnap, setListSnap] = createSignal(0);
  const listScrolls = () => listSnap() >= 1;

  /** How much of the opened-out map the sheet covers at rest, in pixels. */
  const sheetHeight = () => Math.round(container.clientHeight * SHEET_LOW);

  /** Room for the sheet at the bottom, when there is a sheet. */
  const framePadding = (edge: number) =>
    expanded() ? { top: edge, left: edge, right: edge, bottom: edge + sheetHeight() } : edge;

  const fitRoute = () => {
    const instance = map();
    if (!instance) return;
    const bounds = new LngLatBounds();
    for (const point of stopPositions()) bounds.extend(point);
    if (!bounds.isEmpty()) {
      instance.fitBounds(bounds, { padding: framePadding(48), maxZoom: 15, duration: 500 });
    }
  };

  // A mouse has no pinch, and scroll-to-zoom is not discoverable from a
  // still map; a whole zoom level per press, about what one pinch covers.
  const zoomStep = (delta: number) => {
    const instance = map();
    if (instance) instance.zoomTo(instance.getZoom() + delta, { duration: 240 });
  };

  /**
   * The route as one continuous line with a distance at every point, and every
   * stop's distance along it.
   *
   * `null` when the geometry and the stop list are describing different roads,
   * which does happen - and a bus placed on a line the route does not follow is
   * worse than no bus at all, so nothing is drawn in that case.
   */
  const track = createMemo(() => {
    const stops = stopPositions();
    if (stops.length < 2) return null;
    return measureStops(measureLine(stitchLines(shape() ?? [stops])), stops);
  });

  /** What each bus marker is currently showing. Survives every poll. */
  const trails = new Map<string, Trail>();

  /*
   * How many buses are actually on the map, which is not the same as how many
   * were worked out: geometry the route does not fit puts none of them
   * anywhere. The note explaining the badges is driven by this rather than by
   * the count handed in, so it can never end up explaining an empty map.
   *
   * Written from inside an effect, which Solid 2 wants told is deliberate.
   */
  const [drawn, setDrawn] = createSignal(0, { ownedWrite: true });

  /**
   * The estimated buses, and the one piece of motion on this map that is not a
   * response to a gesture.
   *
   * It moves because the thing it stands for is moving. Between polls the
   * marker creeps at the pace the estimate implies rather than waiting twenty
   * seconds and jumping, and when a poll disagrees with where it has crept to,
   * the disagreement is absorbed over a few hundred milliseconds instead of
   * teleporting. A rider watching a bus approach their stop is reading the
   * movement, not the marker.
   */
  createEffect(
    () => ({
      instance: map(),
      vehicles: props.feed?.vehicles ?? [],
      measured: track(),
      colour: lineColour(props.route),
      kind: vehicleKind(props.route.co),
      dark: prefersDark(settings.theme()),
      inView: frameInView(),
      // Tracked here so the creep re-arms at the right cadence the moment
      // the map opens out - and so the loop below never has to read a
      // signal from inside a frame callback, which dev flags on every tick.
      full: expanded(),
    }),
    ({ instance, vehicles, measured, colour, kind, dark, inView, full }) => {
      if (!instance) return;
      // Off screen there is nothing to place or to creep; the re-run when the
      // frame comes back does the whole reconcile against fresh positions.
      if (!inView) return;

      const empty: FeatureCollection = { type: "FeatureCollection", features: [] };
      if (!measured || vehicles.length === 0) {
        if (instance.getSource(SRC_BUS)) {
          upsertSource(instance, SRC_BAND, empty);
          upsertSource(instance, SRC_BUS, empty);
        }
        trails.clear();
        setDrawn(0);
        return;
      }

      const surface = dark ? "#0c0f14" : "#ffffff";
      const now = Date.now();

      /*
       * Reconcile what is drawn with what has just been worked out. A bus we
       * were already following keeps its marker and takes the difference as an
       * offset to be eased away; one we have not seen before simply appears
       * where it is.
       */
      const seen = new Set<string>();
      for (const vehicle of vehicles) {
        const raw = measureOf(vehicle, measured, now);
        if (raw === null) continue;
        seen.add(vehicle.id);
        const trail = trails.get(vehicle.id);
        if (trail) {
          trail.offset = trail.measure - raw;
          trail.offsetAt = now;
        } else {
          trails.set(vehicle.id, { measure: raw, offset: 0, offsetAt: now });
        }
      }
      // Deleting while iterating a Map is safe, and this is the only place a
      // bus that is no longer reported gets to leave the screen.
      for (const id of trails.keys()) if (!seen.has(id)) trails.delete(id);
      setDrawn(seen.size);

      const draw = (at: number) => {
        const points: FeatureCollection["features"] = [];
        const bands: FeatureCollection["features"] = [];

        for (const vehicle of vehicles) {
          const trail = trails.get(vehicle.id);
          const raw = measureOf(vehicle, measured, at);
          if (!trail || raw === null) continue;

          const settled = easeOutCubic(Math.min(1, (at - trail.offsetAt) / SETTLE_MS));
          const eased = raw + trail.offset * (1 - settled);
          trail.measure = trail.offset > BACKSLIDE_METRES ? eased : Math.max(eased, trail.measure);

          const half = spreadMetres(vehicle, measured, at) / 2;
          const here = pointAt(measured.line, trail.measure);

          points.push({
            type: "Feature",
            // On the compass, 0-360: the layer below picks a drawing by half.
            properties: { bearing: (here.bearing + 360) % 360 },
            geometry: { type: "Point", coordinates: here.position },
          });
          bands.push({
            type: "Feature",
            properties: {},
            geometry: {
              type: "LineString",
              coordinates: sliceLine(measured.line, trail.measure - half, trail.measure + half),
            },
          });
        }

        upsertSource(instance, SRC_BAND, { type: "FeatureCollection", features: bands });
        upsertSource(instance, SRC_BUS, { type: "FeatureCollection", features: points });
      };

      draw(now);

      if (!instance.getLayer("app-bus-dot")) {
        /*
         * The band goes down first and stays under the badge: it is the claim
         * being qualified, and a smear drawn over the marker would read as the
         * marker being blurred rather than the position being uncertain.
         */
        instance.addLayer(
          {
            id: "app-bus-band",
            type: "line",
            source: SRC_BAND,
            layout: { "line-cap": "round" },
            paint: {
              "line-color": bandColour(dark),
              "line-width": ["interpolate", ["linear"], ["zoom"], 11, 8, 16, 19],
              "line-opacity": 0.5,
              "line-blur": 5,
            },
          },
          /*
           * Under the route line, so the band shows as a glow spilling out
           * either side of it. Over the top it washed a long stretch of the
           * line pink, which reads as the line being uncertain rather than the
           * bus, and costs the route the one colour that identifies it.
           */
          instance.getLayer("app-route-casing") ? "app-route-casing" : undefined,
        );
        instance.addLayer({
          id: "app-bus-nose",
          type: "symbol",
          source: SRC_BUS,
          layout: {
            "icon-image": IMG_NOSE,
            "icon-rotate": ["get", "bearing"],
            // Turn with the road, not with the screen.
            "icon-rotation-alignment": "map",
            "icon-allow-overlap": true,
            "icon-ignore-placement": true,
            "icon-size": busSize(),
          },
          paint: {
            /*
             * Which way a bus four pixels across is pointed is not information
             * anybody can use, so the heading arrives at the zoom where the
             * road it is on becomes legible - the same zoom the route's own
             * arrows appear at.
             */
            "icon-opacity": ["interpolate", ["linear"], ["zoom"], 12.5, 0, 13.5, 1],
          },
        });
        /*
         * The vehicle points the way it is going, like the nose in front of
         * it. The drawing faces right, so it is turned by the bearing less a
         * quarter turn - and for a heading with west in it the mirror image
         * is turned the other way instead, because a bus heading west by
         * rotation alone is a bus on its roof. Either way the wheels stay
         * under it and the cab leads.
         */
        const eastbound: ExpressionSpecification = ["<", ["get", "bearing"], 180];
        instance.addLayer({
          id: "app-bus-dot",
          type: "symbol",
          source: SRC_BUS,
          layout: {
            "icon-image": ["case", eastbound, IMG_BUS, IMG_BUS_WEST],
            "icon-rotate": [
              "case",
              eastbound,
              ["-", ["get", "bearing"], 90],
              ["-", ["get", "bearing"], 270],
            ],
            "icon-rotation-alignment": "map",
            "icon-allow-overlap": true,
            "icon-ignore-placement": true,
            "icon-size": busSize(),
          },
        });
        paintBus(instance, colour, kind);
      } else {
        instance.setPaintProperty("app-bus-band", "line-color", bandColour(dark));
        paintBus(instance, colour, kind);
      }

      /*
       * Restack, every time. The route and stop layers are added when the
       * geometry arrives, which may be before or after the first bus does, so
       * neither effect can rely on having gone first: the badges are lifted
       * above the furniture, because the live thing on the map is the thing in
       * front, and the band is pushed back under the route line, where it
       * shows as a glow spilling either side instead of washing a long stretch
       * of the line pink.
       */
      if (instance.getLayer("app-route-casing")) {
        instance.moveLayer("app-bus-band", "app-route-casing");
      }
      instance.moveLayer("app-bus-nose");
      instance.moveLayer("app-bus-dot");

      /*
       * Reduced motion takes the creep away, not the buses: the marker is then
       * placed once per poll, which is the same information arriving without
       * anything sliding across the screen.
       */
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

      let frame = 0;
      let last = now;
      const loop = () => {
        const at = Date.now();
        if (at - last >= (full ? CREEP_MS : CREEP_PREVIEW_MS) && at - scrolledAt > 150) {
          last = at;
          draw(at);
        }
        frame = requestAnimationFrame(loop);
      };
      frame = requestAnimationFrame(loop);
      return () => cancelAnimationFrame(frame);
    },
  );

  // Opening the map out is the moment sharpness starts being worth paying
  // for; putting it back is the moment it stops.
  createEffect(
    () => ({ instance: map(), full: expanded() }),
    ({ instance, full }) => {
      if (!instance) return;
      instance.setPixelRatio(mapPixelRatio(full));
    },
  );

  // The user's own position is a separate source so it updates without
  // touching the route geometry.
  createEffect(
    () => ({ instance: map(), me: props.me, target: props.walkTarget, lang: props.lang }),
    ({ instance, me, target, lang }) => {
      if (!instance) return;

      // The walk to the nearest stop: a dotted path and how long it takes,
      // in the map's own language instead of a sentence under the frame.
      upsertSource(instance, SRC_WALK, {
        type: "FeatureCollection",
        features:
          me && target
            ? [
                {
                  type: "Feature",
                  properties: {},
                  geometry: {
                    type: "LineString",
                    coordinates: [
                      [me.lng, me.lat],
                      [target.lng, target.lat],
                    ],
                  },
                },
                {
                  type: "Feature",
                  properties: {
                    label: `${t("walk", lang)} ${walkMinutes(distanceM(me, target))} ${t("minute", lang)}`,
                  },
                  geometry: {
                    type: "Point",
                    coordinates: [(me.lng + target.lng) / 2, (me.lat + target.lat) / 2],
                  },
                },
              ]
            : [],
      });

      if (!instance.getLayer("app-walk-line")) {
        // Under the rider's own dot, which is the one thing here that must
        // never be covered.
        const beforeMe = instance.getLayer("app-me-halo") ? "app-me-halo" : undefined;
        instance.addLayer(
          {
            id: "app-walk-line",
            type: "line",
            source: SRC_WALK,
            filter: ["==", ["geometry-type"], "LineString"],
            layout: { "line-cap": "round" },
            paint: {
              "line-color": ACCENT,
              "line-width": 3,
              "line-opacity": 0.85,
              // Zero-length dashes with round caps read as a dotted walkway,
              // the same vocabulary the rail network map uses.
              "line-dasharray": [0, 2.2],
            },
          },
          beforeMe,
        );
        instance.addLayer(
          {
            id: "app-walk-label",
            type: "symbol",
            source: SRC_WALK,
            filter: ["==", ["geometry-type"], "Point"],
            layout: {
              "text-field": ["get", "label"],
              "text-size": 11,
              "text-offset": [0, -0.9],
              "text-allow-overlap": true,
            },
            paint: {
              "text-color": ACCENT,
              "text-halo-color": "#0c0f14",
              "text-halo-width": 1.4,
            },
          },
          beforeMe,
        );
      }

      upsertSource(instance, SRC_ME, {
        type: "FeatureCollection",
        features: me
          ? [
              {
                type: "Feature",
                properties: {},
                geometry: { type: "Point", coordinates: [me.lng, me.lat] },
              },
            ]
          : [],
      });

      if (!instance.getLayer("app-me-dot")) {
        instance.addLayer({
          id: "app-me-halo",
          type: "circle",
          source: SRC_ME,
          paint: { "circle-radius": 17, "circle-color": ACCENT, "circle-opacity": 0.16 },
        });
        instance.addLayer({
          id: "app-me-dot",
          type: "circle",
          source: SRC_ME,
          paint: {
            "circle-radius": 7,
            "circle-color": ACCENT,
            "circle-stroke-color": "#0c0f14",
            "circle-stroke-width": 2.5,
          },
        });
      }
    },
  );

  /** Whether the map has already been sized once; the first pass is not a change. */
  let framed = false;

  createEffect(
    () => ({ instance: map(), open: expanded() }),
    ({ instance, open }) => {
      if (!instance) return;

      const resized = framed;
      framed = true;

      /*
       * The canvas is sized in device pixels at draw time, so a box that
       * changed underneath it has to be announced - otherwise the map paints
       * the old rectangle into the new one and the tiles come out stretched.
       */
      const frame = requestAnimationFrame(() => {
        instance.resize();
        /*
         * And re-frame it. The window is several times the area of the strip
         * the map sits in, so holding the camera still turns an opened-out map
         * into the same route drawn small in the middle of a lot of nothing.
         */
        if (resized) fitRoute();
      });

      if (!open) return () => cancelAnimationFrame(frame);

      /*
       * Two fingers to pan is a rule about not stealing the page's scroll.
       * There is no page behind a full-window map, so the rule only gets in
       * the way of the one thing the rider opened it out to do.
       */
      instance.cooperativeGestures?.disable();

      // Nothing behind a full-window map should scroll under it.
      document.documentElement.classList.add("app-locked");

      const onKey = (event: KeyboardEvent) => {
        if (event.key === "Escape") setExpanded(false);
      };
      window.addEventListener("keydown", onKey);

      return () => {
        cancelAnimationFrame(frame);
        window.removeEventListener("keydown", onKey);
        document.documentElement.classList.remove("app-locked");
        instance.cooperativeGestures?.enable();
      };
    },
  );

  /*
   * The sheet opens on the stop the map is about, and follows a new pick: the
   * row is brought to the top of the sheet, where the peek shows it whole.
   * The rows are a second copy of the page's list, so the row is found inside
   * the sheet rather than in the document, where the page's copy comes first.
   */
  const [sheetList, setSheetList] = createSignal<HTMLDivElement | null>(null);
  createEffect(
    () => ({
      list: sheetList(),
      open: expanded(),
      seq:
        props.selectedIndex !== undefined
          ? props.selectedIndex + 1
          : props.nearestIndex !== undefined && props.nearestIndex >= 0
            ? props.nearestIndex + 1
            : null,
    }),
    ({ list, open, seq }) => {
      if (!list || !open || seq === null) return;
      // After the rows have laid out; a sheet still sliding in has no scroll to set.
      const frame = requestAnimationFrame(() => {
        const row = list.querySelector<HTMLElement>(`[data-stop-seq="${seq}"]`);
        if (!row) return;
        const top = row.getBoundingClientRect().top - list.getBoundingClientRect().top;
        list.scrollTo({ top: list.scrollTop + top });
      });
      return () => cancelAnimationFrame(frame);
    },
  );

  /* The pick settles rather than switches: the ring under the last stop lets
     go as the one under the new stop takes hold, over the same few frames. */
  createEffect(
    () => ({ index: props.selectedIndex, drive: tween() }),
    ({ index, drive }, previous) => {
      if (!drive) return;
      const before = previous?.index;
      if (before !== undefined && before !== index) drive(before, "lit", 0);
      if (index !== undefined) drive(index, "lit", 1);
    },
  );

  const mapHeight = () => {
    if (usable() === false) return "";
    return expanded() ? "h-full" : (props.heightClass ?? "h-[18rem]");
  };

  /**
   * What the map has to say about the buses, in one line, always.
   *
   * An empty map is the same picture whether the answer is still coming, the
   * road is genuinely empty, the operator publishes nothing, the request
   * failed, or the geometry could not be trusted to carry a bus. A rider
   * cannot tell those apart by looking, and silence reads as broken - so the
   * corner says which one it is, every time, including when everything is
   * working.
   */
  const note = (): "loading" | "estimated" | "unplaceable" | "none" | VehicleFeed["status"] => {
    const feed = props.feed;
    if (!feed) return "loading";
    if (feed.status !== "ready") return feed.status;
    if (drawn() > 0) return "estimated";
    // Worked out, and then nowhere to put them: the line the stops sit on is
    // not the line this route is drawn along. Saying so beats drawing a bus in
    // the harbour, and beats saying nothing.
    return feed.vehicles.length > 0 ? "unplaceable" : "none";
  };

  const noteLabel = () => {
    switch (note()) {
      case "loading":
        return t("busFinding", props.lang);
      case "estimated":
        return t("mapEstimated", props.lang);
      case "unplaceable":
        return t("busUnplaceable", props.lang);
      case "scheduled":
        return t("busTimetableOnly", props.lang);
      case "unavailable":
        return t("busNoLiveFeed", props.lang);
      case "failed":
        return t("busFetchFailed", props.lang);
      default:
        return t("busNoneRunning", props.lang);
    }
  };

  const controlClass = MAP_CONTROL;

  return (
    <>
      {/* A flex column, so a height class of `flex-1` on the canvas lets it
          fill a card that is itself filling its column - the map's height then
          comes from the window rather than from a number. */}
      <div
        class={expanded() ? "fixed inset-0 z-50 bg-map" : "relative flex min-h-0 flex-1 flex-col"}
      >
        <div
          ref={(el: HTMLDivElement) => {
            container = el;
            watchFrame(el);
          }}
          // Kept in the layout while loading so MapLibre can measure it, then
          // collapsed if it turns out the map will never paint.
          class={`w-full bg-map ${mapHeight()}`}
          style={{ height: usable() === false ? "0" : undefined, overflow: "hidden" }}
          aria-label="route map"
        />

        {/*
         * Opened out, the map takes the whole window - and takes the arrivals
         * off screen with it, which are the reason the rider is on this page.
         * The sheet brings them back: the stop the map is talking about, and
         * when the next buses reach it, under a map you can still pan.
         *
         * It floats rather than resizes the map, so the route keeps the full
         * height it was opened out for; the camera moves pad themselves clear
         * of it instead.
         */}
        <Show when={usable() && props.list}>
          {(list) => (
            <Drawer
              open={expanded()}
              onClose={() => setExpanded(false)}
              within
              dismissible={false}
              snapPoints={[SHEET_LOW, SHEET_TALL]}
              snap={listSnap()}
              onSnapChange={setListSnap}
              label={t("mapSheet", props.lang)}
              class="lg:max-w-[36rem]"
            >
              {/* Built only while the map is opened out, so no arrivals are
                  laid out for a sheet nobody can see. As tall as the part of
                  the sheet that shows at whichever rest it is at, so the
                  visible part is the scrolling part. */}
              <Show when={expanded()}>
                <div
                  ref={setSheetList}
                  class={[
                    "app-scroll min-h-0 pb-safe-bottom",
                    listScrolls() ? "touch-pan-y overflow-y-auto" : "overflow-hidden",
                  ]}
                  style={{ height: "var(--snap-point-height)" }}
                >
                  {list()()}
                </div>
              </Show>
            </Drawer>
          )}
        </Show>

        {/* Panning a map with no way back is a trap; these are the way back. */}
        <Show when={usable()}>
          <div
            class="absolute right-2.5 top-2.5 flex flex-col gap-2"
            // Clear of the notch once the map owns the whole window.
            style={expanded() ? { top: "max(0.625rem, env(safe-area-inset-top))" } : undefined}
          >
            <button
              type="button"
              aria-label={t(expanded() ? "mapCollapse" : "mapExpand", props.lang)}
              title={t(expanded() ? "mapCollapse" : "mapExpand", props.lang)}
              aria-pressed={expanded() ? "true" : "false"}
              onClick={() => setExpanded((open) => !open)}
              class={controlClass}
            >
              <Show when={expanded()} fallback={<ExpandIcon size={15} />}>
                <CloseIcon size={15} />
              </Show>
            </button>
            <button
              type="button"
              aria-label={t("mapWholeRoute", props.lang)}
              title={t("mapWholeRoute", props.lang)}
              onClick={fitRoute}
              class={controlClass}
            >
              <RouteIcon size={15} />
            </button>
            {/* A pair, spaced as one: in and out are halves of one control. */}
            <div class="flex flex-col gap-1">
              <button
                type="button"
                aria-label={t("mapZoomIn", props.lang)}
                onClick={() => zoomStep(1)}
                class={controlClass}
              >
                <PlusIcon size={15} />
              </button>
              <button
                type="button"
                aria-label={t("mapZoomOut", props.lang)}
                onClick={() => zoomStep(-1)}
                class={controlClass}
              >
                <MinusIcon size={15} />
              </button>
            </div>
          </div>

          {/* Where am I, opposite where is the bus: the two questions a rider
              stands at a kerb with, one at each lower corner. Above the sheet
              once the opened-out map has one. */}
          <Show when={props.me}>
            <div
              class="absolute bottom-2.5 right-2.5"
              style={expanded() ? { bottom: `${sheetHeight() + 10}px` } : undefined}
            >
              <button
                type="button"
                aria-label={t("mapMyLocation", props.lang)}
                title={t("mapMyLocation", props.lang)}
                onClick={recentre}
                class={controlClass}
              >
                <PinIcon size={15} />
              </button>
            </div>
          </Show>

          {/* The question the map exists to answer, at the thumb's corner -
              and beside it, in a whisper, the honesty label: the buses are
              inferences, not position reports, and when there are none this
              is the explanation, without which a blank map reads as a broken
              one. Both mount into MapLibre's own bottom-left control column
              rather than being placed by hand, so everything in that corner
              shares one stacking system instead of trading magic offsets. */}
          <Show when={usable() && corner()} keyed>
            {(mount) => (
              <Portal mount={mount}>
                <div
                  class="maplibregl-ctrl flex items-center gap-1.5"
                  ref={(el) =>
                    queueMicrotask(() => {
                      // Whichever node the portal actually parented to the
                      // column - itself, or a wrapper - goes first in it.
                      const node = el.parentElement === mount ? el : el.parentElement;
                      if (node?.parentElement === mount && node !== mount.firstChild) {
                        mount.insertBefore(node, mount.firstChild);
                      }
                    })
                  }
                >
                  <Show when={drawn() > 0}>
                    <button
                      type="button"
                      aria-label={t("mapFindBus", props.lang)}
                      title={t("mapFindBus", props.lang)}
                      onClick={frameBuses}
                      class={controlClass}
                    >
                      <BusIcon size={15} />
                    </button>
                  </Show>
                  {/* The button's own height, so the corner reads as one row
                      of controls rather than a button with a sticker beside
                      it. */}
                  <div class="app-glass pointer-events-none flex h-[1.6rem] items-center gap-1 whitespace-nowrap rounded-full px-2 opacity-75 lg:h-9 lg:px-3">
                    <span
                      class={[
                        "size-1 rounded-full lg:size-1.5",
                        {
                          // Waiting has to look like waiting, or it looks
                          // like nothing.
                          "animate-pulse bg-subtle-foreground": note() === "loading",
                          "bg-faint-foreground": note() !== "loading" && note() !== "estimated",
                        },
                      ]}
                      style={
                        note() === "estimated"
                          ? { "background-color": lineColour(props.route) }
                          : undefined
                      }
                    />
                    <span class="text-[0.49rem] font-semibold text-subtle-foreground lg:text-[0.69rem]">
                      {noteLabel()}
                    </span>
                  </div>
                </div>
              </Portal>
            )}
          </Show>
        </Show>
      </div>
      <Show when={usable() === false}>
        <div class="flex items-center justify-center gap-2 border-b border-border bg-secondary px-5 py-2">
          <span class="text-[0.75rem] font-semibold text-subtle-foreground">
            {props.unavailableLabel}
          </span>
        </div>
      </Show>
    </>
  );
}

export default RouteMap;
