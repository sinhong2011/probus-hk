import type { Bilingual } from "./types";

/**
 * The Transport Department publishes its disruptions twice, in two feeds that
 * do not carry the same things, and the screen wants both.
 *
 * `SPECIAL` is the announcements desk: free prose about diverted routes,
 * cancelled sailings, a road reopening. It is the longer list.
 *
 * `INCIDENTS` is the incident register, and it is the structured one - every
 * record names its category, where it happened, which direction, and carries a
 * real ISO timestamp. A notice that comes from here does not need its heading
 * guessed from its first line, and it can say where.
 *
 * Both are CORS-open, so the app reads them directly.
 */
const SPECIAL = "https://resource.data.one.gov.hk/td/en/specialtrafficnews.xml";
const INCIDENTS = "https://www.td.gov.hk/tc/special_news/trafficnews.xml";

export interface Notice {
  id: string;
  /** The department's own severity ordering; lower appears to be newer. */
  status: number;
  /** When the department published it, or `null` where the feed omitted it. */
  at: Date | null;
  text: Bilingual;
  /** First line, used as a heading in the list. */
  heading: Bilingual;
  /** Everything after the first line; empty for a one-line notice. */
  detail: Bilingual;
  /**
   * Where it happened, when the feed says so. Only the incident register
   * carries this; the announcements desk leaves it to the prose.
   */
  location?: Bilingual;
}

/**
 * The feed encodes some characters as Kangxi radicals rather than the ordinary
 * ideographs - "8⽉" (U+2F49) instead of "8月" (U+6708). They look almost
 * identical but break search and can fall back to a different font.
 *
 * Only those two radical blocks are normalised, deliberately: running NFKC over
 * the whole string would also rewrite full-width punctuation ("：" to ":"),
 * which is correct typography in Chinese and should be left alone.
 */
const RADICALS = /[\u2E80-\u2EFF\u2F00-\u2FDF]/g;

function clean(value: string): string {
  return value
    .replace(RADICALS, (ch) => ch.normalize("NFKC"))
    .replace(/\r/g, "")
    .trim();
}

function split(value: string): { heading: string; detail: string } {
  const lines = value.split("\n");
  const index = lines.findIndex((l) => l.trim().length > 0);
  if (index < 0) return { heading: value.trim(), detail: "" };
  return {
    heading: (lines[index] ?? "").trim(),
    detail: lines
      .slice(index + 1)
      .join("\n")
      .trim(),
  };
}

function textOf(node: Element, tag: string): string {
  return clean(node.getElementsByTagName(tag)[0]?.textContent ?? "");
}

/**
 * The feed's own timestamp, in the shape it actually publishes:
 * " 2026/8/28 下午 07:48:10" - a Hong Kong wall-clock time with a Chinese
 * meridiem marker and no offset, in the English feed as much as the Chinese
 * one. Months and days are not zero-padded, so `Date` cannot be trusted with
 * it and the parts are read out by hand.
 *
 * The clock is Hong Kong's, so the instant is built from UTC and shifted,
 * rather than from the device's own zone.
 */
const HK_OFFSET_MS = 8 * 60 * 60 * 1000;
const REFERENCE_DATE =
  /(\d{4})\/(\d{1,2})\/(\d{1,2})\s*(上午|下午|AM|PM)?\s*(\d{1,2}):(\d{2})(?::(\d{2}))?/i;

export function parseReferenceDate(value: string): Date | null {
  const m = REFERENCE_DATE.exec(value.trim());
  if (!m) return null;

  const [, year, month, day, meridiem, hh, mm, ss] = m;
  let hours = Number(hh);
  const afternoon = meridiem === "下午" || /^pm$/i.test(meridiem ?? "");
  const morning = meridiem === "上午" || /^am$/i.test(meridiem ?? "");
  // 下午 12:05 is five past noon; 上午 12:05 is five past midnight.
  if (afternoon && hours < 12) hours += 12;
  if (morning && hours === 12) hours = 0;

  const at = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    hours,
    Number(mm),
    Number(ss ?? 0),
  );
  return Number.isNaN(at) ? null : new Date(at - HK_OFFSET_MS);
}

function messagesIn(xml: string): Element[] {
  const doc = new DOMParser().parseFromString(xml, "text/xml");
  if (doc.getElementsByTagName("parsererror").length > 0) {
    throw new Error("traffic news: malformed feed");
  }
  return Array.from(doc.getElementsByTagName("message"));
}

/** The announcements desk: prose, with the first line taken as the heading. */
function readSpecial(node: Element, index: number): Notice | null {
  const zh = textOf(node, "ChinText") || textOf(node, "ChinShort");
  const en = textOf(node, "EngText") || textOf(node, "EngShort");
  if (!zh && !en) return null;

  const zhParts = split(zh);
  const enParts = split(en);

  return {
    id: textOf(node, "msgID") || `special-${index}`,
    status: Number(textOf(node, "CurrentStatus")) || 0,
    at: parseReferenceDate(textOf(node, "ReferenceDate")),
    text: { zh, en },
    heading: { zh: zhParts.heading, en: enParts.heading },
    detail: { zh: zhParts.detail, en: enParts.detail },
  };
}

/**
 * The incident register, which names its own parts.
 *
 * The heading is the department's category - "道路事故", "特別交通安排" - and
 * the body is the announcement in full, so nothing has to be guessed from
 * where a line happens to break.
 */
function readIncident(node: Element, index: number): Notice | null {
  const zh = textOf(node, "CONTENT_CN");
  const en = textOf(node, "CONTENT_EN");
  if (!zh && !en) return null;

  const headingZh = textOf(node, "INCIDENT_HEADING_CN");
  const headingEn = textOf(node, "INCIDENT_HEADING_EN");
  const locationZh = textOf(node, "LOCATION_CN");
  const locationEn = textOf(node, "LOCATION_EN");

  /*
   * `ANNOUNCEMENT_DATE` is a bare local time - "2026-08-29T10:00:00" with no
   * offset, which `Date` would read in the device's zone. The clock is Hong
   * Kong's wherever the reader is.
   */
  const stamp = textOf(node, "ANNOUNCEMENT_DATE");
  const parsed = stamp ? Date.parse(`${stamp}+08:00`) : Number.NaN;

  return {
    id: textOf(node, "ID") || textOf(node, "INCIDENT_NUMBER") || `incident-${index}`,
    // NEW first, matching the ordering the other feed asks for by number.
    status: /new/i.test(textOf(node, "INCIDENT_STATUS_EN")) ? 0 : 1,
    at: Number.isNaN(parsed) ? null : new Date(parsed),
    text: { zh, en },
    heading: { zh: headingZh || split(zh).heading, en: headingEn || split(en).heading },
    detail: { zh, en },
    location: locationZh || locationEn ? { zh: locationZh, en: locationEn } : undefined,
  };
}

/** The text a notice is, ignoring how it was spaced, for spotting repeats. */
function fingerprint(notice: Notice): string {
  return `${notice.text.zh}|${notice.text.en}`.replace(/\s+/g, "").toLowerCase();
}

export async function fetchNotices(): Promise<Notice[]> {
  /*
   * The announcements desk is the one this screen cannot do without, so a
   * failure there is a failure. The incident register only adds to it, and a
   * screen of announcements is worth more than an error page.
   */
  const [special, incidents] = await Promise.all([
    fetch(SPECIAL).then(async (res) => {
      if (!res.ok) throw new Error(`traffic news ${res.status}`);
      return res.text();
    }),
    fetch(INCIDENTS)
      .then((res) => (res.ok ? res.text() : null))
      .catch(() => null),
  ]);

  const out = messagesIn(special)
    .map(readSpecial)
    .filter((n): n is Notice => n !== null);

  if (incidents) {
    const seen = new Set(out.map(fingerprint));
    for (const [index, node] of messagesIn(incidents).entries()) {
      const notice = readIncident(node, index);
      // The same announcement reaches both feeds; the prose one already has it.
      if (!notice || seen.has(fingerprint(notice))) continue;
      seen.add(fingerprint(notice));
      out.push(notice);
    }
  }

  /*
   * The department orders by severity; keep that, it is their judgement. The
   * timestamp only breaks ties - in practice every message in a fetch carries
   * the same one, because the feed is regenerated whole.
   */
  return out.sort((a, b) => a.status - b.status || (b.at?.getTime() ?? 0) - (a.at?.getTime() ?? 0));
}

/**
 * Route numbers mentioned in a notice, so it can be surfaced against the routes
 * a rider actually cares about.
 *
 * Deliberately conservative: it only matches text that is explicitly labelled
 * as a route, because bare alphanumerics in prose ("5:00 p.m.") would produce
 * constant false positives.
 */
export function routesMentioned(notice: Notice): string[] {
  const found = new Set<string>();
  const patterns = [
    /(?:路線|路綫)\s*([0-9]{1,3}[A-Z]{0,2}|[A-Z]{1,3}[0-9]{1,3}[A-Z]?)/g,
    /Route\s+([0-9]{1,3}[A-Z]{0,2}|[A-Z]{1,3}[0-9]{1,3}[A-Z]?)/gi,
  ];

  for (const source of [notice.text.zh, notice.text.en]) {
    for (const pattern of patterns) {
      for (const match of source.matchAll(pattern)) {
        if (match[1]) found.add(match[1].toUpperCase());
      }
    }
  }
  return [...found];
}
