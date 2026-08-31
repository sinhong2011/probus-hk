/**
 * Builds the road-segment geometry the traffic layer draws.
 *
 * The Transport Department publishes a live average speed for ~4,500 links of
 * the strategic road network every two minutes, with open CORS - but the feed
 * names each link only by an id. The shapes behind those ids live in the
 * department's Road Network dataset on the CSDI portal, which is not a thing
 * to ask for at runtime: the full centreline layer is hundreds of megabytes
 * of survey-grade vertices. So this script asks the portal's query API for
 * exactly the links the feed names, lets the server simplify them to a
 * tolerance a phone map can actually show, and folds the result into one
 * compact JSON, committed like the cameras and the rail fares.
 *
 * The link set moves only when the department re-cuts its network (the feed
 * carries an `irn_version`). Run `bun run traffic` when it does.
 *
 *   bun run traffic
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** The live feed: names every link the geometry has to cover. */
const FEED = "https://resource.data.one.gov.hk/td/traffic-detectors/irnAvgSpeed-all.xml";

/** The Road Network's centreline layer on the CSDI portal's query API. */
const CENTERLINE =
  "https://portal.csdi.gov.hk/server/rest/services/common/td_rcd_1638949160594_2844/MapServer/10/query";

/**
 * How far a drawn line may stray from the surveyed one, in degrees - about
 * three metres. The survey data places a vertex every few centimetres, which
 * is three hundred times denser than any zoom this map reaches.
 */
const TOLERANCE = 0.00003;

/** Ids per query: keeps the URL well under any sensible server limit. */
const BATCH = 200;

const OUT = fileURLToPath(new URL("../public/traffic-segments.json", import.meta.url));

const feedXml = await (await fetch(FEED)).text();
const version = /<irn_version>(\d+)<\/irn_version>/.exec(feedXml)?.[1] ?? "unknown";
const ids = [...feedXml.matchAll(/<segment_id>(\d+)<\/segment_id>/g)].map((m) => Number(m[1]));

console.log(`feed: ${ids.length} segments, irn version ${version}`);

interface Feature {
  properties: { ROUTE_ID: number };
  geometry: { type: "LineString" | "MultiLineString"; coordinates: unknown };
}

const round = (n: number) => Math.round(n * 1e5) / 1e5;

/** A segment's shape: one or more runs of [lng, lat] pairs. */
const shapes = new Map<number, number[][][]>();

for (let i = 0; i < ids.length; i += BATCH) {
  const batch = ids.slice(i, i + BATCH);
  const url = new URL(CENTERLINE);
  url.searchParams.set("where", `ROUTE_ID IN (${batch.join(",")})`);
  url.searchParams.set("outFields", "ROUTE_ID");
  url.searchParams.set("outSR", "4326");
  url.searchParams.set("maxAllowableOffset", String(TOLERANCE));
  url.searchParams.set("f", "geojson");

  const res = await fetch(url);
  if (!res.ok) throw new Error(`${CENTERLINE} answered ${res.status}`);
  const data = (await res.json()) as { features?: Feature[] };

  for (const feature of data.features ?? []) {
    const id = feature.properties.ROUTE_ID;
    const geometry = feature.geometry;
    const lines = (
      geometry.type === "MultiLineString"
        ? (geometry.coordinates as number[][][])
        : [geometry.coordinates as number[][]]
    ).map((line) => line.map(([lng, lat]) => [round(lng ?? 0), round(lat ?? 0)]));

    // A link split across features keeps every part.
    shapes.set(id, [...(shapes.get(id) ?? []), ...lines]);
  }
  process.stdout.write(`\rgeometry: ${Math.min(i + BATCH, ids.length)}/${ids.length}`);
}
console.log();

const missing = ids.filter((id) => !shapes.has(id));

const segments = Object.fromEntries(
  [...shapes.entries()].sort(([a], [b]) => a - b).map(([id, lines]) => [id, lines]),
);

writeFileSync(
  OUT,
  `${JSON.stringify({
    generated: new Date().toISOString().slice(0, 10),
    irnVersion: version,
    segments,
  })}\n`,
);

const points = [...shapes.values()].flat().reduce((n, line) => n + line.length, 0);
console.log(
  `traffic-segments.json: ${shapes.size} segments, ${points} points` +
    (missing.length ? `; ${missing.length} ids with no geometry` : ""),
);
