import { describe, expect, it } from "vitest";
import { boundingBox, distanceM, formatDistance, walkMinutes } from "~/lib/geo";

const NATHAN_ROAD = { lat: 22.31073, lng: 114.17099 };
const STAR_FERRY = { lat: 22.2943, lng: 114.16911 };

describe("distanceM", () => {
  it("is zero for the same point", () => {
    expect(distanceM(NATHAN_ROAD, NATHAN_ROAD)).toBe(0);
  });

  it("matches the real distance down Nathan Road to the Star Ferry", () => {
    // Roughly 1.8 km as the crow flies.
    const d = distanceM(NATHAN_ROAD, STAR_FERRY);
    expect(d).toBeGreaterThan(1700);
    expect(d).toBeLessThan(1900);
  });

  it("is symmetric", () => {
    expect(distanceM(NATHAN_ROAD, STAR_FERRY)).toBeCloseTo(distanceM(STAR_FERRY, NATHAN_ROAD), 6);
  });
});

describe("boundingBox", () => {
  it("contains every point within the radius", () => {
    const box = boundingBox(NATHAN_ROAD, 500);
    // A point 400 m due north must fall inside the box.
    const north = { lat: NATHAN_ROAD.lat + 400 / 111_320, lng: NATHAN_ROAD.lng };
    expect(north.lat).toBeLessThanOrEqual(box.maxLat);
    expect(north.lat).toBeGreaterThanOrEqual(box.minLat);
  });

  it("widens longitude to account for latitude", () => {
    const box = boundingBox(NATHAN_ROAD, 500);
    const latSpan = box.maxLat - box.minLat;
    const lngSpan = box.maxLng - box.minLng;
    // At 22 degrees north a degree of longitude is shorter, so the span is wider.
    expect(lngSpan).toBeGreaterThan(latSpan);
  });
});

describe("walkMinutes", () => {
  it("never claims a stop is zero minutes away", () => {
    expect(walkMinutes(5)).toBe(1);
  });

  it("scales at roughly 80 m per minute", () => {
    expect(walkMinutes(400)).toBe(5);
  });
});

describe("formatDistance", () => {
  it("uses metres up to a kilometre", () => {
    expect(formatDistance(80)).toBe("80 m");
    expect(formatDistance(999)).toBe("999 m");
  });

  it("switches to kilometres beyond that", () => {
    expect(formatDistance(1500)).toBe("1.5 km");
  });
});
