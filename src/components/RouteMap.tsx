import {
  AttributionControl,
  LngLatBounds,
  Map as MlMap,
  setWorkerUrl,
  type ExpressionSpecification,
  type GeoJSONSource,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { FeatureCollection } from "geojson";
import type { JSX } from "@solidjs/web";
import { Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js";
import { Drawer } from "~/components/Drawer";
import { BusIcon, CloseIcon, ExpandIcon, PinIcon, RouteIcon } from "~/components/Icons";
import { t, type Lang } from "~/lib/i18n";
import { whenIdleAfter } from "~/lib/idle";
import { fetchRouteShape, type Position } from "~/data/waypoints";
import { measureOf, spreadMetres } from "~/data/placement";
import type { VehicleFeed } from "~/data/useVehicles";
import type { KeyedRoute, StopEntry } from "~/data/types";
import type { LatLng } from "~/lib/geo";
import { measureLine, measureStops, pointAt, sliceLine, stitchLines } from "~/lib/alongLine";
import { plateStyle } from "~/lib/operators";
import { settings } from "~/stores/settings";

/**
 * Where the sheet over an opened-out map rests, as fractions of the window:
 * low enough that the route is what the window is for, high enough that the
 * first rows of the list show under the open stop and say there is more.
 */
const SHEET_PEEK = 0.28;
const SHEET_TALL = 0.9;

/**
 * Keyless CARTO basemaps: no API key, no sign-up, and one style per theme so
 * the map matches the rest of the app instead of glowing white in dark mode.
 * MapLibre renders their required attribution automatically.
 */
const STYLES = {
  dark: "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",
  light: "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json",
};

const SRC_LINE = "mb-route";
const SRC_STOPS = "mb-stops";
const SRC_ME = "mb-me";
const SRC_BUS = "mb-buses";
const SRC_BAND = "mb-bus-band";
const LYR_HIT = "mb-stop-hit";
const LYR_LABEL = "mb-stop-label";
const ACCENT = "#4ed8ce";

/*
 * MapLibre resolves its worker relative to its own module URL, which does not
 * survive bundling. Pointing it at the copy the build emits is what makes tiles
 * load at all - without this the map stays blank and reports no error.
 */
setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");

function prefersDark(choice: string): boolean {
  if (choice === "dark") return true;
  if (choice === "light") return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

/** Reads the plate colour back out so the line matches the operator's brand. */
function lineColour(route: KeyedRoute): string {
  const style = plateStyle(route.co, route.route);
  if (/^#[0-9a-f]{6}$/i.test(style.background)) return style.background;
  // A joint route has a gradient plate; use the first operator's colour.
  const first = /#([0-9a-f]{6})/i.exec(style.background);
  return first ? `#${first[1]}` : "#d71920";
}

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

const IMG_STOP = "mb-stop-flag";

/** `#rrggbb` at an opacity, for the halo gradients. */
function withAlpha(hex: string, alpha: number): string {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return hex;
  return `rgba(${parseInt(m[1]!, 16)}, ${parseInt(m[2]!, 16)}, ${parseInt(m[3]!, 16)}, ${alpha})`;
}

/** The sign a stop shows: its own, or the lit one while it is being read. */
const SELECTED = ["==", ["get", "selected"], 1] as ExpressionSpecification;
const HOVERED = ["boolean", ["feature-state", "hover"], false] as ExpressionSpecification;
/** Lit signs are a step larger, and their names sit a step further up to clear them. */
const LIT_SCALE = 1.16;

/** The name's colour: the route's own for the stop being read or pointed at. */
const labelColour = (colour: string, dark: boolean): ExpressionSpecification => [
  "case",
  SELECTED,
  colour,
  HOVERED,
  colour,
  dark ? "#b9c0cc" : "#4a5160",
];
/**
 * The marker's drawing grid, before `icon-size` scales it: the artwork is laid
 * out as if in a 54x58 SVG viewBox whose bottom edge is the pavement. The label
 * layer needs `height` to know how far above the stop the pole reaches.
 */
const FLAG = { width: 54, height: 58, ratio: 3 };

/** The weighted cone the pole stands in, as SVG path data. */
const FLAG_BASE = "M25.5 47.5h3l3.3 6.6a1.3 1.3 0 0 1-1.16 2.35h-7.28a1.3 1.3 0 0 1-1.16-2.35z";
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
  const { width, height, ratio } = FLAG;
  const canvas = document.createElement("canvas");
  canvas.width = width * ratio;
  canvas.height = height * ratio;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.scale(ratio, ratio);

  const cx = width / 2;
  const cy = 18;
  const radius = 17;

  /*
   * The stop being read wears a halo: a soft pool of its own colour and a
   * hard white ring outside the disc, so it is picked out from forty
   * identical signs at a glance and from across the map.
   */
  if (selected) {
    const halo = ctx.createRadialGradient(cx, cy, radius, cx, cy, radius + 9);
    halo.addColorStop(0, withAlpha(colour, 0.45));
    halo.addColorStop(1, withAlpha(colour, 0));
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(cx, cy, radius + 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 2.6;
    ctx.beginPath();
    ctx.arc(cx, cy, radius + 1.6, 0, Math.PI * 2);
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
 * Paints one sign per stop, since each carries its own name, and clears the
 * signs left over from a longer route.
 */
function paintStopFlags(
  instance: MlMap,
  colour: string,
  surface: string,
  number: string,
  names: string[],
  painted: number,
) {
  // Two signs per stop: the one it carries, and the one it carries while it is
  // the stop being read - the same sign, lit.
  names.forEach((name, index) => {
    for (const on of [false, true]) {
      const id = `${IMG_STOP}-${index}${on ? "-on" : ""}`;
      const image = stopFlagImage(colour, surface, number, name, on);
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

const IMG_BUS = "mb-bus-disc";
const IMG_NOSE = "mb-bus-nose";
/** The disc's own pixel grid, and the nose's, before `icon-size` scales them. */
const BUS = { size: 30, ratio: 3 };
const NOSE = { width: 30, height: 50, ratio: 3 };

/**
 * The bus itself: a white badge carrying a double-decker, head on.
 *
 * It is the stop pole inverted - white where the pole is coloured, coloured
 * where the pole is white - because a route map is already a chain of red
 * discs, and one more red disc among forty is furniture. The inversion is what
 * makes the moving thing the thing a rider sees first.
 *
 * Two windscreens stacked is the whole of the drawing, and the whole of the
 * point: it is the silhouette of the thing coming down the road, not a generic
 * vehicle pictogram. Everything else - the lit ring, the paper that is not
 * quite white at the bottom, the hairline outside it - is there to give a
 * twenty-pixel disc an edge and a light source, so it sits on the map rather
 * than on top of it.
 */
function busImage(colour: string) {
  const { size, ratio } = BUS;
  const canvas = document.createElement("canvas");
  canvas.width = size * ratio;
  canvas.height = size * ratio;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.scale(ratio, ratio);

  const centre = size / 2;
  const radius = centre - 3.4;

  // The disc, lifted off the basemap. Paper at the top, a shade cooler at the
  // bottom: flat white reads as a hole cut in the map.
  const face = ctx.createLinearGradient(0, centre - radius, 0, centre + radius);
  face.addColorStop(0, PAPER);
  face.addColorStop(1, "#e9edf3");

  ctx.save();
  ctx.shadowColor = "rgba(0, 0, 0, 0.5)";
  ctx.shadowBlur = 4;
  ctx.shadowOffsetY = 1.2;
  ctx.beginPath();
  ctx.arc(centre, centre, radius, 0, Math.PI * 2);
  ctx.fillStyle = face;
  ctx.fill();
  ctx.restore();

  // The operator's ring, lit from above like every other coloured face here.
  ctx.beginPath();
  ctx.arc(centre, centre, radius - 1.4, 0, Math.PI * 2);
  ctx.lineWidth = 2.8;
  ctx.strokeStyle = litFace(ctx, colour, centre - radius, centre + radius);
  ctx.stroke();

  // And a hairline outside it, which is what keeps a white badge from
  // dissolving into a pale basemap. Black at low opacity rather than the map's
  // own colour: on a dark basemap the badge already has all the edge it needs.
  ctx.beginPath();
  ctx.arc(centre, centre, radius + 0.3, 0, Math.PI * 2);
  ctx.lineWidth = 0.9;
  ctx.strokeStyle = "rgba(0, 0, 0, 0.22)";
  ctx.stroke();

  const bw = 11.5;
  const bh = 13;
  const bx = centre - bw / 2;
  const by = centre - bh / 2;

  ctx.fillStyle = litFace(ctx, colour, by, by + bh);
  roundedRect(ctx, bx, by, bw, bh, 2.8);
  ctx.fill();

  // Upper deck, lower deck, and the pair of lights under them.
  ctx.fillStyle = PAPER;
  roundedRect(ctx, bx + 1.7, by + 1.9, bw - 3.4, 3.5, 1.1);
  ctx.fill();
  roundedRect(ctx, bx + 1.7, by + 6.5, bw - 3.4, 3.1, 1.1);
  ctx.fill();

  ctx.beginPath();
  ctx.arc(bx + 2.9, by + bh - 1.5, 0.95, 0, Math.PI * 2);
  ctx.arc(bx + bw - 2.9, by + bh - 1.5, 0.95, 0, Math.PI * 2);
  ctx.fill();

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

/** Adds both bus images, or repaints them when the operator's colour changes. */
function paintBus(instance: MlMap, colour: string) {
  for (const [id, image] of [
    [IMG_BUS, busImage(colour)],
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
    /* The lit sign's step up is applied inside each zoom stop rather than
       around the whole expression: a `zoom` may only sit at the top of an
       `interpolate`, and multiplying the interpolate is a style error that
       silently drops the layer, flags and all. */
    return [
      size.zoom,
      [
        "*",
        ["case", ["==", ["get", "terminus"], 1], terminus, plain],
        ["case", SELECTED, LIT_SCALE, 1],
      ],
    ];
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

function upsertSource(instance: MlMap, id: string, data: FeatureCollection) {
  const existing = instance.getSource(id);
  if (existing) (existing as GeoJSONSource).setData(data);
  else instance.addSource(id, { type: "geojson", data });
}

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

export function RouteMap(props: {
  route: KeyedRoute;
  stops: { id: string; stop: StopEntry }[];
  /** Stop names, in list order, shown when a stop is picked on the map. */
  stopNames?: string[];
  /** Index of the stop nearest the user, highlighted on the map. */
  nearestIndex?: number;
  /** Index of the stop the list currently has open; the map follows it. */
  selectedIndex?: number;
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
  lang: Lang;
  /** Shown in place of the map when it cannot render. */
  unavailableLabel: string;
  /**
   * What to say about the open stop while the map owns the whole window.
   *
   * A function rather than an element, so nothing is built for a sheet that is
   * not open - and a slot rather than an `etas` prop, because arrivals belong
   * to the page that already fetches them, not to a map.
   */
  sheet?: () => JSX.Element;
  /**
   * Every stop on the route, for the sheet to show when it is pulled up: the
   * open stop is the answer to one question, and the list is the way to ask
   * the next one without leaving the map. Built only when it is on screen.
   */
  list?: () => JSX.Element;
}) {
  let container!: HTMLDivElement;
  /** How many stop signs are in the sprite - see `paintStopFlags`. */
  let painted = 0;
  /** How the map has framed itself so far - see the geometry effect. */
  let opened: "none" | "route" | "nearest" = "none";
  const [map, setMap] = createSignal<MlMap | null>(null);
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
  const [expanded, setExpanded] = createSignal(false);
  /**
   * Where the sheet over an opened-out map rests: at its foot, showing the
   * open stop, or pulled up to show the whole list. Held here as well as in
   * the drawer so it can be sent back down when a stop is picked.
   */
  const [sheetSnap, setSheetSnap] = createSignal(0);

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

      instance.addControl(new AttributionControl({ compact: true }), "bottom-left");

      // Picking a stop on the map is the fast way into a forty-stop list. The
      // name and the flag are the stop as much as the dot under them is - a
      // tap on either picks it, not only one on the invisible circle.
      let hovered: number | null = null;
      const hover = (index: number | null) => {
        if (hovered === index) return;
        if (hovered !== null) {
          instance.setFeatureState({ source: SRC_STOPS, id: hovered }, { hover: false });
        }
        if (index !== null)
          instance.setFeatureState({ source: SRC_STOPS, id: index }, { hover: true });
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
      });

      const giveUp = window.setTimeout(() => setUsable((v) => v ?? false), 6_000);

      return () => {
        clearTimeout(giveUp);
        setMap(null);
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
      nearestIndex: props.nearestIndex,
      dark: prefersDark(settings.theme()),
    }),
    ({ instance, lines, positions, names, colour, number, nearestIndex, dark }) => {
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

      if (!instance.getLayer("mb-route-line")) {
        instance.addLayer({
          id: "mb-route-casing",
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
          id: "mb-route-line",
          type: "line",
          source: SRC_LINE,
          layout: { "line-cap": "round", "line-join": "round" },
          paint: {
            "line-color": colour,
            "line-width": ["interpolate", ["linear"], ["zoom"], 10, 2.5, 16, 5],
          },
        });
        instance.addLayer({
          id: "mb-route-arrows",
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
        painted = paintStopFlags(instance, colour, surface, number, names, painted);
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
          id: "mb-stop-selected",
          type: "circle",
          source: SRC_STOPS,
          filter: ["==", ["get", "selected"], 1],
          paint: {
            "circle-radius": ["interpolate", ["linear"], ["zoom"], 11, 5.5, 14, 7.5, 17, 9.5],
            "circle-color": colour,
            "circle-stroke-color": "#ffffff",
            "circle-stroke-width": 2.5,
          },
        });

        // And a hollow one under whichever pole the pointer is over: the stop
        // that would be picked, shown before it is.
        instance.addLayer({
          id: "mb-stop-hover",
          type: "circle",
          source: SRC_STOPS,
          paint: {
            "circle-radius": ["interpolate", ["linear"], ["zoom"], 11, 7, 14, 9.5, 17, 12],
            "circle-color": "rgba(0,0,0,0)",
            "circle-stroke-color": colour,
            "circle-stroke-width": 2,
            "circle-stroke-opacity": ["case", HOVERED, 0.9, 0],
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
        instance.setPaintProperty("mb-route-line", "line-color", colour);
        instance.setPaintProperty("mb-stop-selected", "circle-color", colour);
        instance.setPaintProperty("mb-stop-hover", "circle-stroke-color", colour);
        instance.setPaintProperty(LYR_LABEL, "text-color", labelColour(colour, dark));
        // Colour, route number and stop names are all baked into the signs,
        // so they are repainted whenever any of them moves.
        painted = paintStopFlags(instance, colour, surface, number, names, painted);
      }

      /*
       * The other half of the ordering the bus effect does: whichever of the
       * two ran last has to put the buses back on top, or a sign added after
       * the first bus arrived is drawn over the one thing on the map that is
       * moving now.
       */
      for (const id of ["mb-bus-nose", "mb-bus-dot"]) {
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

  const recentre = () => {
    const instance = map();
    const me = props.me;
    if (instance && me) instance.easeTo({ center: [me.lng, me.lat], zoom: 15, duration: 500 });
  };

  /**
   * Take me to the bus.
   *
   * A bus on a forty-stop route is one badge in a metre of line, and on a phone
   * most of that line is off screen - so the one question the map exists to
   * answer needs an answer that does not involve hunting for it. If a stop is
   * open, this goes to the bus that stop is waiting for, because that is the
   * bus the rider means; otherwise it frames every bus on the route.
   */
  const frameBuses = () => {
    const instance = map();
    const measured = track();
    if (!instance || !measured || trails.size === 0) return;

    const here = [...trails.values()].map((trail) => ({
      measure: trail.measure,
      position: pointAt(measured.line, trail.measure).position,
    }));

    const selected = props.selectedIndex;
    const limit = selected === undefined ? undefined : measured.measures[selected];
    // The last bus still short of that stop is the next one to reach it.
    const coming =
      limit === undefined
        ? undefined
        : here
            .filter((bus) => bus.measure <= limit)
            .reduce<(typeof here)[number] | undefined>(
              (best, bus) => (best && best.measure > bus.measure ? best : bus),
              undefined,
            );

    if (coming) {
      instance.easeTo({
        center: coming.position,
        // Off-centre by half the sheet, so the bus does not land behind it.
        offset: expanded() ? [0, -sheetHeight() / 2] : [0, 0],
        // Close enough to read the road it is on, without throwing away a
        // wider view the rider has deliberately zoomed out to.
        zoom: Math.max(instance.getZoom(), 15),
        duration: 600,
      });
      return;
    }

    const bounds = new LngLatBounds();
    for (const bus of here) bounds.extend(bus.position);
    if (!bounds.isEmpty()) {
      instance.fitBounds(bounds, { padding: framePadding(72), maxZoom: 15.5, duration: 600 });
    }
  };

  /** How much of the opened-out map the sheet covers at rest, in pixels. */
  const sheetHeight = () => Math.round(container.clientHeight * SHEET_PEEK);

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
      dark: prefersDark(settings.theme()),
    }),
    ({ instance, vehicles, measured, colour, dark }) => {
      if (!instance) return;

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
            properties: { bearing: here.bearing },
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

      if (!instance.getLayer("mb-bus-dot")) {
        /*
         * The band goes down first and stays under the badge: it is the claim
         * being qualified, and a smear drawn over the marker would read as the
         * marker being blurred rather than the position being uncertain.
         */
        instance.addLayer(
          {
            id: "mb-bus-band",
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
          instance.getLayer("mb-route-casing") ? "mb-route-casing" : undefined,
        );
        instance.addLayer({
          id: "mb-bus-nose",
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
        instance.addLayer({
          id: "mb-bus-dot",
          type: "symbol",
          source: SRC_BUS,
          layout: {
            "icon-image": IMG_BUS,
            "icon-allow-overlap": true,
            "icon-ignore-placement": true,
            "icon-size": busSize(),
          },
        });
        paintBus(instance, colour);
      } else {
        instance.setPaintProperty("mb-bus-band", "line-color", bandColour(dark));
        paintBus(instance, colour);
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
      if (instance.getLayer("mb-route-casing")) {
        instance.moveLayer("mb-bus-band", "mb-route-casing");
      }
      instance.moveLayer("mb-bus-nose");
      instance.moveLayer("mb-bus-dot");

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
        if (at - last >= CREEP_MS) {
          last = at;
          draw(at);
        }
        frame = requestAnimationFrame(loop);
      };
      frame = requestAnimationFrame(loop);
      return () => cancelAnimationFrame(frame);
    },
  );

  // The user's own position is a separate source so it updates without
  // touching the route geometry.
  createEffect(
    () => ({ instance: map(), me: props.me }),
    ({ instance, me }) => {
      if (!instance) return;

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

      if (!instance.getLayer("mb-me-dot")) {
        instance.addLayer({
          id: "mb-me-halo",
          type: "circle",
          source: SRC_ME,
          paint: { "circle-radius": 17, "circle-color": ACCENT, "circle-opacity": 0.16 },
        });
        instance.addLayer({
          id: "mb-me-dot",
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
      document.documentElement.classList.add("mb-locked");

      const onKey = (event: KeyboardEvent) => {
        if (event.key === "Escape") setExpanded(false);
      };
      window.addEventListener("keydown", onKey);

      return () => {
        cancelAnimationFrame(frame);
        window.removeEventListener("keydown", onKey);
        document.documentElement.classList.remove("mb-locked");
        instance.cooperativeGestures?.enable();
      };
    },
  );

  /*
   * A stop picked from the pulled-up list is a question for the map, and the
   * map is under the list: the sheet drops back to its foot so the answer can
   * be seen. A stop closed again is not a question, so the sheet stays put.
   */
  createEffect(
    () => props.selectedIndex,
    (index) => {
      if (index !== undefined && expanded()) setSheetSnap(0);
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

  const controlClass =
    "mb-press flex size-9 items-center justify-center rounded-full border border-border bg-card/90 text-muted-foreground shadow-card backdrop-blur";

  return (
    <>
      {/* A flex column, so a height class of `flex-1` on the canvas lets it
          fill a card that is itself filling its column - the map's height then
          comes from the window rather than from a number. */}
      <div
        class={expanded() ? "fixed inset-0 z-50 bg-map" : "relative flex min-h-0 flex-1 flex-col"}
      >
        <div
          ref={container}
          // Kept in the layout while loading so MapLibre can measure it, then
          // collapsed if it turns out the map will never paint.
          class={`w-full bg-map ${mapHeight()}`}
          style={{ height: usable() === false ? "0" : undefined, overflow: "hidden" }}
          aria-label="route map"
        />

        {/*
         * The status line. It is the honesty label when there are buses - they
         * are inferences, not position reports, and the map has to say so
         * somewhere a rider can find it - and it is the explanation when there
         * are none, which is the harder half: a blank map that says nothing is
         * indistinguishable from a broken one.
         */}
        <Show when={usable()}>
          <div
            class="pointer-events-none absolute left-2.5 top-2.5 flex items-center gap-1.5 rounded-full border border-border bg-card/90 px-2.5 py-1 shadow-card backdrop-blur"
            style={expanded() ? { top: "max(0.625rem, env(safe-area-inset-top))" } : undefined}
          >
            <span
              class={[
                "size-2 rounded-full",
                {
                  // Waiting has to look like waiting, or it looks like nothing.
                  "animate-pulse bg-subtle-foreground": note() === "loading",
                  "bg-faint-foreground": note() !== "loading" && note() !== "estimated",
                },
              ]}
              style={
                note() === "estimated" ? { "background-color": lineColour(props.route) } : undefined
              }
            />
            <span class="text-[0.75rem] font-semibold text-subtle-foreground">{noteLabel()}</span>
          </div>
        </Show>

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
        <Show when={usable() && props.sheet}>
          {(sheet) => (
            <Drawer
              open={expanded()}
              /* Flicked away, the sheet takes the opened-out map with it: the
                 arrivals are why the rider is here, and a map without them is
                 the page with the map at its usual size. */
              onClose={() => setExpanded(false)}
              within
              snapPoints={[SHEET_PEEK, SHEET_TALL]}
              snap={sheetSnap()}
              onSnapChange={setSheetSnap}
              label={t("mapSheet", props.lang)}
              class="lg:max-w-[36rem]"
            >
              {/* Built only while the map is opened out, so no arrivals are
                  laid out for a sheet nobody can see. */}
              <Show when={expanded()}>
                {/* The open stop stays at the top while the list scrolls under
                    it: pulled up, the sheet is still about this stop. */}
                <div class="sticky top-0 z-10 bg-card">{sheet()()}</div>
                <Show when={props.list}>
                  {(list) => <div class="border-t border-border pb-safe-bottom">{list()()}</div>}
                </Show>
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
            <Show when={drawn() > 0}>
              <button
                type="button"
                aria-label={t("mapFindBus", props.lang)}
                title={t("mapFindBus", props.lang)}
                onClick={frameBuses}
                class={`${controlClass} text-primary`}
              >
                <BusIcon size={15} />
              </button>
            </Show>
            <Show when={props.me}>
              <button
                type="button"
                aria-label={t("mapMyLocation", props.lang)}
                title={t("mapMyLocation", props.lang)}
                onClick={recentre}
                class={controlClass}
              >
                <PinIcon size={15} />
              </button>
            </Show>
            <button
              type="button"
              aria-label={t("mapWholeRoute", props.lang)}
              title={t("mapWholeRoute", props.lang)}
              onClick={fitRoute}
              class={controlClass}
            >
              <RouteIcon size={15} />
            </button>
          </div>
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
