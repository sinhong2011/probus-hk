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
  </message>
  <message>
    <msgID>900002</msgID>
    <CurrentStatus>3</CurrentStatus>
    <ChinText>因交通意外，龍翔道近廣播道的行車線現已解封。</ChinText>
    <EngText>Lung Cheung Road near Broadcast Drive has reopened.</EngText>
  </message>
</body>`;

export interface MockOptions {
  /** Make every arrival feed fail, to exercise the timetable fallback. */
  etaFails?: boolean;
  /** Make the route database fail, to exercise the error boundary. */
  databaseFails?: boolean;
  /** Make the traffic-news feed fail, to exercise its retry. */
  noticesFail?: boolean;
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

  // Route geometry and basemap tiles are network-heavy and irrelevant to
  // behaviour; the map must degrade gracefully without them.
  await page.route("**/hkbus.github.io/**", (route) => route.fulfill({ status: 404, body: "" }));
  await page.route("**/basemaps.cartocdn.com/**", (route) => route.abort());
  await page.route("**/fonts.googleapis.com/**", (route) => route.abort());
  await page.route("**/fonts.gstatic.com/**", (route) => route.abort());
}
