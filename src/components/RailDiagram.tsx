import { For, Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js";
import { LIGHT_RAIL, MAP_EDGES, MAP_STATIONS, type MapStation } from "~/data/railMap";
import { useDb } from "~/data/context";
import { lineName, lineRank } from "~/data/rail";
import { ExpandIcon, MinusIcon, PlusIcon } from "~/components/Icons";
import { pick, stripStopCode, t, type Lang } from "~/lib/i18n";
import { OPERATORS, plateStyle } from "~/lib/operators";

/**
 * The railway as a diagram you can touch.
 *
 * SVG rather than canvas, and not because of the pixel count - at ninety-seven
 * stations either would draw in well under a frame. It is that every station
 * here has to be a thing you can tab to, label for a screen reader and hit
 * without arithmetic, and that the whole app's colour is CSS custom properties
 * that a canvas would have to be told about and repainted for. A canvas would
 * buy nothing and cost all of that.
 *
 * Everything is sized in *pixels* and converted to diagram units through `k`,
 * so a line stays six pixels wide and a name stays eleven whether the rider is
 * looking at the whole network or at two stations. Sizing in diagram units
 * instead is what makes a zoomed-in schematic look like a magnified image.
 */

/** Fit-to-window leaves this much air around the network, in grid squares. */
const MARGIN = 2.4;
/**
 * How many pixels a grid square needs before a name is worth reading, which is
 * both when the second language appears and the zoom the map opens at.
 */
const LABEL_FROM = 24;
/** Where the map opens when it has no better idea. Four lines meet here. */
const HOME_STATION = "ADM";

/** How wide a corner turns, in pixels - the radius of every bend in the map. */
const CORNER = 15;
const MIN_SCALE = 4;
const MAX_SCALE = 95;

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

const byId = new Map(MAP_STATIONS.map((s) => [s.id, s]));

/** The whole network's extent, with air around it. */
const WORLD: Box = (() => {
  const xs = MAP_STATIONS.map((s) => s.x);
  const ys = MAP_STATIONS.map((s) => s.y);
  const x = Math.min(...xs) - MARGIN;
  const y = Math.min(...ys) - MARGIN;
  return { x, y, w: Math.max(...xs) + MARGIN - x, h: Math.max(...ys) + MARGIN - y };
})();

const lineColour = (code: string) =>
  code === LIGHT_RAIL ? OPERATORS.lightRail.color : plateStyle(["mtr"], code).background;

/** The line's name as a rider says it, which for the light rail is the operator. */
const lineLabel = (code: string, lang: Lang) =>
  code === LIGHT_RAIL ? OPERATORS.lightRail.name[lang] : pick(lineName(code), lang);

/**
 * The light rail is the map's second layer.
 *
 * Sixty-eight tram stops in the north-west corner, drawn at half the pitch of
 * the railway: at the zoom that shows the whole network they are a solid block,
 * and the printed map does not name them either. So the network is always there
 * as a line - the shape of it is part of the shape of Hong Kong - and the stops
 * and their names arrive as the rider zooms into it, the way a game map reveals
 * a district. Touching the collapsed network, or its entry in the key, flies in.
 *
 * The threshold sits above the zoom the map opens at on a station, so the tram
 * stops are folded until the rider goes to them rather than there from the start.
 */
const LIGHT_RAIL_FROM = 36;

const isLightRailOnly = (station: MapStation) =>
  station.lines.length === 1 && station.lines[0] === LIGHT_RAIL;

/** Where the light rail is, for flying into it. */
const LIGHT_RAIL_BOX: Box = (() => {
  const on = MAP_STATIONS.filter((s) => s.lines.includes(LIGHT_RAIL));
  const xs = on.map((s) => s.x);
  const ys = on.map((s) => s.y);
  const x = Math.min(...xs) - 1.5;
  const y = Math.min(...ys) - 1.5;
  return { x, y, w: Math.max(...xs) + 1.5 - x, h: Math.max(...ys) + 1.5 - y };
})();

/** How many stations sit near a point, for judging where a name will fit. */
function crowding(x: number, y: number): number {
  let n = 0;
  for (const other of MAP_STATIONS) {
    if (Math.abs(other.x - x) < 2.6 && Math.abs(other.y - y) < 1.6) n++;
  }
  return n;
}

const anchorFor = (dx: number) =>
  dx > 0.34 ? ("start" as const) : dx < -0.34 ? ("end" as const) : ("middle" as const);

/**
 * Where a station's name goes: into whatever space its own line leaves.
 *
 * A corner or a terminus has an obvious answer - sum the directions to the
 * neighbours and put the name the other way, which is the one side the track
 * cannot be on.
 *
 * A station in the middle of a straight run does not: its neighbours cancel
 * out and there is no "other way" along the line. The name has to go across
 * the line instead, and which of the two sides is a real choice - on the
 * Nathan Road corridor, where six stations run straight down one street, the
 * wrong side puts every name on top of the line beside it. So both sides are
 * measured and the emptier one wins.
 *
 * Putting the name straight up in this case, as this first did, is the worst
 * of the three: on a vertical run that is exactly on top of the next station.
 */
function labelSide(station: MapStation, neighbours: MapStation[]) {
  let sx = 0;
  let sy = 0;
  for (const other of neighbours) {
    const dx = other.x - station.x;
    const dy = other.y - station.y;
    const d = Math.hypot(dx, dy) || 1;
    sx += dx / d;
    sy += dy / d;
  }

  const strength = Math.hypot(sx, sy);
  if (strength >= 0.25) {
    const dx = -sx / strength;
    const dy = -sy / strength;
    return { dx, dy, anchor: anchorFor(dx) };
  }

  const along = neighbours[0];
  if (!along) return { dx: 0, dy: -1, anchor: "middle" as const };

  const ax = along.x - station.x;
  const ay = along.y - station.y;
  const d = Math.hypot(ax, ay) || 1;
  const px = -ay / d;
  const py = ax / d;

  /*
   * Which side, on a straight run, is not a free choice made once - it is made
   * for every station on the run, and making it the same way each time stacks a
   * column of names down one side of the line. Two squares apart, which is what
   * the Island line is, a name is wider than the gap and they overlap.
   *
   * So they alternate, the way a printed map staggers them, which doubles the
   * room each one has. Alternating by position on the grid looked like it would
   * do - and does, where the stations are evenly spaced - but the Island line
   * west of Central is spaced three squares and east of it two, and parity of a
   * coordinate puts neighbours on the same side as soon as the pitch changes.
   * Counting along the run itself is what actually alternates.
   */
  const alternating = (RUN_PARITY.get(station.id) ?? 0) === 0 ? 1 : -1;

  /*
   * Where one side is *clearly* emptier that wins, but only clearly: a single
   * station's difference is not worth breaking the stagger for, and letting it
   * decide put four names in a row on the same side of the Island line.
   */
  const room =
    crowding(station.x - px * 2.8, station.y - py * 2.8) -
    crowding(station.x + px * 2.8, station.y + py * 2.8);
  const side = Math.abs(room) < 2 ? alternating : room > 0 ? 1 : -1;

  return { dx: px * side, dy: py * side, anchor: anchorFor(px * side) };
}

/**
 * Every segment to draw, each already offset off any segment it shares its two
 * stations with - the Airport Express and the Tung Chung line run between Hong
 * Kong and Kowloon together, and drawn honestly one simply hides the other.
 */
const SEGMENTS = (() => {
  const groups = new Map<string, { line: string; a: MapStation; b: MapStation }[]>();

  for (const code of Object.keys(MAP_EDGES)) {
    for (const [from, to] of MAP_EDGES[code] ?? []) {
      const a = byId.get(from);
      const b = byId.get(to);
      if (!a || !b) continue;
      const key = from < to ? `${from}:${to}` : `${to}:${from}`;
      groups.set(key, [...(groups.get(key) ?? []), { line: code, a, b }]);
    }
  }

  return [...groups.values()].flatMap((shared) => {
    const ordered = [...shared].sort((p, q) => lineRank(p.line) - lineRank(q.line));
    return ordered.map((seg, i) => ({
      ...seg,
      /** In line-widths, so the gap holds at every zoom. */
      offset: i - (ordered.length - 1) / 2,
    }));
  });
})();

/**
 * A line, in running order, as the paths that draw it.
 *
 * Drawing each segment as its own straight line is what made the diagram look
 * like a wiring schematic: a railway on a map turns corners, and a corner is a
 * curve, not a mitre. A curve needs to know what comes before and after, which
 * a loose segment does not - so the edges are walked back into the sequences
 * the trains actually run, and each sequence becomes one path.
 *
 * A branch is simply a station with three neighbours, so the walk yields more
 * than one chain for East Rail and Tseung Kwan O and nothing has to know that.
 */
function chainsOf(code: string): MapStation[][] {
  const pairs = MAP_EDGES[code] ?? [];
  const adjacent = new Map<string, string[]>();
  for (const [a, b] of pairs) {
    adjacent.set(a, [...(adjacent.get(a) ?? []), b]);
    adjacent.set(b, [...(adjacent.get(b) ?? []), a]);
  }

  const key = (a: string, b: string) => (a < b ? `${a}:${b}` : `${b}:${a}`);
  const walked = new Set<string>();
  const chains: string[][] = [];

  const walk = (from: string, to: string) => {
    const chain = [from, to];
    walked.add(key(from, to));
    let previous = from;
    let at = to;

    // Straight through a two-neighbour station; stop at a junction or an end,
    // where the next stretch is somebody else's chain.
    while ((adjacent.get(at)?.length ?? 0) === 2) {
      const next = adjacent.get(at)!.find((n) => n !== previous);
      if (!next || walked.has(key(at, next))) break;
      walked.add(key(at, next));
      chain.push(next);
      previous = at;
      at = next;
    }
    return chain;
  };

  // From the ends and the junctions first, so the long runs come out whole.
  const ordered = [...adjacent.keys()].sort(
    (a, b) => (adjacent.get(a)?.length ?? 0) - (adjacent.get(b)?.length ?? 0),
  );
  for (const start of ordered) {
    for (const next of adjacent.get(start) ?? []) {
      if (walked.has(key(start, next))) continue;
      chains.push(walk(start, next));
    }
  }

  return chains.map((ids) => ids.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : [])));
}

/** How far a shared stretch is pushed off centre, in line-widths. */
const OFFSET_OF = new Map<string, number>();
for (const seg of SEGMENTS) {
  const a = seg.a.id;
  const b = seg.b.id;
  OFFSET_OF.set(`${seg.line}:${a < b ? `${a}:${b}` : `${b}:${a}`}`, seg.offset);
}

const CHAINS = Object.keys(MAP_EDGES).flatMap((code) =>
  chainsOf(code).map((stations) => ({ code, stations })),
);

/**
 * Each station's place in its own run, as a parity, for staggering names.
 *
 * Interchanges are not in here and do not need to be: a junction's name has a
 * side its own tracks leave free, which is a better answer than a stagger.
 */
const RUN_PARITY = new Map<string, number>();
for (const chain of CHAINS) {
  chain.stations.forEach((station, i) => {
    if (!RUN_PARITY.has(station.id)) RUN_PARITY.set(station.id, i % 2);
  });
}

interface Point {
  x: number;
  y: number;
}

/**
 * The path for one run, with its corners rounded.
 *
 * Each corner is cut back along both of its legs by the radius and rejoined
 * through the corner itself as a quadratic curve, which is the shape a drawn
 * railway uses. The cut is never more than half a leg, so two corners on a
 * short segment cannot eat each other and turn the line inside out.
 */
function roundedPath(points: Point[], radius: number): string {
  if (points.length < 2) return "";

  const towards = (from: Point, to: Point, by: number): Point => {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const d = Math.hypot(dx, dy) || 1;
    return { x: from.x + (dx / d) * by, y: from.y + (dy / d) * by };
  };

  let d = `M ${points[0]!.x} ${points[0]!.y}`;
  for (let i = 1; i < points.length - 1; i++) {
    const before = points[i - 1]!;
    const corner = points[i]!;
    const after = points[i + 1]!;
    const cut = Math.min(
      radius,
      Math.hypot(corner.x - before.x, corner.y - before.y) / 2,
      Math.hypot(after.x - corner.x, after.y - corner.y) / 2,
    );
    const enter = towards(corner, before, cut);
    const leave = towards(corner, after, cut);
    d += ` L ${enter.x} ${enter.y} Q ${corner.x} ${corner.y} ${leave.x} ${leave.y}`;
  }

  const end = points[points.length - 1]!;
  return `${d} L ${end.x} ${end.y}`;
}

/**
 * A run's points, each segment pushed off centre where it shares its two
 * stations with another line, so parallel track reads as two lines running
 * together rather than one hiding the other.
 */
function offsetPoints(code: string, stations: MapStation[], width: number): Point[] {
  const shift = (a: MapStation, b: MapStation): number => {
    const id = `${code}:${a.id < b.id ? `${a.id}:${b.id}` : `${b.id}:${a.id}`}`;
    return (OFFSET_OF.get(id) ?? 0) * width;
  };

  const across = (a: MapStation, b: MapStation, by: number): Point => {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const d = Math.hypot(dx, dy) || 1;
    return { x: (-dy / d) * by, y: (dx / d) * by };
  };

  return stations.map((station, i) => {
    // An end takes its one segment's offset; a middle station takes the mean of
    // the two, which keeps the path continuous where the offset changes.
    const before = i > 0 ? stations[i - 1]! : null;
    const after = i < stations.length - 1 ? stations[i + 1]! : null;
    const parts: Point[] = [];
    if (before) parts.push(across(before, station, shift(before, station)));
    if (after) parts.push(across(station, after, shift(station, after)));
    const dx = parts.reduce((sum, p) => sum + p.x, 0) / parts.length;
    const dy = parts.reduce((sum, p) => sum + p.y, 0) / parts.length;
    return { x: station.x + dx, y: station.y + dy };
  });
}

/**
 * Which way the lines run through a station, as an axis in degrees.
 *
 * Doubling each neighbour's angle before averaging and halving the result is
 * what makes this an *axis* rather than a direction: a station with a line
 * arriving from either side has two neighbours pointing opposite ways, and
 * averaging those directly cancels them to nothing.
 */
function runAngle(station: MapStation, neighbours: MapStation[]): number {
  let sx = 0;
  let sy = 0;
  for (const other of neighbours) {
    const dx = other.x - station.x;
    const dy = other.y - station.y;
    const d = Math.hypot(dx, dy) || 1;
    const doubled = 2 * Math.atan2(dy / d, dx / d);
    sx += Math.cos(doubled);
    sy += Math.sin(doubled);
  }
  if (sx === 0 && sy === 0) return 0;
  return ((Math.atan2(sy, sx) / 2) * 180) / Math.PI;
}

/*
 * An interchange is a capsule with one short coloured bar per line through it,
 * drawn across the direction those lines run - which is how the railway draws
 * it on its own map, and says at a glance what a single larger circle cannot:
 * how many lines meet here, and which. A station on one line is a ringed bead
 * on that line.
 */
/** The capsule's short axis, in pixels. */
const CAPSULE = 13;
/** One bar per line, this far apart and this big. */
const BAR_GAP = 6;
const BAR_W = 7.5;
const BAR_H = 2.4;
/** A station on one line only. */
const BEAD_R = 5.2;

/**
 * Pairs you change between on foot, without leaving the fare gates.
 *
 * They are two stations, and the map has to say so - Hong Kong and Central are
 * separate names on separate lines - while also saying that changing between
 * them is one move. The railway draws the pair joined by a walkway in the same
 * white the station markers are, which is the whole answer: near enough to read
 * as one place, drawn plainly enough to be two.
 */
/** The lines, in the order the railway's own map lists them. */
const LEGEND = Object.keys(MAP_EDGES).sort((a, b) => lineRank(a) - lineRank(b));

const LINKS: [string, string][] = [
  ["HOK", "CEN"],
  ["KOW", "AUS"],
  ["TST", "ETS"],
];

export function RailDiagram(props: {
  lang: Lang;
  /** Names the diagram for a screen reader, in the reader's own language. */
  label: string;
  selected: string | null;
  onSelect: (id: string | null) => void;
  /** The station the rider is standing at, if the app knows. */
  here?: string | null;
  /** The line being read, if one is: everything else fades. */
  focus: string | null;
  onFocus: (code: string | null) => void;
  class?: string;
}) {
  const db = useDb();
  let frame: HTMLDivElement | undefined;
  let svg: SVGSVGElement | undefined;

  /*
   * Which line the rider is reading, if they have said. A station and a line
   * are two ways of asking the same question - what runs here - so choosing
   * either clears the other rather than trying to mean both at once.
   */
  const focus = () => props.focus;

  /** Everything not being read fades, whichever way the reading was asked for. */
  const faded = (lines: string[]) => {
    const only = focus();
    if (only) return !lines.includes(only);
    const picked = props.selected ? byId.get(props.selected) : null;
    return picked ? !lines.some((code) => picked.lines.includes(code)) : false;
  };

  const [box, setBox] = createSignal<{ w: number; h: number }>({ w: 0, h: 0 });
  const [view, setView] = createSignal<Box>(WORLD);

  const neighbours = createMemo(() => {
    const index = new Map<string, MapStation[]>();
    for (const seg of SEGMENTS) {
      index.set(seg.a.id, [...(index.get(seg.a.id) ?? []), seg.b]);
      index.set(seg.b.id, [...(index.get(seg.b.id) ?? []), seg.a]);
    }
    return index;
  });

  /*
   * Pixels per grid square. `min` because the SVG letterboxes its viewBox to
   * fit, so the axis with less room is the one that decides the scale - taking
   * the other would put half the diagram outside the frame.
   */
  const scale = () => {
    const { w, h } = box();
    const v = view();
    if (w === 0 || h === 0) return 1;
    return Math.min(w / v.w, h / v.h);
  };
  /** Grid squares per pixel: every size below is written in pixels times this. */
  const k = () => 1 / scale();

  /*
   * Every station is named, at every zoom. The names used to appear in two
   * stages - interchanges first, the rest once there was room - which kept the
   * fitted view tidy at the cost of the one thing a rider opens a map for.
   * What is still staged is the *second* language: one name per station is the
   * map, two is the detail, and doubling every label at the widest zoom turns
   * the diagram back into a block of text.
   */
  const bilingual = () => scale() >= LABEL_FROM;
  const lightRailShown = () => scale() >= LIGHT_RAIL_FROM;
  /** A second name on a tram stop needs twice the room again. */
  const lightRailBilingual = () => scale() >= LIGHT_RAIL_FROM * 2;

  /** Fly into the light rail, at a zoom where its stops exist. */
  const fitLightRail = () => {
    const { w, h } = box();
    if (w === 0 || h === 0) return;
    const fitted = Math.min(w / LIGHT_RAIL_BOX.w, h / LIGHT_RAIL_BOX.h);
    const s = Math.min(MAX_SCALE, Math.max(fitted, LIGHT_RAIL_FROM * 1.15));
    const cx = LIGHT_RAIL_BOX.x + LIGHT_RAIL_BOX.w / 2;
    const cy = LIGHT_RAIL_BOX.y + LIGHT_RAIL_BOX.h / 2;
    setView({ x: cx - w / s / 2, y: cy - h / s / 2, w: w / s, h: h / s });
  };

  const watch = (el: HTMLDivElement) => {
    frame = el;
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }));
    observer.observe(el);
    onCleanup(() => observer.disconnect());
  };

  /** Where a client point lands on the diagram, letterboxing accounted for. */
  const toWorld = (clientX: number, clientY: number) => {
    const rect = frame?.getBoundingClientRect();
    const v = view();
    if (!rect) return { x: v.x, y: v.y };
    const s = scale();
    const padX = (rect.width - v.w * s) / 2;
    const padY = (rect.height - v.h * s) / 2;
    return {
      x: v.x + (clientX - rect.left - padX) / s,
      y: v.y + (clientY - rect.top - padY) / s,
    };
  };

  /** Zoom about a fixed point, so what is under the fingers stays under them. */
  const zoomTo = (nextScale: number, at: { x: number; y: number }) => {
    const { w, h } = box();
    if (w === 0 || h === 0) return;
    const s = Math.min(MAX_SCALE, Math.max(MIN_SCALE, nextScale));
    const v = view();
    const nw = w / s;
    const nh = h / s;
    // The anchor keeps its fractional place in the box, which is what makes it
    // hold still rather than drift towards the centre.
    const fx = (at.x - v.x) / v.w;
    const fy = (at.y - v.y) / v.h;
    setView({ x: at.x - fx * nw, y: at.y - fy * nh, w: nw, h: nh });
  };

  /*
   * A pointer is a pan until it has travelled far enough to be sure, because a
   * station is a small target and a tap on one always drags a pixel or two.
   */
  const pointers = new Map<number, { x: number; y: number }>();
  const captured = new Set<number>();
  let dragged = false;
  let pinch = 0;

  const onPointerDown = (event: PointerEvent) => {
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.size === 1) dragged = false;
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = Math.hypot(a!.x - b!.x, a!.y - b!.y);
    }
  };

  /*
   * Capture is taken when a drag starts, never when a pointer merely goes
   * down. Capturing on `pointerdown` redirects the whole gesture to the SVG,
   * so `pointerup` on a station was delivered to the background instead - and
   * every tap on a station read as a tap on empty space and cleared the
   * selection it had just made.
   */
  const capture = (event: PointerEvent) => {
    if (captured.has(event.pointerId) || !svg) return;
    svg.setPointerCapture(event.pointerId);
    captured.add(event.pointerId);
  };

  const onPointerMove = (event: PointerEvent) => {
    const last = pointers.get(event.pointerId);
    if (!last) return;
    const now = { x: event.clientX, y: event.clientY };

    if (pointers.size === 1) {
      const dx = now.x - last.x;
      const dy = now.y - last.y;
      if (Math.hypot(dx, dy) > 1.5) {
        dragged = true;
        capture(event);
      }
      const s = scale();
      const v = view();
      setView({ ...v, x: v.x - dx / s, y: v.y - dy / s });
    }

    pointers.set(event.pointerId, now);

    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const spread = Math.hypot(a!.x - b!.x, a!.y - b!.y);
      if (pinch > 0 && spread > 0) {
        dragged = true;
        capture(event);
        const mid = toWorld((a!.x + b!.x) / 2, (a!.y + b!.y) / 2);
        zoomTo(scale() * (spread / pinch), mid);
      }
      pinch = spread;
    }
  };

  const endPointer = (event: PointerEvent) => {
    pointers.delete(event.pointerId);
    captured.delete(event.pointerId);
    if (pointers.size < 2) pinch = 0;
  };

  const onWheel = (event: WheelEvent) => {
    event.preventDefault();
    // A trackpad reports fine-grained deltas and a mouse wheel coarse ones; the
    // exponent flattens both into the same felt speed.
    zoomTo(scale() * Math.exp(-event.deltaY * 0.0016), toWorld(event.clientX, event.clientY));
  };

  /* `passive: false` is the whole point: a wheel listener bound through JSX is
     passive by default, so `preventDefault` is ignored and the page scrolls
     behind the map instead of the map zooming. */
  const bindWheel = (el: SVGSVGElement) => {
    svg = el;
    el.addEventListener("wheel", onWheel, { passive: false });
    onCleanup(() => el.removeEventListener("wheel", onWheel));
  };

  /** Fit the whole network, which is also the way back out of a deep zoom. */
  const fit = () => setView(WORLD);

  /** Put a station in the middle at a readable zoom, keeping the current one. */
  const centreOn = (id: string, atLeast = LABEL_FROM * 1.4) => {
    const station = byId.get(id);
    const { w, h } = box();
    if (!station || w === 0 || h === 0) return;
    const s = Math.min(MAX_SCALE, Math.max(scale(), atLeast));
    setView({ x: station.x - w / s / 2, y: station.y - h / s / 2, w: w / s, h: h / s });
  };

  /*
   * The first useful view is not the whole network - fitted to a phone that is
   * a diagram whose names are three pixels tall. It opens where the rider is,
   * and only falls back to the whole thing when there is nowhere better.
   */
  const [placed, setPlaced] = createSignal(false);
  createEffect(
    () => ({ ready: box().w > 0, here: props.here }),
    ({ ready, here }) => {
      if (!ready || placed()) return;
      setPlaced(true);

      if (here && byId.has(here)) {
        centreOn(here);
        return;
      }

      /*
       * Fitting the network is the right opening view only where it can be
       * read. Every station is named now, so a fit that squeezes the whole
       * railway into a phone is ninety-seven names on top of each other - the
       * map opens on the hub at a legible zoom instead, and the fit button is
       * there for the rider who wants the shape.
       */
      const { w, h } = box();
      if (Math.min(w / WORLD.w, h / WORLD.h) >= LABEL_FROM) fit();
      else centreOn(HOME_STATION, LABEL_FROM);
    },
  );

  /*
   * Choosing a station somewhere else - a search result, the panel - has to
   * show where it is, or the selection is a fact with no location attached.
   *
   * By the smallest pan that does it, though, and never by re-centring: on a
   * window where the whole network fits, centring the choice throws away the
   * half of the map that was already on screen. The lower part of the frame
   * counts as out of view because the sheet the selection just opened is
   * sitting over it.
   */
  createEffect(
    () => props.selected,
    (id) => {
      if (!id || !placed()) return;
      const station = byId.get(id);
      if (!station) return;

      const v = view();
      const sideways = v.w * 0.12;
      const above = v.h * 0.1;
      const below = v.h * 0.62;

      let { x, y } = v;
      if (station.x < v.x + sideways) x = station.x - sideways;
      else if (station.x > v.x + v.w - sideways) x = station.x - v.w + sideways;
      if (station.y < v.y + above) y = station.y - above;
      else if (station.y > v.y + v.h - below) y = station.y - v.h + below;

      if (x !== v.x || y !== v.y) setView({ ...v, x, y });
    },
  );

  const stationName = (id: string) =>
    stripStopCode(pick(db().stopList[id]?.name, props.lang)) || id;
  const otherName = (id: string) =>
    stripStopCode(pick(db().stopList[id]?.name, props.lang === "zh" ? "en" : "zh"));

  const viewBox = () => {
    const v = view();
    return `${v.x} ${v.y} ${v.w} ${v.h}`;
  };

  return (
    <div
      ref={watch}
      class={[
        "relative touch-none overflow-hidden rounded-xl border border-border bg-card",
        props.class ?? "",
      ]}
    >
      <svg
        ref={bindWheel}
        viewBox={viewBox()}
        preserveAspectRatio="xMidYMid meet"
        class="size-full cursor-grab select-none active:cursor-grabbing"
        role="application"
        aria-label={props.label}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={(event) => {
          endPointer(event);
          // A tap on nothing clears the selection, the same way tapping the
          // backdrop of a sheet closes it.
          if (!dragged && event.target === svg) props.onSelect(null);
        }}
        onPointerCancel={endPointer}
      >
        <g fill="none" stroke-linecap="round" stroke-linejoin="round">
          <For each={CHAINS}>
            {(chain) => {
              const dim = () => faded([chain.code]);
              const d = () =>
                roundedPath(offsetPoints(chain.code, chain.stations, 6.5 * k()), CORNER * k());

              const tram = chain.code === LIGHT_RAIL;

              return (
                <path
                  d={d()}
                  stroke={lineColour(chain.code)}
                  stroke-width={(tram ? 3.5 : 6) * k()}
                  class={[
                    "transition-opacity duration-state",
                    { "cursor-zoom-in": tram && !lightRailShown() },
                  ]}
                  opacity={dim() ? 0.22 : 1}
                  onPointerUp={(event) => {
                    if (!tram || lightRailShown()) return;
                    endPointer(event);
                    if (!dragged) fitLightRail();
                  }}
                />
              );
            }}
          </For>
        </g>

        {/* Under the markers so their capsules cap its ends, over the track
            so it reads as a walkway across it rather than beneath it. */}
        <g stroke-linecap="round" aria-hidden="true">
          <For each={LINKS}>
            {([from, to]) => {
              const a = byId.get(from);
              const b = byId.get(to);
              // A walkway belongs to the lines at both ends, and fades with
              // them: left at full strength it was the loudest thing on a map
              // where everything else had stepped back.
              const dim = () => faded([...(a?.lines ?? []), ...(b?.lines ?? [])]);

              return (
                <Show when={a && b}>
                  <g class="transition-opacity duration-state" opacity={dim() ? 0.22 : 1}>
                    <line
                      x1={a!.x}
                      y1={a!.y}
                      x2={b!.x}
                      y2={b!.y}
                      class="stroke-foreground"
                      stroke-width={(CAPSULE + 2.4) * k()}
                    />
                    <line
                      x1={a!.x}
                      y1={a!.y}
                      x2={b!.x}
                      y2={b!.y}
                      class="stroke-card"
                      stroke-width={(CAPSULE - 1.5) * k()}
                    />
                  </g>
                </Show>
              );
            }}
          </For>
        </g>

        <g>
          <For each={MAP_STATIONS}>
            {(station) => {
              const interchange = () => station.lines.length > 1;
              const chosen = () => props.selected === station.id;
              const tram = isLightRailOnly(station);
              /* Hidden tram stops are hidden to the pointer too, or a tap on
                 the collapsed network would pick an invisible station. */
              const revealed = () => !tram || lightRailShown();
              const near = createMemo(() => neighbours().get(station.id) ?? []);
              const side = createMemo(() => labelSide(station, near()));

              const angle = createMemo(() => runAngle(station, near()));
              const capsuleLength = () => ((station.lines.length - 1) * BAR_GAP + CAPSULE) * k();
              /** How far the name has to clear the marker. */
              const clear = () => (interchange() ? CAPSULE / 2 + 3 : BEAD_R + 4) * k();

              return (
                <g
                  role="button"
                  tabindex="0"
                  data-station={station.id}
                  aria-label={`${stationName(station.id)} · ${station.lines.join(" ")}`}
                  aria-pressed={chosen() ? "true" : "false"}
                  class={[
                    "outline-none transition-opacity duration-reveal",
                    revealed() ? "cursor-pointer" : "pointer-events-none",
                  ]}
                  opacity={!revealed() ? 0 : faded(station.lines) ? 0.25 : 1}
                  onPointerUp={(event) => {
                    endPointer(event);
                    if (!dragged) props.onSelect(chosen() ? null : station.id);
                  }}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter" && event.key !== " ") return;
                    event.preventDefault();
                    props.onSelect(chosen() ? null : station.id);
                  }}
                >
                  {/* A finger is wider than a station. The target is sized for
                      the hand and stays invisible. */}
                  <circle cx={station.x} cy={station.y} r={16 * k()} fill="transparent" />

                  <Show when={props.here === station.id}>
                    <circle
                      cx={station.x}
                      cy={station.y}
                      r={15 * k()}
                      class="fill-primary/20 motion-safe:animate-[mb-pulse_2.4s_ease-in-out_infinite]"
                    />
                  </Show>

                  <Show when={chosen()}>
                    <circle
                      cx={station.x}
                      cy={station.y}
                      r={14 * k()}
                      fill="none"
                      class="stroke-primary"
                      stroke-width={2.5 * k()}
                    />
                  </Show>

                  <Show
                    when={interchange()}
                    fallback={
                      <circle
                        cx={station.x}
                        cy={station.y}
                        r={(tram ? BEAD_R * 0.7 : BEAD_R) * k()}
                        class={tram ? "fill-card" : "fill-card stroke-foreground"}
                        stroke={tram ? lineColour(LIGHT_RAIL) : undefined}
                        stroke-width={(tram ? 1.8 : 2) * k()}
                      />
                    }
                  >
                    <g transform={`rotate(${angle()} ${station.x} ${station.y})`}>
                      <rect
                        x={station.x - (CAPSULE / 2) * k()}
                        y={station.y - capsuleLength() / 2}
                        width={CAPSULE * k()}
                        height={capsuleLength()}
                        rx={(CAPSULE / 2) * k()}
                        class="fill-card stroke-foreground"
                        stroke-width={1.6 * k()}
                      />
                      <For each={station.lines}>
                        {(code, i) => (
                          <rect
                            x={station.x - (BAR_W / 2) * k()}
                            y={
                              station.y -
                              capsuleLength() / 2 +
                              (CAPSULE / 2 - BAR_H / 2) * k() +
                              i() * BAR_GAP * k()
                            }
                            width={BAR_W * k()}
                            height={BAR_H * k()}
                            rx={(BAR_H / 2) * k()}
                            fill={lineColour(code)}
                          />
                        )}
                      </For>
                    </g>
                  </Show>

                  {/*
                   * Both languages, the way the station itself is signed: the
                   * reader's own on top and the other under it, smaller and
                   * quieter. A rider who reads one still recognises the other
                   * from the platform, which is the whole reason the railway
                   * prints both.
                   */}
                  <text
                    x={station.x + side().dx * clear()}
                    y={station.y + side().dy * clear() - (side().dy < -0.34 ? 9 * k() : 0)}
                    text-anchor={side().anchor}
                    dominant-baseline={
                      side().dy < -0.34 ? "auto" : side().dy > 0.34 ? "hanging" : "middle"
                    }
                    font-size={String((interchange() ? 12.5 : tram ? 9.5 : 11) * k())}
                    class={[
                      "pointer-events-none",
                      chosen()
                        ? "fill-primary font-bold"
                        : interchange()
                          ? "fill-foreground font-bold"
                          : "fill-muted-foreground font-semibold",
                    ]}
                    /* The diagram runs under the names; a halo in the card's
                         own colour keeps them readable without boxing each. */
                    stroke="var(--card)"
                    stroke-width={3.5 * k()}
                    style={{ "paint-order": "stroke" }}
                    stroke-linejoin="round"
                  >
                    {stationName(station.id)}
                  </text>

                  <Show when={tram ? lightRailBilingual() : bilingual()}>
                    <text
                      x={station.x + side().dx * clear()}
                      y={station.y + side().dy * clear() + (side().dy < -0.34 ? 0 : 10 * k())}
                      text-anchor={side().anchor}
                      dominant-baseline={
                        side().dy < -0.34 ? "auto" : side().dy > 0.34 ? "hanging" : "middle"
                      }
                      font-size={String((tram ? 8 : 9.2) * k())}
                      class="pointer-events-none fill-muted-foreground font-medium"
                      stroke="var(--card)"
                      stroke-width={3 * k()}
                      style={{ "paint-order": "stroke" }}
                      stroke-linejoin="round"
                    >
                      {otherName(station.id)}
                    </text>
                  </Show>
                </g>
              );
            }}
          </For>
        </g>
      </svg>

      <Legend
        lang={props.lang}
        focus={focus()}
        onFocus={(code) => {
          props.onFocus(focus() === code ? null : code);
          if (code === LIGHT_RAIL && !lightRailShown()) fitLightRail();
        }}
      />

      <MapControls
        onZoom={(factor) => {
          const v = view();
          zoomTo(scale() * factor, { x: v.x + v.w / 2, y: v.y + v.h / 2 });
        }}
        onFit={fit}
        fitLabel={t("wholeNetwork", props.lang)}
        zoomInLabel={t("zoomIn", props.lang)}
        zoomOutLabel={t("zoomOut", props.lang)}
      />
    </div>
  );
}

/**
 * The key to the colours, and a way to read one line at a time.
 *
 * The printed map has to be a key and nothing else - it is paper. On a screen
 * the same list can do the thing a rider actually wants from it, which is to
 * follow one line through the tangle: touching a name fades everything that is
 * not that line, and touching it again brings the network back.
 */
function Legend(props: { lang: Lang; focus: string | null; onFocus: (code: string) => void }) {
  return (
    <div class="absolute left-2.5 top-2.5 max-w-[min(66%,20rem)] rounded-xl border border-border bg-card/92 p-1.5 shadow-card backdrop-blur">
      <div class="grid grid-cols-2 gap-x-1 gap-y-px">
        <For each={LEGEND}>
          {(code) => {
            const on = () => props.focus === code;
            return (
              <button
                type="button"
                aria-pressed={on() ? "true" : "false"}
                onClick={() => props.onFocus(code)}
                class={[
                  "mb-press flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-1 text-left transition-colors duration-state",
                  on() ? "bg-secondary" : "",
                ]}
              >
                <span
                  class="h-[3px] w-4 shrink-0 rounded-full"
                  style={{ background: lineColour(code) }}
                  aria-hidden="true"
                />
                <span
                  class={[
                    "truncate text-[0.68rem] leading-tight",
                    on() ? "font-bold text-foreground" : "font-semibold text-muted-foreground",
                  ]}
                >
                  {lineLabel(code, props.lang)}
                </span>
              </button>
            );
          }}
        </For>
      </div>
    </div>
  );
}

/**
 * Zoom, and the way back to the whole network.
 *
 * On screen at all times rather than on hover: a pinch is not discoverable and
 * not available to a mouse, and "fit" is the only way out of a zoom deep enough
 * to have lost the rider.
 *
 * Top right rather than the conventional bottom right, because on a phone the
 * bottom right of the map is under the docked station panel - which is exactly
 * when a rider wants to zoom back out.
 */
function MapControls(props: {
  onZoom: (factor: number) => void;
  onFit: () => void;
  fitLabel: string;
  zoomInLabel: string;
  zoomOutLabel: string;
}) {
  const button =
    "mb-press flex size-9 items-center justify-center rounded-lg border border-border " +
    "bg-card text-muted-foreground shadow-card transition-colors duration-state active:text-foreground";

  return (
    <div class="absolute right-2.5 top-2.5 flex flex-col gap-1.5">
      <button
        type="button"
        onClick={() => props.onZoom(2)}
        aria-label={props.zoomInLabel}
        class={button}
      >
        <PlusIcon size={13} />
      </button>
      <button
        type="button"
        onClick={() => props.onZoom(0.5)}
        aria-label={props.zoomOutLabel}
        class={button}
      >
        <MinusIcon size={13} />
      </button>
      <button
        type="button"
        onClick={props.onFit}
        aria-label={props.fitLabel}
        title={props.fitLabel}
        class={button}
      >
        <ExpandIcon size={13} />
      </button>
    </div>
  );
}
