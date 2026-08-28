import type { Bilingual } from "./types";

/**
 * The Transport Department publishes every service disruption - road closures,
 * diverted routes, cancelled sailings - as one bilingual XML feed. It is the
 * same source the official apps use, and it is CORS-open, so the app can read
 * it directly.
 */
const FEED = "https://resource.data.one.gov.hk/td/en/specialtrafficnews.xml";

export interface Notice {
  id: string;
  /** The department's own severity ordering; lower appears to be newer. */
  status: number;
  text: Bilingual;
  /** First line, used as a heading in the list. */
  heading: Bilingual;
  /** Everything after the first line; empty for a one-line notice. */
  detail: Bilingual;
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
    detail: lines.slice(index + 1).join("\n").trim(),
  };
}

function textOf(node: Element, tag: string): string {
  return clean(node.getElementsByTagName(tag)[0]?.textContent ?? "");
}

export async function fetchNotices(): Promise<Notice[]> {
  const res = await fetch(FEED);
  if (!res.ok) throw new Error(`traffic news ${res.status}`);

  const doc = new DOMParser().parseFromString(await res.text(), "text/xml");
  if (doc.getElementsByTagName("parsererror").length > 0) {
    throw new Error("traffic news: malformed feed");
  }

  const out: Notice[] = [];
  for (const node of Array.from(doc.getElementsByTagName("message"))) {
    const zh = textOf(node, "ChinText") || textOf(node, "ChinShort");
    const en = textOf(node, "EngText") || textOf(node, "EngShort");
    if (!zh && !en) continue;

    const zhParts = split(zh);
    const enParts = split(en);

    out.push({
      id: textOf(node, "msgID") || String(out.length),
      status: Number(textOf(node, "CurrentStatus")) || 0,
      text: { zh, en },
      heading: { zh: zhParts.heading, en: enParts.heading },
      detail: { zh: zhParts.detail, en: enParts.detail },
    });
  }

  // The department orders by severity; keep that, it is their judgement.
  return out.sort((a, b) => a.status - b.status);
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
