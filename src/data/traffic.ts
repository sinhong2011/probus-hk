import { createSignal } from "solid-js";
import type { Position } from "./waypoints";

/**
 * How the roads a route runs along are actually moving.
 *
 * The Transport Department measures an average speed for ~4,500 links of the
 * strategic road network, every two minutes, on a feed with open CORS - the
 * one thing an arrival time cannot say. The link shapes are baked by
 * `scripts/build-traffic-segments.ts` into the file fetched here; the live
 * speeds are fetched straight from the department.
 *
 * Coverage is the strategic network only: trunk roads, tunnels, corridors.
 * The estate streets at either end of a bus route have no detectors, so a
 * route typically colours through its middle and stays quiet at its ends -
 * which is honest, because the middle is where a bus loses its time.
 */
const SHAPES_URL = "/traffic-segments.json";
const FEED_URL = "https://resource.data.one.gov.hk/td/traffic-detectors/irnAvgSpeed-all.xml";

/** The department publishes a new reading every two minutes. */
export const TRAFFIC_REFRESH_MS = 120_000;

/*
 * The speed bands the community settled on for this feed. Free flow is not
 * drawn at all - the layer marks trouble, not health - so only these two
 * matter: crawling, and properly stuck.
 */
export const SLOW_MAX_KMH = 30;
export const CONGESTED_MAX_KMH = 17;

export type TrafficLevel = "slow" | "congested";

export function trafficLevel(speedKmh: number): TrafficLevel | null {
  if (speedKmh <= CONGESTED_MAX_KMH) return "congested";
  if (speedKmh <= SLOW_MAX_KMH) return "slow";
  return null;
}

/** A link's shape: one or more runs of [lng, lat] pairs. */
export type SegmentShapes = Map<number, Position[][]>;

interface ShapeFile {
  generated: string;
  irnVersion: string;
  segments: Record<string, Position[][]>;
}

let shapes: SegmentShapes | null = null;
let pending: Promise<void> | null = null;

/* Loaded like the cameras and the rail fares: once, lazily, and the counter
   is what makes the layer appear when the shapes land. */
const [loaded, setLoaded] = createSignal(0);

function load() {
  pending ??= fetch(SHAPES_URL)
    .then((res) => (res.ok ? (res.json() as Promise<ShapeFile>) : null))
    .then((data) => {
      if (!data?.segments) return;
      shapes = new Map(Object.entries(data.segments).map(([id, lines]) => [Number(id), lines]));
    })
    // Offline, or the asset is missing: the map simply draws no traffic.
    .catch(() => undefined)
    .finally(() => setLoaded((n) => n + 1));
}

/** The baked link shapes, or `null` while they are still coming. */
export function trafficShapes(): SegmentShapes | null {
  loaded();
  if (!shapes) load();
  return shapes;
}

/**
 * The current reading per link, in km/h - only links whose detector reported
 * (`valid` on the feed). `null` when the feed cannot be reached, which the
 * caller shows as no traffic rather than as an error: the map's first job is
 * still the route.
 */
export async function fetchTrafficSpeeds(): Promise<Map<number, number> | null> {
  try {
    const res = await fetch(FEED_URL);
    if (!res.ok) return null;
    return parseTrafficFeed(await res.text());
  } catch {
    return null;
  }
}

/** The feed is flat and regular; no XML parser needed. */
export function parseTrafficFeed(xml: string): Map<number, number> {
  const speeds = new Map<number, number>();
  for (const [, id, speed, valid] of xml.matchAll(
    /<segment_id>(\d+)<\/segment_id><speed>([\d.]+)<\/speed><valid>(Y|N)<\/valid>/g,
  )) {
    if (valid === "Y") speeds.set(Number(id), Number(speed));
  }
  return speeds;
}

/*
 * Matching links to a route's corridor. Everything below works in "scaled
 * degrees" - longitude compressed by cos(latitude) so a degree measures the
 * same ground in both axes - and converts to metres only at the edges.
 */

/** How far a link may sit from the route's line and still be its road. */
const CORRIDOR_M = 40;

/**
 * How far a link's heading may differ from the route's, in degrees. The other
 * carriageway of the same road sits well inside 40 m, and its jam is not this
 * bus's jam; it runs the opposite way, which is what this cuts.
 */
const HEADING_TOLERANCE = 65;

const DEG_M = 111_320;
const SCALE = Math.cos((22.35 * Math.PI) / 180); // Hong Kong's latitude.

const sx = (p: Position) => p[0] * SCALE;

function bearing(ax: number, ay: number, bx: number, by: number): number {
  return (Math.atan2(by - ay, bx - ax) * 180) / Math.PI;
}

/** Smallest angle between two headings, 0-180. */
function headingGap(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

interface RouteEdge {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  heading: number;
}

/** Distance in scaled degrees from a point to one edge of the route. */
function edgeDistance(edge: RouteEdge, x: number, y: number): number {
  const dx = edge.bx - edge.ax;
  const dy = edge.by - edge.ay;
  const lengthSq = dx * dx + dy * dy;
  const t =
    lengthSq === 0
      ? 0
      : Math.max(0, Math.min(1, ((x - edge.ax) * dx + (y - edge.ay) * dy) / lengthSq));
  const px = edge.ax + t * dx;
  const py = edge.ay + t * dy;
  return Math.hypot(x - px, y - py);
}

/**
 * The links that lie along a route - close to its line and headed the same
 * way. Computed once per route from the drawn shape, so the corridor is the
 * same line the rider is looking at.
 */
export function segmentsAlong(routeLines: Position[][], links: SegmentShapes): number[] {
  const edges: RouteEdge[] = [];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const line of routeLines) {
    for (let i = 0; i < line.length; i++) {
      const x = sx(line[i] as Position);
      const y = (line[i] as Position)[1];
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (i > 0) {
        const ax = sx(line[i - 1] as Position);
        const ay = (line[i - 1] as Position)[1];
        // Zero-length edges carry no heading; skip them.
        if (ax === x && ay === y) continue;
        edges.push({ ax, ay, bx: x, by: y, heading: bearing(ax, ay, x, y) });
      }
    }
  }
  if (edges.length === 0) return [];

  const margin = CORRIDOR_M / DEG_M;
  minX -= margin;
  maxX += margin;
  minY -= margin;
  maxY += margin;

  const near = (x: number, y: number, heading: number): boolean => {
    let best = Infinity;
    let bestHeading = 0;
    for (const edge of edges) {
      const d = edgeDistance(edge, x, y);
      if (d < best) {
        best = d;
        bestHeading = edge.heading;
      }
    }
    return best * DEG_M <= CORRIDOR_M && headingGap(heading, bestHeading) <= HEADING_TOLERANCE;
  };

  const out: number[] = [];
  for (const [id, lines] of links) {
    // The whole link has to ride the corridor, not clip a corner of it: a
    // cross-street shares one point with the route at the junction, and its
    // queue is not this road's queue. A point outside the box is outside the
    // corridor by definition, which is what makes the far links cheap to drop.
    let probed = false;
    let rides = true;
    for (const line of lines) {
      if (!rides || line.length < 2) continue;
      const first = line[0] as Position;
      const last = line[line.length - 1] as Position;
      const mid = line[Math.floor(line.length / 2)] as Position;
      const heading = bearing(sx(first), first[1], sx(last), last[1]);

      for (const p of line.length > 2 ? [first, mid, last] : [first, last]) {
        const x = sx(p);
        const y = p[1];
        probed = true;
        if (x < minX || x > maxX || y < minY || y > maxY || !near(x, y, heading)) {
          rides = false;
          break;
        }
      }
    }
    if (probed && rides) out.push(id);
  }
  return out;
}
