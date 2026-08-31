import { For, Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js";
import type { JSX } from "@solidjs/web";
import { LIGHT_RAIL, LIGHT_RAIL_SHAPE, MAP_EDGES, MAP_STATIONS } from "~/data/railMap";
import {
  BAR_GAP,
  BAR_H,
  BAR_W,
  BEAD_R,
  CAPSULE,
  CHAINS,
  CORNER,
  DIRECTIONS,
  EVERY_NAME_FROM,
  LIGHT_RAIL_BOX,
  LIGHT_RAIL_FROM,
  LINE,
  MAX_SCALE,
  MIN_SCALE,
  NAME_SIZE,
  OTHER_SIZE,
  PAIR,
  PLACEMENTS,
  PLACEMENT_STEP,
  STACK,
  TRAM_LINE,
  WORLD,
  byId,
  capsuleAngle,
  isLightRailOnly,
  offsetPoints,
  placeLabels,
  roundedPath,
  type Box,
} from "~/data/railLayout";
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

/**
 * How many pixels a grid square needs before a name is worth reading, which is
 * both when the second language appears and the zoom the map opens at.
 */
const LABEL_FROM = 24;
/** Where the map opens when it has no better idea. Four lines meet here. */
const HOME_STATION = "ADM";

const lineColour = (code: string) =>
  code === LIGHT_RAIL ? OPERATORS.lightRail.color : plateStyle(["mtr"], code).background;

/** The line's name as a rider says it, which for the light rail is the operator. */
const lineLabel = (code: string, lang: Lang) =>
  code === LIGHT_RAIL ? OPERATORS.lightRail.name[lang] : pick(lineName(code), lang);

/**
 * Pairs you change between on foot, without leaving the fare gates.
 *
 * They are two stations, and the map has to say so - Hong Kong and Central are
 * separate names on separate lines - while also saying that changing between
 * them is one move. The railway draws the pair joined by a dotted walkway, and
 * a dotted line is exactly the right weight: plainly not track, plainly a way.
 */
const LINKS: [string, string][] = [
  ["HOK", "CEN"],
  ["KOW", "AUS"],
  ["TST", "ETS"],
];

/** The lines, in the order the railway's own map lists them. */
const LEGEND = Object.keys(MAP_EDGES).sort((a, b) => lineRank(a) - lineRank(b));

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
  /** "All" in the key was touched: the whole network, and whatever the page
      wants to show for it. Without it, "all" only clears the focus. */
  onAll?: () => void;
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
   * The names arrive in stages, each at the zoom where it can be read: the
   * interchanges are always named, the ordinary stations once a square has
   * ten pixels - below that a name is wider than the gap to the next one, and
   * a fitted phone was ninety names on top of each other - and the *second*
   * language later still, because doubling every label at the widest zoom
   * turns the diagram back into a block of text.
   */
  const everyName = () => scale() >= EVERY_NAME_FROM;
  const bilingual = () => scale() >= LABEL_FROM;
  const lightRailShown = () => scale() >= LIGHT_RAIL_FROM;
  /** A second name on a tram stop needs twice the room again. */
  const lightRailBilingual = () => scale() >= LIGHT_RAIL_FROM * 2;

  const stationName = (id: string) =>
    stripStopCode(pick(db().stopList[id]?.name, props.lang)) || id;
  const otherName = (id: string) =>
    stripStopCode(pick(db().stopList[id]?.name, props.lang === "zh" ? "en" : "zh"));

  const placementScale = createMemo(() => {
    const s = Math.max(scale(), MIN_SCALE);
    return PLACEMENT_STEP ** Math.floor(Math.log(s) / Math.log(PLACEMENT_STEP));
  });
  const placement = createMemo(() =>
    placeLabels({
      scale: placementScale(),
      name: stationName,
      other: otherName,
      bilingual: bilingual(),
      minorShown: everyName(),
      tramShown: lightRailShown(),
      tramBilingual: lightRailBilingual(),
    }),
  );

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
       * Fitting the network is the right opening view only where its names
       * can be read - fitted to a phone the ordinary stations lose theirs.
       * The map opens on the hub at a legible zoom instead, and the fit
       * button is there for the rider who wants the shape.
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

  const viewBox = () => {
    const v = view();
    return `${v.x} ${v.y} ${v.w} ${v.h}`;
  };

  return (
    <div
      ref={watch}
      class={["relative touch-none overflow-hidden rounded-xl bg-card", props.class ?? ""]}
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
          {/* The light rail's loops, standing for the network until the rider
              is close enough for its stops; touching them goes there. Each is
              an open path that begins and ends at a station, so its corners
              round and its ends meet under the marker. */}
          <For each={LIGHT_RAIL_SHAPE}>
            {(shape) => {
              const points = shape.map(([x, y]) => ({ x, y }));
              const d = () => roundedPath(points, CORNER * k());
              return (
                <path
                  d={d()}
                  stroke={lineColour(LIGHT_RAIL)}
                  stroke-width={TRAM_LINE * k()}
                  class={[
                    "transition-opacity duration-reveal",
                    lightRailShown() ? "pointer-events-none" : "cursor-zoom-in",
                  ]}
                  opacity={lightRailShown() ? 0 : faded([LIGHT_RAIL]) ? 0.22 : 1}
                  onPointerUp={(event) => {
                    endPointer(event);
                    if (!dragged) fitLightRail();
                  }}
                />
              );
            }}
          </For>

          <For each={CHAINS}>
            {(chain) => {
              const tram = chain.code === LIGHT_RAIL;
              const dim = () => faded([chain.code]);
              const d = () =>
                roundedPath(offsetPoints(chain.points, chain.shifts, PAIR * k()), CORNER * k());
              const hidden = () => tram && !lightRailShown();

              return (
                <path
                  d={d()}
                  stroke={lineColour(chain.code)}
                  stroke-width={(tram ? TRAM_LINE : LINE) * k()}
                  class={[
                    "transition-opacity duration-reveal",
                    { "pointer-events-none": hidden() },
                  ]}
                  opacity={hidden() ? 0 : dim() ? 0.22 : 1}
                />
              );
            }}
          </For>
        </g>

        {/* Under the markers so their capsules cap its ends. */}
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
                  <line
                    x1={a!.x}
                    y1={a!.y}
                    x2={b!.x}
                    y2={b!.y}
                    class="stroke-foreground transition-opacity duration-state"
                    opacity={dim() ? 0.22 : 0.8}
                    stroke-width={2.4 * k()}
                    stroke-dasharray={`0 ${5.5 * k()}`}
                  />
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
              const side = () => placement().get(station.id) ?? PLACEMENTS[0]!;

              const angle = capsuleAngle(DIRECTIONS.get(station.id) ?? []);
              const capsuleLength = () => ((station.lines.length - 1) * BAR_GAP + CAPSULE) * k();
              /** How far the name has to clear the marker. */
              const clear = () => (interchange() ? CAPSULE / 2 + 3 : BEAD_R + 4) * k();
              const two = () => (tram ? lightRailBilingual() : bilingual());
              /** Ordinary stations lose their name below the readable zoom. */
              const named = () => interchange() || tram || everyName();
              const nameX = () => station.x + side().dx * clear();
              const nameY = () => station.y + side().dy * clear();

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
                      class="fill-primary/20 motion-safe:animate-[app-pulse_2.4s_ease-in-out_infinite]"
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
                    <g transform={`rotate(${angle} ${station.x} ${station.y})`}>
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
                   * prints both. Above the marker the pair is lifted so the
                   * second line clears it; elsewhere the second hangs under.
                   */}
                  <text
                    x={nameX()}
                    y={nameY() - (side().baseline === "auto" && two() ? STACK * k() : 0)}
                    text-anchor={side().anchor}
                    dominant-baseline={side().baseline}
                    font-size={String(
                      NAME_SIZE[interchange() ? "interchange" : tram ? "tram" : "station"] * k(),
                    )}
                    class={[
                      "pointer-events-none transition-opacity duration-reveal",
                      chosen()
                        ? "fill-primary font-bold"
                        : interchange()
                          ? "fill-foreground font-bold"
                          : "fill-muted-foreground font-semibold",
                    ]}
                    opacity={named() ? 1 : 0}
                    /* The diagram runs under the names; a halo in the card's
                         own colour keeps them readable without boxing each. */
                    stroke="var(--card)"
                    stroke-width={3.5 * k()}
                    style={{ "paint-order": "stroke" }}
                    stroke-linejoin="round"
                  >
                    {stationName(station.id)}
                  </text>

                  <Show when={two()}>
                    <text
                      x={nameX()}
                      y={nameY() + (side().baseline === "auto" ? 0 : STACK * k())}
                      text-anchor={side().anchor}
                      dominant-baseline={side().baseline}
                      font-size={String(
                        OTHER_SIZE[interchange() ? "interchange" : tram ? "tram" : "station"] * k(),
                      )}
                      class="fill-muted-foreground font-medium"
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
          props.onFocus(code !== null && focus() === code ? null : code);
          if (code === LIGHT_RAIL && !lightRailShown()) fitLightRail();
        }}
        onAll={() => (props.onAll ? props.onAll() : props.onFocus(null))}
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
 * not that line, and touching it again brings the network back. "All" heads
 * the list as the way back that does not have to be remembered: the entry
 * that is lit when nothing is singled out, and that lights the whole network
 * again when something is.
 */
function Legend(props: {
  lang: Lang;
  focus: string | null;
  onFocus: (code: string) => void;
  onAll: () => void;
}) {
  return (
    <div class="absolute left-2.5 top-2.5 max-w-[min(66%,20rem)] rounded-xl bg-card/92 p-1.5 shadow-card backdrop-blur">
      <div class="grid grid-cols-2 gap-x-1 gap-y-px">
        <LegendEntry
          on={props.focus === null}
          onClick={props.onAll}
          swatch={{ background: `linear-gradient(90deg, ${ALL_SWATCH})` }}
          label={t("allLines", props.lang)}
        />
        <For each={LEGEND}>
          {(code) => (
            <LegendEntry
              on={props.focus === code}
              onClick={() => props.onFocus(code)}
              swatch={{ background: lineColour(code) }}
              label={lineLabel(code, props.lang)}
            />
          )}
        </For>
      </div>
    </div>
  );
}

/** The "all" swatch: the first few lines' colours, side by side, as one bar. */
const ALL_SWATCH = LEGEND.slice(0, 4)
  .map((code, i, list) => {
    const from = (i / list.length) * 100;
    const to = ((i + 1) / list.length) * 100;
    return `${lineColour(code)} ${from}% ${to}%`;
  })
  .join(", ");

function LegendEntry(props: {
  on: boolean;
  onClick: () => void;
  swatch: JSX.CSSProperties;
  label: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={props.on ? "true" : "false"}
      onClick={props.onClick}
      class={[
        "app-press flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-1 text-left transition-colors duration-state",
        props.on ? "bg-secondary" : "",
      ]}
    >
      <span class="h-[3px] w-4 shrink-0 rounded-full" style={props.swatch} aria-hidden="true" />
      <span
        class={[
          "truncate text-[0.68rem] leading-tight",
          props.on ? "font-bold text-foreground" : "font-semibold text-muted-foreground",
        ]}
      >
        {props.label}
      </span>
    </button>
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
    "app-press app-glass flex size-9 items-center justify-center rounded-lg " +
    "text-muted-foreground transition-colors duration-state active:text-foreground";

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
      <button type="button" onClick={props.onFit} aria-label={props.fitLabel} class={button}>
        <ExpandIcon size={13} />
      </button>
    </div>
  );
}
