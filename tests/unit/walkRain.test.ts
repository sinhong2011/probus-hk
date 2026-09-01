import { describe, expect, it } from "vitest";
import {
  districtOf,
  hkIsWet,
  parseRhrread,
  parseWarnsum,
  radarTileUrls,
  rainOfferReady,
  rainfallAt,
  walkRainCopy,
} from "~/data/walkRain";

const SAMPLE_RHR = {
  rainfall: {
    data: [
      { unit: "mm", place: "中西區", max: 10, min: 0 },
      { unit: "mm", place: "北區", max: 0 },
    ],
  },
};

describe("districtOf", () => {
  it("maps Central to 中西區", () => {
    expect(districtOf({ lat: 22.281, lng: 114.158 }).zh).toBe("中西區");
  });

  it("maps Fanling to 北區", () => {
    expect(districtOf({ lat: 22.493, lng: 114.138 }).zh).toBe("北區");
  });
});

describe("parse weather", () => {
  it("reads district maxima from rhrread", () => {
    const rows = parseRhrread(SAMPLE_RHR);
    expect(rows).toEqual([
      { place: "中西區", maxMm: 10 },
      { place: "北區", maxMm: 0 },
    ]);
  });

  it("treats a rainstorm code as rain, not a tropical cyclone", () => {
    expect(parseWarnsum({ WTS: { code: "WTS" } })).toBe("thunder");
    expect(parseWarnsum({ WRAINR: { code: "WRAINR" } })).toBe("rainstorm");
    expect(parseWarnsum({ WTCSGNL: { code: "TC1" } })).toBe("none");
  });
});

describe("rainfallAt", () => {
  const weather = {
    rainfall: parseRhrread(SAMPLE_RHR),
    warning: "none" as const,
  };

  it("uses the district the point sits in", () => {
    expect(rainfallAt(weather, { lat: 22.281, lng: 114.158 })).toBe(10);
    expect(rainfallAt(weather, { lat: 22.493, lng: 114.138 })).toBe(0);
  });
});

describe("hkIsWet", () => {
  it("is wet when any district recorded rain, or a warning is up", () => {
    expect(hkIsWet({ rainfall: parseRhrread(SAMPLE_RHR), warning: "none" })).toBe(true);
    expect(hkIsWet({ rainfall: [{ place: "北區", maxMm: 0 }], warning: "thunder" })).toBe(true);
    expect(hkIsWet({ rainfall: [{ place: "北區", maxMm: 0 }], warning: "none" })).toBe(false);
  });
});

describe("walkRainCopy", () => {
  it("prefers local rain over a warning", () => {
    expect(walkRainCopy({ mm: 4, warning: "thunder", lang: "zh" })).toBe("落緊雨 · 行去會濕");
  });

  it("names the warning when the district is dry", () => {
    expect(walkRainCopy({ mm: 0, warning: "thunder", lang: "zh" })).toBe("雷暴警告 · 行去會濕");
    expect(walkRainCopy({ mm: 0, warning: "none", lang: "zh" })).toBeNull();
  });
});

describe("rainOfferReady", () => {
  const ready = { enabled: false, dismissed: false, hasWalk: true, wet: true };
  it("offers once, only on a wet walk, while the setting is off", () => {
    expect(rainOfferReady(ready)).toBe(true);
    expect(rainOfferReady({ ...ready, enabled: true })).toBe(false);
    expect(rainOfferReady({ ...ready, dismissed: true })).toBe(false);
    expect(rainOfferReady({ ...ready, hasWalk: false })).toBe(false);
    expect(rainOfferReady({ ...ready, wet: false })).toBe(false);
  });
});

describe("radarTileUrls", () => {
  it("builds a MapLibre template from the latest past frame", () => {
    const urls = radarTileUrls({
      host: "https://tilecache.rainviewer.com",
      radar: { past: [{ path: "/v2/radar/abc" }] },
    });
    expect(urls).toEqual(["https://tilecache.rainviewer.com/v2/radar/abc/256/{z}/{x}/{y}/2/1_1.png"]);
  });
});
