import type { VehicleKind } from "~/lib/operators";

/**
 * The vehicles the app draws, and the canvas work behind them.
 *
 * It lives outside the map because two screens draw the same vehicle: the
 * marker creeping along the route on the map, and the one creeping up the rail
 * between two stops in the list beside it. They are the same bus at two sizes,
 * and a picture that only the map could make left the list drawing a pictogram
 * of one instead - a different vehicle every time a rider looked from one to
 * the other.
 *
 * Nothing here knows about MapLibre: it is a canvas, a colour and a kind.
 */

/** Paper white, for the halo that cuts a vehicle out of whatever is under it. */
export const PAPER = "#ffffff";

/** The vehicle's own pixel grid, before anything scales it. */
export const BUS = { size: 30, ratio: 3 };

/** `roundRect` with a path of arcs behind it, for the browsers without it. */
export function roundedRect(
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
export function shade(colour: string, towards: "light" | "dark", amount: number) {
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
export function litFace(
  ctx: CanvasRenderingContext2D,
  colour: string,
  top: number,
  bottom: number,
) {
  const face = ctx.createLinearGradient(0, top, 0, bottom);
  face.addColorStop(0, shade(colour, "light", 0.22));
  face.addColorStop(1, shade(colour, "dark", 0.18));
  return face;
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
function drawVehicle(colour: string, kind: VehicleKind, west: boolean) {
  const { size, ratio } = BUS;
  const canvas = document.createElement("canvas");
  canvas.width = size * ratio;
  canvas.height = size * ratio;
  const ctx = canvas.getContext("2d");
  // No 2D context - an ancient browser, or a test environment with no canvas
  // behind jsdom. Every caller treats a missing drawing as nothing to draw.
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

  return { canvas, ctx };
}

/** The drawing as raw pixels, which is what the map wants for an image. */
export function busImage(colour: string, kind: VehicleKind, west = false) {
  const drawn = drawVehicle(colour, kind, west);
  if (!drawn) return null;
  const { canvas, ctx } = drawn;
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return { width: canvas.width, height: canvas.height, data: new Uint8Array(pixels.data.buffer) };
}

/**
 * The same drawing as something the DOM can hang in an `<img>`.
 *
 * Kept once per livery and kind. The map hands its bitmap to MapLibre and
 * forgets it; a list row needs a URL every time it renders, and this is a
 * canvas, three gradients and a dozen paths - a route with four buses creeping
 * up the rail would redraw it four times a second for a picture that never
 * changes. The key is everything the drawing depends on, so a route in another
 * colour makes its own and nothing else pays for it.
 */
const sprites = new Map<string, string>();

export function vehicleSprite(colour: string, kind: VehicleKind): string {
  const key = `${kind}:${colour}`;
  const made = sprites.get(key);
  if (made !== undefined) return made;

  let url = "";
  try {
    url = drawVehicle(colour, kind, false)?.canvas.toDataURL("image/png") ?? "";
  } catch {
    // A canvas that cannot be read back - jsdom without the canvas package.
    // An empty source draws nothing, which is the right answer here.
  }
  sprites.set(key, url);
  return url;
}
