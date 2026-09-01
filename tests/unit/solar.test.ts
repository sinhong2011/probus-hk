import { describe, expect, it } from "vitest";
import { compassOf, solarPosition, sunBucket } from "~/lib/solar";

/** Central, close enough for every test here. */
const HK = { lat: 22.28, lng: 114.16 };

describe("solarPosition", () => {
  it("puts the winter-solstice noon sun in the south, about 44° up", () => {
    // 12:30 Hong Kong time, 21 December 2026.
    const sun = solarPosition(new Date("2026-12-21T12:30:00+08:00"), HK.lat, HK.lng);
    expect(sun.azimuth).toBeGreaterThan(160);
    expect(sun.azimuth).toBeLessThan(200);
    expect(sun.elevation).toBeGreaterThan(40);
    expect(sun.elevation).toBeLessThan(50);
  });

  it("puts the summer-solstice noon sun nearly overhead", () => {
    const sun = solarPosition(new Date("2026-06-21T12:30:00+08:00"), HK.lat, HK.lng);
    expect(sun.elevation).toBeGreaterThan(85);
  });

  it("puts the equinox morning sun in the east, low", () => {
    const sun = solarPosition(new Date("2026-03-20T07:00:00+08:00"), HK.lat, HK.lng);
    expect(sun.azimuth).toBeGreaterThan(70);
    expect(sun.azimuth).toBeLessThan(110);
    expect(sun.elevation).toBeGreaterThan(0);
    expect(sun.elevation).toBeLessThan(25);
  });

  it("puts the equinox evening sun in the west", () => {
    const sun = solarPosition(new Date("2026-03-20T18:00:00+08:00"), HK.lat, HK.lng);
    expect(sun.azimuth).toBeGreaterThan(250);
    expect(sun.azimuth).toBeLessThan(290);
    expect(sun.elevation).toBeGreaterThan(-5);
  });

  it("is down in the small hours", () => {
    const sun = solarPosition(new Date("2026-06-21T02:00:00+08:00"), HK.lat, HK.lng);
    expect(sun.elevation).toBeLessThan(-10);
  });
});

describe("sunBucket", () => {
  it("calls a sun on the right of an eastbound heading the right window", () => {
    expect(sunBucket(180, 40, 90)).toBe("right");
  });

  it("calls a sun on the left of an eastbound heading the left window", () => {
    expect(sunBucket(0, 40, 90)).toBe("left");
  });

  it("does not pick a window when the sun is overhead or down", () => {
    expect(sunBucket(180, 80, 90)).toBe("overhead");
    expect(sunBucket(180, -5, 90)).toBe("night");
  });
});

describe("compassOf", () => {
  it("folds a bearing into the four words a rider uses", () => {
    expect(compassOf(10)).toBe("n");
    expect(compassOf(90)).toBe("e");
    expect(compassOf(200)).toBe("s");
    expect(compassOf(280)).toBe("w");
  });
});
