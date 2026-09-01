import type { Page } from "@playwright/test";
import fixture from "../../fixtures/routeDb.json" with { type: "json" };

/**
 * Real arrival times change every few seconds, so every upstream feed is
 * stubbed. Times are generated relative to the moment of the request and
 * deliberately land on a half-minute, so a countdown that rounds down stays on
 * the same digit for the length of an assertion.
 */
const OFFSETS_MIN = [3.5, 11.5, 24.5];

function hkIso(minutesFromNow: number): string {
  const at = new Date(Date.now() + minutesFromNow * 60_000);
  // The feeds emit Hong Kong local time with an explicit offset.
  const hk = new Date(at.getTime() + 8 * 60 * 60 * 1000);
  return `${hk.toISOString().slice(0, 19)}+08:00`;
}

function kmbRows() {
  const data = [];
  for (let seq = 1; seq <= 40; seq++) {
    for (const dir of ["O", "I"]) {
      OFFSETS_MIN.forEach((offset, index) => {
        data.push({
          co: "KMB",
          route: "1",
          dir,
          service_type: 1,
          seq,
          eta_seq: index + 1,
          eta: hkIso(offset),
          rmk_tc: "",
          rmk_en: "",
          dest_tc: "尖沙咀碼頭",
          dest_en: "STAR FERRY",
        });
      });
    }
  }
  return { type: "StopETA", version: "1.0", data };
}

function ctbRows() {
  const data = [];
  for (const dir of ["O", "I"]) {
    OFFSETS_MIN.forEach((offset, index) => {
      data.push({
        co: "CTB",
        route: "102",
        dir,
        seq: 1,
        stop: "001547",
        eta_seq: index + 1,
        eta: hkIso(offset),
        rmk_tc: "",
        rmk_en: "",
      });
    });
  }
  return { type: "ETA", version: "2.0", data };
}

function gmbRows() {
  return {
    type: "ETA-Stop",
    version: "1.0",
    data: [
      {
        route_id: 2006408,
        route_seq: 1,
        stop_seq: 1,
        enabled: true,
        eta: OFFSETS_MIN.map((offset, index) => ({
          eta_seq: index + 1,
          diff: Math.floor(offset),
          timestamp: hkIso(offset),
          remarks_tc: null,
          remarks_en: null,
        })),
      },
    ],
  };
}

/** A stand-in for the Transport Department feed, with one of each shape. */
const TRAFFIC_NEWS = `<?xml version='1.0' encoding='utf-8'?>
<body xmlns='http://data.one.gov.hk/td'>
  <message>
    <msgID>900001</msgID>
    <CurrentStatus>2</CurrentStatus>
    <ChinText>以下渡輪服務於2026年8\u2F4928\u65E5作出臨時調整：
珀麗灣客運有限公司
-\u2FBA灣至中環：改由巴\u2F20服務(路線NR338S)代替營運</ChinText>
    <EngText>The following ferry services are temporarily adjusted:
Park Island Transport Company Limited
- Replaced by bus services (Route NR338S)</EngText>
    <ReferenceDate> 2026/8/28 下午 07:48:10</ReferenceDate>
  </message>
  <message>
    <msgID>900002</msgID>
    <CurrentStatus>3</CurrentStatus>
    <ChinText>因交通意外，龍翔道近廣播道的行車線現已解封。</ChinText>
    <EngText>Lung Cheung Road near Broadcast Drive has reopened.</EngText>
    <ReferenceDate> 2026/8/28 下午 07:48:10</ReferenceDate>
  </message>
</body>`;

/**
 * The department's other feed - the incident register, which names its own
 * category and location instead of leaving them in the prose.
 */
const TRAFFIC_INCIDENTS = `<?xml version="1.0" encoding="UTF-8"?>
<list>
  <message>
    <INCIDENT_NUMBER>IN-26-06323</INCIDENT_NUMBER>
    <INCIDENT_HEADING_EN>Road Incident</INCIDENT_HEADING_EN>
    <INCIDENT_HEADING_CN>道路事故</INCIDENT_HEADING_CN>
    <LOCATION_EN>Sai Kung Man Yee Road</LOCATION_EN>
    <LOCATION_CN>西貢萬宜路</LOCATION_CN>
    <ANNOUNCEMENT_DATE>2026-08-28T18:00:00</ANNOUNCEMENT_DATE>
    <INCIDENT_STATUS_EN>NEW</INCIDENT_STATUS_EN>
    <ID>145107</ID>
    <CONTENT_EN>Traffic on Sai Kung Man Yee Road is anticipated to be busy.</CONTENT_EN>
    <CONTENT_CN>西貢萬宜路交通預計比較繁忙。</CONTENT_CN>
  </message>
</list>`;

/**
 * A flat colour where the basemap would be.
 *
 * Most map tests are content to let the map fail and check the fallback
 * instead, but a test about something drawn *on* the map needs a map that
 * paints without reaching the network.
 */
export async function mockBasemap(page: Page) {
  await page.route("**/basemaps.cartocdn.com/**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "access-control-allow-origin": "*" },
      body: JSON.stringify({
        version: 8,
        sources: {},
        layers: [{ id: "bg", type: "background", paint: { "background-color": "#141922" } }],
      }),
    }),
  );
}

/**
 * Arrivals shaped like buses that are actually on the road: each one due later
 * at every stop ahead of it, and absent from the stops it has already passed.
 *
 * The shared mock gives every stop the same three times, which is a shape no
 * bus makes - nothing can be worked out about a vehicle from it. Anything that
 * reads positions out of arrival times needs this instead.
 */
export async function mockRunningBuses(page: Page, startSeqs = [8, 18], stops = 25) {
  await page.route("**/data.etabus.gov.hk/v1/transport/kmb/route-eta/**", (route) => {
    const data = [];
    for (const [index, from] of startSeqs.entries()) {
      for (let seq = from; seq <= stops; seq += 1) {
        for (const dir of ["O", "I"]) {
          data.push({
            co: "KMB",
            route: "1",
            dir,
            service_type: 1,
            seq,
            eta_seq: index + 1,
            eta: hkIso(1.5 + (seq - from) * 2),
            rmk_tc: "",
            rmk_en: "",
            dest_tc: "尖沙咀碼頭",
            dest_en: "STAR FERRY",
          });
        }
      }
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "access-control-allow-origin": "*" },
      body: JSON.stringify({ type: "RouteETA", version: "1.0", data }),
    });
  });
}

export interface MockOptions {
  /** Make every arrival feed fail, to exercise the timetable fallback. */
  etaFails?: boolean;
  /** Make the route database fail, to exercise the error boundary. */
  databaseFails?: boolean;
  /** Make the traffic-news feed fail, to exercise its retry. */
  noticesFail?: boolean;
  /**
   * Hong Kong is wet. Off by default: the walk-rain offer is a sheet, and
   * tonight's real thunderstorm would sit over every other dialog.
   */
  weatherWet?: boolean;
}

export async function mockTransit(page: Page, options: MockOptions = {}) {
  await page.route("**/routeFareList.min.json", async (route) => {
    if (options.databaseFails) return route.fulfill({ status: 500, body: "nope" });
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { etag: '"test-fixture"', "access-control-allow-origin": "*" },
      body: JSON.stringify(fixture),
    });
  });

  const eta = async (route: Parameters<Parameters<Page["route"]>[1]>[0], body: unknown) => {
    if (options.etaFails) return route.fulfill({ status: 503, body: "" });
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "access-control-allow-origin": "*" },
      body: JSON.stringify(body),
    });
  };

  await page.route("**/data.etabus.gov.hk/**", (route) => eta(route, kmbRows()));
  await page.route("**/data.etagmb.gov.hk/**", (route) => eta(route, gmbRows()));
  await page.route("**/rt.data.gov.hk/**", (route) => eta(route, ctbRows()));

  /*
   * Heavy rail shares rt.data.gov.hk with Citybus but answers a completely
   * different shape, so it is registered afterwards to take precedence. It also
   * reports the platform, which is half of what a rail arrival means.
   */
  await page.route("**/transport/mtr/getSchedule.php**", (route) => {
    const url = new URL(route.request().url());
    const line = url.searchParams.get("line") ?? "TWL";
    const sta = url.searchParams.get("sta") ?? "ADM";
    const train = (offset: number, seq: number, plat: string) => ({
      seq: String(seq),
      dest: "TSW",
      plat,
      time: hkIso(offset).replace("T", " ").slice(0, 19),
      ttnt: String(Math.round(offset)),
      valid: "Y",
    });
    return eta(route, {
      status: 1,
      data: {
        [`${line}-${sta}`]: {
          UP: [train(2.5, 1, "2"), train(6.5, 2, "2")],
          DOWN: [train(3.5, 1, "1"), train(8.5, 2, "1")],
        },
      },
    });
  });

  await page.route("**/specialtrafficnews.xml", (route) =>
    options.noticesFail
      ? route.fulfill({ status: 503, body: "" })
      : route.fulfill({
          status: 200,
          contentType: "application/xml",
          headers: { "access-control-allow-origin": "*" },
          body: TRAFFIC_NEWS,
        }),
  );

  /*
   * The incident register, matched on its own path so the glob cannot also
   * claim `specialtrafficnews.xml` above it.
   */
  await page.route("**/special_news/trafficnews.xml", (route) =>
    options.noticesFail
      ? route.fulfill({ status: 503, body: "" })
      : route.fulfill({
          status: 200,
          contentType: "application/xml",
          headers: { "access-control-allow-origin": "*" },
          body: TRAFFIC_INCIDENTS,
        }),
  );

  // Route geometry and basemap tiles are network-heavy and irrelevant to
  // behaviour; the map must degrade gracefully without them.
  await page.route("**/hkbus.github.io/**", (route) => route.fulfill({ status: 404, body: "" }));
  await page.route("**/basemaps.cartocdn.com/**", (route) => route.abort());
  await page.route("**/fonts.googleapis.com/**", (route) => route.abort());
  await page.route("**/fonts.gstatic.com/**", (route) => route.abort());

  /*
   * HKO rain. Dry unless a test asks for wet: the walk-rain offer is a
   * one-time sheet, and a live warning would cover every other tap.
   */
  await page.route("**/data.weather.gov.hk/**", (route) => {
    const url = route.request().url();
    if (url.includes("rhrread")) {
      return route.fulfill({
        json: {
          rainfall: { data: [{ place: "油尖旺", max: options.weatherWet ? 8 : 0 }] },
        },
      });
    }
    return route.fulfill({
      json: options.weatherWet ? { WTS: { code: "WTS" } } : {},
    });
  });
  await page.route("**/api.rainviewer.com/**", (route) => route.abort());
}

/** A 1×1 red PNG so radar is a visible wash, not RainViewer's placeholder. */
const RAIN_TILE_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

/**
 * RainViewer catalogue + tiles. Register after `mockTransit` so this wins
 * over the dry abort.
 */
export async function mockRainRadar(page: Page) {
  await page.route("**/api.rainviewer.com/**", (route) =>
    route.fulfill({
      json: {
        host: "https://tilecache.rainviewer.com",
        radar: { past: [{ path: "/v2/radar/e2e" }] },
      },
    }),
  );
  await page.route("**/tilecache.rainviewer.com/**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "image/png",
      headers: { "access-control-allow-origin": "*" },
      body: RAIN_TILE_PNG,
    }),
  );
}
