import { describe, expect, it } from "vitest";
import { appleMapsLink, geoInfoMapLink, googleMapsLink, mapLink } from "~/lib/externalLinks";

const point = { lat: 22.335123456, lng: 114.201987654 };

describe("external map links", () => {
  it("opens Google Maps at the camera", () => {
    expect(googleMapsLink(point)).toBe(
      "https://www.google.com/maps/search/?api=1&query=22.335123%2C114.201988",
    );
  });

  it("opens Apple Maps at the camera", () => {
    expect(appleMapsLink(point)).toBe(
      "https://maps.apple.com/?ll=22.335123%2C114.201988&q=22.335123%2C114.201988",
    );
  });

  it("opens GeoInfo Map in the reader's language", () => {
    expect(geoInfoMapLink(point, "zh")).toBe(
      "https://www.map.gov.hk/gm/?lg=tc&lat=22.335123&lon=114.201988&zoom=18",
    );
    expect(geoInfoMapLink(point, "en")).toBe(
      "https://www.map.gov.hk/gm/?lg=en&lat=22.335123&lon=114.201988&zoom=18",
    );
  });

  it("routes through mapLink", () => {
    expect(mapLink("google", point, "en")).toBe(googleMapsLink(point));
    expect(mapLink("apple", point, "en")).toBe(appleMapsLink(point));
    expect(mapLink("geo", point, "zh")).toBe(geoInfoMapLink(point, "zh"));
  });
});
