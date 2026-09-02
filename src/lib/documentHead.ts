import { createEffect } from "solid-js";
import type { Bilingual } from "~/data/types";
import { pick, stripStopCode, t, type Lang } from "~/lib/i18n";
import { settings } from "~/stores/settings";

export type PageHeadInfo = {
  title: string;
  description?: string;
};

const SHARE_IMAGE = "/og.png";
const SHARE_IMAGE_WIDTH = 1200;
const SHARE_IMAGE_HEIGHT = 630;

/** `{page} · {app name}` — the pattern every screen title follows. */
export function appTitle(page: string, lang: Lang): string {
  return `${page} · ${t("appName", lang)}`;
}

/** Home: app name first, then what the app does. */
export function homeTitle(lang: Lang): string {
  return `${t("appName", lang)} · ${t("metaTitleSuffix", lang)}`;
}

/** A route page: number, direction, destination. */
export function routeTitle(route: string, dest: Bilingual | undefined, lang: Lang): string {
  const destName = pick(dest, lang);
  const page = destName ? `${route} ${t("towards", lang)} ${destName}` : route;
  return appTitle(page, lang);
}

/** A stop page. */
export function stopTitle(name: Bilingual | undefined, lang: Lang): string {
  return appTitle(stripStopCode(pick(name, lang)), lang);
}

export function routeMetaDescription(route: string, dest: string, lang: Lang): string {
  if (lang === "zh") {
    return `${route} 往 ${dest} 嘅實時到站時間 — 巴士、小巴、港鐵、輕鐵同渡輪。`;
  }
  return `Live arrival times for route ${route} to ${dest} in Hong Kong.`;
}

export function stopMetaDescription(stop: string, lang: Lang): string {
  if (lang === "zh") {
    return `${stop} — 途經路線同實時到站時間。`;
  }
  return `Routes and live arrivals at ${stop} in Hong Kong.`;
}

function upsertMeta(attr: "name" | "property", key: string, content: string) {
  let el = document.querySelector(`meta[${attr}="${key}"]`) as HTMLMetaElement | null;
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.content = content;
}

/** Write the tab title and the meta tags crawlers and shares read. */
export function applyDocumentHead(opts: PageHeadInfo & { lang: Lang }) {
  document.title = opts.title;
  const description = opts.description ?? t("metaDescription", opts.lang);

  upsertMeta("name", "description", description);
  upsertMeta("property", "og:title", opts.title);
  upsertMeta("property", "og:description", description);
  upsertMeta("property", "og:url", window.location.href);
  upsertMeta("property", "og:type", "website");
  upsertMeta("property", "og:site_name", t("appName", opts.lang));
  upsertMeta("property", "og:locale", opts.lang === "zh" ? "zh_HK" : "en");
  const image = `${window.location.origin}${SHARE_IMAGE}`;
  upsertMeta("property", "og:image", image);
  upsertMeta("property", "og:image:width", String(SHARE_IMAGE_WIDTH));
  upsertMeta("property", "og:image:height", String(SHARE_IMAGE_HEIGHT));
  upsertMeta("property", "og:image:alt", opts.title);
  upsertMeta("name", "twitter:card", "summary_large_image");
  upsertMeta("name", "twitter:image", image);
  upsertMeta("name", "twitter:title", opts.title);
  upsertMeta("name", "twitter:description", description);
}

/**
 * Keep the browser tab and head meta in sync with what is on screen.
 *
 * Pass a function so route data and language changes both re-run the effect.
 */
export function usePageHead(info: () => string | PageHeadInfo): void {
  createEffect(
    () => ({ lang: settings.lang(), value: info() }),
    ({ lang, value }) => {
      const title = typeof value === "string" ? value : value.title;
      const description = typeof value === "string" ? undefined : value.description;
      applyDocumentHead({ title, description, lang });
    },
  );
}
