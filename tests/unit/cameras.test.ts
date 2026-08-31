import { describe, expect, it } from "vitest";
import { CAMERA_RANGE_M, cameraImage, nearestOf, type Camera } from "~/data/cameras";

/**
 * The one promise the camera button makes is that the picture behind it shows
 * the rider's own road: a camera offered from two streets over would answer a
 * question nobody asked. That promise is `nearestOf` - closest wins, and past
 * the range nothing is offered at all.
 */

const cam = (key: string, lat: number, lng: number): Camera => ({
  key,
  location: { lat, lng },
  name: { en: key, zh: key },
});

// Mong Kok, roughly: a real latitude, so the degree-to-metre maths is honest.
const HERE = { lat: 22.3193, lng: 114.1694 };

/** About `metres` north of HERE: one degree of latitude is ~111 km. */
const north = (metres: number) => HERE.lat + metres / 111_000;

describe("nearestOf", () => {
  it("picks the closest of several in range", () => {
    const near = nearestOf(
      [cam("far", north(300), HERE.lng), cam("close", north(80), HERE.lng)],
      HERE,
    );
    expect(near?.camera.key).toBe("close");
    expect(near?.metres).toBeGreaterThan(60);
    expect(near?.metres).toBeLessThan(100);
  });

  it("offers nothing when every camera is past the range", () => {
    const past = cam("past", north(CAMERA_RANGE_M * 2), HERE.lng);
    expect(nearestOf([past], HERE)).toBeNull();
  });

  it("keeps the promise at the boundary in both directions", () => {
    expect(nearestOf([cam("in", north(CAMERA_RANGE_M - 10), HERE.lng)], HERE)).not.toBeNull();
    expect(nearestOf([cam("out", north(CAMERA_RANGE_M + 30), HERE.lng)], HERE)).toBeNull();
  });

  it("survives an empty index", () => {
    expect(nearestOf([], HERE)).toBeNull();
  });
});

describe("cameraImage", () => {
  it("addresses the department's CDN and carries the tick past the cache", () => {
    expect(cameraImage("H429F", 1234)).toBe("https://tdcctv.data.one.gov.hk/H429F.JPG?t=1234");
  });
});
