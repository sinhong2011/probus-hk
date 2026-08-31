/**
 * Builds the traffic-camera index the app ships.
 *
 * The Transport Department points about nine hundred cameras at the roads and
 * publishes each one's picture at a stable URL, refreshed every two minutes -
 * which is the one thing an arrival time cannot say: whether the road the bus
 * is on is moving. The pictures are served with an open CORS header, so the
 * app can show them straight off the department's own CDN; what it cannot do
 * is ask "which camera is near this stop", because the department publishes
 * the locations as XML on a host with no CORS at all. So the locations are
 * folded into one compact JSON here and committed, and the app fetches that.
 *
 * Cameras are added or moved a few times a year. Run `bun run cameras` then.
 *
 *   bun run cameras
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const BASE = "https://static.data.gov.hk/td/traffic-snapshot-images/code";
const EN = `${BASE}/Traffic_Camera_Locations_En.xml`;
const TC = `${BASE}/Traffic_Camera_Locations_Tc.xml`;

const OUT = fileURLToPath(new URL("../public/cameras.json", import.meta.url));

/** One `<image>` block. The feed is flat and regular; no XML library needed. */
interface Entry {
  key: string;
  lat: number;
  lng: number;
  description: string;
}

function parse(xml: string): Entry[] {
  const field = (block: string, name: string): string =>
    new RegExp(`<${name}>([^<]*)</${name}>`).exec(block)?.[1]?.trim() ?? "";

  const out: Entry[] = [];
  for (const [, block] of xml.matchAll(/<image>([\s\S]*?)<\/image>/g)) {
    const key = field(block ?? "", "key");
    const lat = Number(field(block ?? "", "latitude"));
    const lng = Number(field(block ?? "", "longitude"));
    // The description repeats the key in brackets - "… [H429F]" - and the
    // app carries the key separately, so the repeat is dropped.
    const description = field(block ?? "", "description")
      .replace(/\s*[[［][A-Z0-9]+[\]］]\s*$/, "")
      .trim();
    if (key && Number.isFinite(lat) && Number.isFinite(lng)) {
      out.push({ key, lat, lng, description });
    }
  }
  return out;
}

async function feed(url: string): Promise<Entry[]> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} answered ${res.status}`);
  return parse(await res.text());
}

const [en, tc] = await Promise.all([feed(EN), feed(TC)]);

// The two languages are the same list in the same order, but joined by key
// anyway: an entry missing from one side keeps its other name rather than
// someone else's.
const tcByKey = new Map(tc.map((entry) => [entry.key, entry.description]));

/** [key, latitude, longitude, English name, Chinese name]. */
type Row = [string, number, number, string, string];

const rows: Row[] = en
  .map((entry): Row => {
    const zh = tcByKey.get(entry.key) ?? entry.description;
    return [entry.key, entry.lat, entry.lng, entry.description, zh];
  })
  .sort(([a], [b]) => a.localeCompare(b));

writeFileSync(
  OUT,
  `${JSON.stringify({ generated: new Date().toISOString().slice(0, 10), cameras: rows })}\n`,
);

console.log(`cameras.json: ${rows.length} cameras (${tcByKey.size} with Chinese names)`);
