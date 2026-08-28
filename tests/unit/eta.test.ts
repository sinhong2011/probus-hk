import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearEtaCache, parseHkTime } from "~/data/eta/http";
import { fetchKmbEta } from "~/data/eta/kmb";
import { fetchCtbEta } from "~/data/eta/ctb";
import { fetchNlbEta } from "~/data/eta/nlb";
import { fetchGmbEta } from "~/data/eta/gmb";
import { fetchLightRailEta, fetchLrtFeederEta, fetchMtrRailEta } from "~/data/eta/mtr";
import type { EtaQuery } from "~/data/eta/types";
import type { Company, KeyedRoute } from "~/data/types";

/** Records every request so the adapters' URLs and bodies can be asserted. */
let calls: { url: string; init?: RequestInit }[] = [];

function stubJson(payload: unknown) {
  vi.stubGlobal("fetch", (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return Promise.resolve(
      new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
  });
}

function route(overrides: Partial<KeyedRoute> = {}): KeyedRoute {
  return {
    key: "1+1+A+B",
    route: "1",
    co: ["kmb"],
    bound: { kmb: "O" },
    orig: { en: "A", zh: "甲" },
    dest: { en: "STAR FERRY", zh: "尖沙咀碼頭" },
    fares: null,
    faresHoliday: null,
    freq: null,
    gtfsId: null,
    jt: null,
    nlbId: null,
    seq: 1,
    serviceType: 1,
    stops: {},
    ...overrides,
  };
}

function query(co: Company, r: KeyedRoute, seq = 4, stopId = "STOP"): EtaQuery {
  return { route: r, co, seq, stopId };
}

beforeEach(() => {
  calls = [];
  clearEtaCache();
});

afterEach(() => {
  vi.unstubAllGlobals();
  clearEtaCache();
});

describe("parseHkTime", () => {
  it("treats an offset-less time as Hong Kong time, not local time", () => {
    expect(parseHkTime("2026-08-27 19:20:00")?.toISOString()).toBe("2026-08-27T11:20:00.000Z");
  });

  it("respects an explicit offset when one is given", () => {
    expect(parseHkTime("2026-08-27T19:20:00+08:00")?.toISOString()).toBe(
      "2026-08-27T11:20:00.000Z",
    );
  });

  it("returns null for junk rather than an Invalid Date", () => {
    expect(parseHkTime("")).toBeNull();
    expect(parseHkTime("not a time")).toBeNull();
  });
});

describe("KMB", () => {
  const payload = {
    data: [
      { dir: "O", seq: 4, eta_seq: 1, eta: "2026-08-27T20:00:06+08:00", rmk_tc: "", rmk_en: "" },
      { dir: "O", seq: 4, eta_seq: 2, eta: "2026-08-27T20:19:45+08:00", rmk_tc: "", rmk_en: "" },
      // Wrong direction and wrong stop - both must be filtered out.
      { dir: "I", seq: 4, eta_seq: 1, eta: "2026-08-27T20:05:00+08:00", rmk_tc: "", rmk_en: "" },
      { dir: "O", seq: 9, eta_seq: 1, eta: "2026-08-27T20:07:00+08:00", rmk_tc: "", rmk_en: "" },
      // A null eta means "no bus", not "now".
      { dir: "O", seq: 4, eta_seq: 3, eta: null, rmk_tc: "", rmk_en: "" },
    ],
  };

  it("asks for the whole route once, keyed by service type", async () => {
    stubJson(payload);
    await fetchKmbEta(query("kmb", route()));
    expect(calls[0]?.url).toContain("/route-eta/1/1");
  });

  it("keeps only this stop, in this direction, that actually has a time", async () => {
    stubJson(payload);
    const etas = await fetchKmbEta(query("kmb", route()));
    expect(etas).toHaveLength(2);
    expect(etas[0]?.source).toBe("live");
    expect(etas[0]?.at.toISOString()).toBe("2026-08-27T12:00:06.000Z");
  });

  it("marks KMB's own timetable rows as scheduled, not as a live prediction", async () => {
    stubJson({
      data: [
        { dir: "O", seq: 4, eta_seq: 1, eta: "2026-08-27T20:00:06+08:00", rmk_tc: "原定班次", rmk_en: "Scheduled Bus" },
        { dir: "O", seq: 4, eta_seq: 2, eta: "2026-08-27T20:19:45+08:00", rmk_tc: "", rmk_en: "" },
      ],
    });
    const etas = await fetchKmbEta(query("kmb", route()));
    expect(etas[0]?.source).toBe("scheduled");
    expect(etas[1]?.source).toBe("live");
  });

  it("shares one request between callers asking for the same route", async () => {
    stubJson(payload);
    await Promise.all([
      fetchKmbEta(query("kmb", route(), 4)),
      fetchKmbEta(query("kmb", route(), 5)),
    ]);
    expect(calls).toHaveLength(1);
  });
});

describe("Citybus", () => {
  it("queries by stop and route and filters by direction", async () => {
    stubJson({
      data: [
        { dir: "I", seq: 18, stop: "001027", eta_seq: 1, eta: "2026-08-27T19:12:27+08:00", rmk_tc: "", rmk_en: "" },
        { dir: "O", seq: 18, stop: "001027", eta_seq: 1, eta: "2026-08-27T19:40:00+08:00", rmk_tc: "", rmk_en: "" },
      ],
    });

    const r = route({ co: ["ctb"], bound: { ctb: "I" } });
    const etas = await fetchCtbEta(query("ctb", r, 18, "001027"));

    expect(calls[0]?.url).toContain("/eta/CTB/001027/1");
    expect(etas).toHaveLength(1);
    expect(etas[0]?.at.toISOString()).toBe("2026-08-27T11:12:27.000Z");
  });
});

describe("NLB", () => {
  const r = route({ co: ["nlb"], bound: { nlb: "O" }, nlbId: "1" });

  it("sends text/plain so the request stays free of a CORS preflight", async () => {
    stubJson({ estimatedArrivals: [] });
    await fetchNlbEta(query("nlb", r, 1, "1"));

    const headers = calls[0]?.init?.headers as Record<string, string>;
    expect(calls[0]?.init?.method).toBe("POST");
    expect(headers["Content-Type"]).toBe("text/plain");
    expect(JSON.parse(String(calls[0]?.init?.body))).toMatchObject({ routeId: "1", stopId: "1" });
  });

  it("treats an empty object as 'nothing running', not an error", async () => {
    stubJson({});
    await expect(fetchNlbEta(query("nlb", r, 1, "1"))).resolves.toEqual([]);
  });

  it("drops buses that have already departed", async () => {
    stubJson({
      estimatedArrivals: [
        { estimatedArrivalTime: "2026-08-27 19:30:00", departed: "1" },
        { estimatedArrivalTime: "2026-08-27 19:50:00", departed: "0" },
      ],
    });
    const etas = await fetchNlbEta(query("nlb", r, 1, "1"));
    expect(etas).toHaveLength(1);
    expect(etas[0]?.at.toISOString()).toBe("2026-08-27T11:50:00.000Z");
  });

  it("does nothing without an NLB route id", async () => {
    stubJson({});
    await expect(fetchNlbEta(query("nlb", route({ nlbId: null }), 1, "1"))).resolves.toEqual([]);
    expect(calls).toHaveLength(0);
  });
});

describe("Minibus", () => {
  it("uses the three-segment URL, since the two-segment form always 500s", async () => {
    stubJson({ data: { eta: [] } });
    const r = route({ co: ["gmb"], bound: { gmb: "O" }, gtfsId: "2006408" });
    await fetchGmbEta(query("gmb", r, 2));
    expect(calls[0]?.url).toContain("/eta/route-stop/2006408/1/2");
  });

  it("maps the inbound direction onto route_seq 2", async () => {
    stubJson({ data: { eta: [] } });
    const r = route({ co: ["gmb"], bound: { gmb: "I" }, gtfsId: "2006408" });
    await fetchGmbEta(query("gmb", r, 2));
    expect(calls[0]?.url).toContain("/2006408/2/2");
  });

  it("marks timetable-derived entries as scheduled, not live", async () => {
    stubJson({
      data: {
        eta: [
          { eta_seq: 1, diff: 0, timestamp: "2026-08-27T19:39:29+08:00", remarks_tc: null, remarks_en: null },
          { eta_seq: 2, diff: 5, timestamp: "2026-08-27T19:44:05+08:00", remarks_tc: "未開出", remarks_en: "Scheduled" },
        ],
      },
    });
    const r = route({ co: ["gmb"], bound: { gmb: "O" }, gtfsId: "2006408" });
    const etas = await fetchGmbEta(query("gmb", r, 1));
    expect(etas[0]?.source).toBe("live");
    expect(etas[1]?.source).toBe("scheduled");
  });
});

describe("MTR heavy rail", () => {
  const payload = {
    status: 1,
    data: {
      "AEL-HOK": {
        UP: [{ seq: "1", dest: "AWE", plat: "1", time: "2026-08-27 19:20:00", ttnt: "8", valid: "Y" }],
        DOWN: [{ seq: "1", dest: "HOK", plat: "2", time: "2026-08-27 19:25:00", ttnt: "13", valid: "Y" }],
      },
    },
  };

  it("reads the UP list for an up-track route", async () => {
    stubJson(payload);
    const r = route({ co: ["mtr"], route: "AEL", bound: { mtr: "UT" } });
    const etas = await fetchMtrRailEta(query("mtr", r, 1, "HOK"));
    expect(etas[0]?.at.toISOString()).toBe("2026-08-27T11:20:00.000Z");
  });

  it("reads the DOWN list for a down-track route", async () => {
    stubJson(payload);
    const r = route({ co: ["mtr"], route: "AEL", bound: { mtr: "DT" } });
    const etas = await fetchMtrRailEta(query("mtr", r, 1, "HOK"));
    expect(etas[0]?.at.toISOString()).toBe("2026-08-27T11:25:00.000Z");
  });

  it("ignores trains the feed marks invalid", async () => {
    stubJson({
      status: 1,
      data: { "AEL-HOK": { UP: [{ seq: "1", dest: "AWE", plat: "1", time: "2026-08-27 19:20:00", ttnt: "8", valid: "N" }] } },
    });
    const r = route({ co: ["mtr"], route: "AEL", bound: { mtr: "UT" } });
    await expect(fetchMtrRailEta(query("mtr", r, 1, "HOK"))).resolves.toEqual([]);
  });
});

describe("Light rail", () => {
  const r = route({ co: ["lightRail"], route: "505", dest: { en: "Siu Hong", zh: "兆康" } });

  it("strips the LR prefix from the stop id", async () => {
    stubJson({ platform_list: [] });
    await fetchLightRailEta(query("lightRail", r, 1, "LR920"));
    expect(calls[0]?.url).toContain("station_id=920");
  });

  it("turns platform wording into minutes", async () => {
    stubJson({
      platform_list: [
        {
          platform_id: 1,
          route_list: [
            { route_no: "505", dest_en: "Siu Hong", dest_ch: "兆康", time_en: "Departing", time_ch: "正在離開", train_length: 2 },
            { route_no: "505", dest_en: "Siu Hong", dest_ch: "兆康", time_en: "7 min", time_ch: "7 分鐘", train_length: 2 },
            // A different terminus on the same platform must not be counted.
            { route_no: "505", dest_en: "Tuen Mun Ferry Pier", dest_ch: "屯門碼頭", time_en: "2 min", time_ch: "2 分鐘", train_length: 2 },
          ],
        },
      ],
    });

    const etas = await fetchLightRailEta(query("lightRail", r, 1, "LR920"));
    expect(etas).toHaveLength(2);
    // "Departing" is now, so it sorts first.
    expect(etas[0]!.at.getTime()).toBeLessThan(etas[1]!.at.getTime());
  });
});

describe("MTR feeder bus", () => {
  const r = route({ co: ["lrtfeeder"], route: "506" });

  it("falls back to the departure time when arrival is the not-applicable sentinel", async () => {
    stubJson({
      busStop: [
        {
          busStopId: "K1",
          bus: [
            { arrivalTimeInSecond: "108000", departureTimeInSecond: "83", isScheduled: "1", isDelayed: "0" },
            { arrivalTimeInSecond: "300", departureTimeInSecond: "320", isScheduled: "0", isDelayed: "0" },
          ],
        },
      ],
    });

    const etas = await fetchLrtFeederEta(query("lrtfeeder", r, 1, "K1"));
    expect(etas).toHaveLength(2);
    // 83 s from the terminus sorts before the 300 s arrival.
    expect(etas[0]?.source).toBe("scheduled");
    expect(etas[1]?.source).toBe("live");
  });

  it("returns nothing when the stop is not in the response", async () => {
    stubJson({ busStop: [{ busStopId: "OTHER", bus: [] }] });
    await expect(fetchLrtFeederEta(query("lrtfeeder", r, 1, "K1"))).resolves.toEqual([]);
  });
});
