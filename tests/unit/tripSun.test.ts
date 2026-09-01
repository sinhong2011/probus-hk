import { describe, expect, it } from "vitest";
import { measureLine } from "~/lib/alongLine";
import {
  rideSunPaint,
  scoreRide,
  scoreWait,
  scoreWalk,
  sunOfferReady,
  sunRideStrokes,
  tripSunCopy,
  type SunAt,
} from "~/data/tripSun";
import type { SolarPosition } from "~/lib/solar";

/** A kilometre due east along 22.3°N. */
const WEST: [number, number] = [114.17, 22.3];
const EAST: [number, number] = [114.179, 22.3];
const LINE = measureLine([WEST, EAST]);
const NOON = new Date("2026-03-20T12:00:00+08:00");
const LATER = new Date("2026-03-20T12:20:00+08:00");

function sun(azimuth: number, elevation: number): SunAt {
  return (): SolarPosition => ({ azimuth, elevation });
}

describe("scoreRide", () => {
  it("recommends the left window when the sun is on the right of an eastbound ride", () => {
    const advice = scoreRide({
      line: LINE,
      from: 0,
      to: LINE.length,
      departAt: NOON,
      arriveAt: LATER,
      sunAt: sun(180, 40),
    });
    expect(advice).toMatchObject({ kind: "side", window: "left" });
  });

  it("recommends the right window when the sun is on the left", () => {
    const advice = scoreRide({
      line: LINE,
      from: 0,
      to: LINE.length,
      departAt: NOON,
      arriveAt: LATER,
      sunAt: sun(0, 40),
    });
    expect(advice).toMatchObject({ kind: "side", window: "right" });
  });

  it("stays quiet after dark", () => {
    expect(
      scoreRide({
        line: LINE,
        from: 0,
        to: LINE.length,
        departAt: NOON,
        arriveAt: LATER,
        sunAt: sun(180, -10),
      }).kind,
    ).toBe("night");
  });

  it("does not force a side when the sun is overhead", () => {
    expect(
      scoreRide({
        line: LINE,
        from: 0,
        to: LINE.length,
        departAt: NOON,
        arriveAt: LATER,
        sunAt: sun(180, 82),
      }).kind,
    ).toBe("overhead");
  });

  it("names a flip when the sun's side changes once along the way", () => {
    const sunAt: SunAt = (_date, _lat, lng) => ({
      azimuth: lng < 114.176 ? 180 : 0,
      elevation: 40,
    });
    const advice = scoreRide({
      line: LINE,
      from: 0,
      to: LINE.length,
      departAt: NOON,
      arriveAt: LATER,
      sunAt,
    });
    expect(advice.kind).toBe("side");
    if (advice.kind === "side") {
      expect(advice.window).toBe("left");
      expect(advice.flipAt).toBeGreaterThan(0);
    }
  });
});

describe("scoreWait", () => {
  it("calls a kerb exposed when the sun is across the road", () => {
    // Heading north, sun in the east = right of the bus = road side.
    expect(
      scoreWait({ heading: 0, at: NOON, lat: 22.3, lng: 114.17, sunAt: sun(90, 40) }).kind,
    ).toBe("exposed");
  });

  it("calls a kerb shaded when the sun is on the building side", () => {
    expect(
      scoreWait({ heading: 0, at: NOON, lat: 22.3, lng: 114.17, sunAt: sun(270, 40) }).kind,
    ).toBe("shaded");
  });
});

describe("scoreWalk", () => {
  it("says you walk into the sun when heading west at a western sun", () => {
    const advice = scoreWalk({
      from: { lat: 22.3, lng: 114.17 },
      to: { lat: 22.3, lng: 114.16 },
      at: NOON,
      sunAt: sun(270, 20),
    });
    expect(advice).toMatchObject({ kind: "into", compass: "w" });
  });
});

describe("rideSunPaint", () => {
  it("paints shade on the recommended window and sun on the other", () => {
    const strokes = rideSunPaint({
      line: LINE,
      from: 0,
      to: LINE.length,
      departAt: NOON,
      arriveAt: LATER,
      window: "left",
      sunAt: sun(180, 40),
    });
    expect(strokes.length).toBeGreaterThan(0);
    expect(strokes.every((stroke) => stroke.tone === "shade")).toBe(true);
    expect(strokes[0]!.coordinates.length).toBeGreaterThanOrEqual(2);
  });

  it("stays quiet after dark", () => {
    expect(
      rideSunPaint({
        line: LINE,
        from: 0,
        to: LINE.length,
        departAt: NOON,
        arriveAt: LATER,
        window: "left",
        sunAt: sun(180, -10),
      }),
    ).toEqual([]);
  });
});

describe("sunRideStrokes", () => {
  it("paints one overhead stroke when the sun is high", () => {
    const strokes = sunRideStrokes({
      line: LINE,
      from: 0,
      to: LINE.length,
      departAt: NOON,
      arriveAt: LATER,
      sunAt: sun(180, 82),
    });
    expect(strokes).toHaveLength(1);
    expect(strokes[0]!.tone).toBe("overhead");
  });

  it("omits night and mixed rides", () => {
    expect(
      sunRideStrokes({
        line: LINE,
        from: 0,
        to: LINE.length,
        departAt: NOON,
        arriveAt: LATER,
        sunAt: sun(180, -10),
      }),
    ).toEqual([]);
  });
});

describe("a picked clock, not the wall clock", () => {
  /** Southbound, so an eastern morning sun sits on the left. */
  const NS = measureLine([
    [114.17, 22.31],
    [114.17, 22.3],
  ]);

  it("scores 08:00 as a daytime ride even when the code is read at night", () => {
    const morning = new Date("2026-03-21T08:00:00+08:00");
    const advice = scoreRide({
      line: NS,
      from: 0,
      to: NS.length,
      departAt: morning,
      arriveAt: new Date(morning.getTime() + 20 * 60_000),
    });
    expect(advice.kind).not.toBe("night");
    expect(advice.kind).toBe("side");
  });

  it("stays quiet at a 22:00 clock on the same line", () => {
    const evening = new Date("2026-03-21T22:00:00+08:00");
    expect(
      scoreRide({
        line: NS,
        from: 0,
        to: NS.length,
        departAt: evening,
        arriveAt: new Date(evening.getTime() + 20 * 60_000),
      }).kind,
    ).toBe("night");
  });
});

describe("tripSunCopy", () => {
  it("says the window, not a percentage", () => {
    const copy = tripSunCopy(
      { kind: "side", window: "right", share: 0.8 },
      { kind: "exposed" },
      { kind: "none" },
      "zh",
    );
    expect(copy.chip).toContain("右邊窗");
    expect(copy.chip).not.toMatch(/%|77/);
    expect(copy.wait).toBeTruthy();
  });
});

describe("sunOfferReady", () => {
  const ready = { enabled: false, dismissed: false, elevation: 40, hasRide: true };

  it("offers only when a daytime ride is chosen and the setting is still off", () => {
    expect(sunOfferReady(ready)).toBe(true);
  });

  it("stays quiet once enabled, dismissed, after dark, or with no ride", () => {
    expect(sunOfferReady({ ...ready, enabled: true })).toBe(false);
    expect(sunOfferReady({ ...ready, dismissed: true })).toBe(false);
    expect(sunOfferReady({ ...ready, elevation: 2 })).toBe(false);
    expect(sunOfferReady({ ...ready, hasRide: false })).toBe(false);
  });
});
