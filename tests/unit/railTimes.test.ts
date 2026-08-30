import { describe, expect, it } from "vitest";
import {
  RAIL_LINES,
  interchangeMinutes,
  lineOf,
  railStations,
  rideMinutes,
  segmentMinutes,
  servicesAt,
  walkMinutes,
} from "~/data/railTimes";

/**
 * End-to-end times as the MTR's own journey planner states them, which is
 * what a rider checks the app against. A minute or two either way is the
 * difference between one dwell time and another; five is a wrong segment.
 */
const PUBLISHED: [string, string, string, number][] = [
  ["TWL", "CEN", "TSW", 32],
  ["KTL", "WHA", "TIK", 35],
  ["ISL", "KET", "CHW", 36],
  ["TKL", "NOP", "POA", 21],
  ["TKL-LHP", "NOP", "LHP", 19],
  ["TCL", "HOK", "TUC", 28],
  ["AEL", "HOK", "AIR", 24],
  ["AEL", "HOK", "AWE", 27],
  ["SIL", "ADM", "SOH", 11],
  ["EAL", "HUH", "LOW", 40],
  ["EAL", "ADM", "LOW", 46],
  ["EAL-LMC", "ADM", "LMC", 48],
  ["TML", "TUM", "WKS", 74],
  ["DRL", "SUN", "DIS", 4],
];

describe("railTimes", () => {
  it("has a running time for every gap on every service", () => {
    for (const service in RAIL_LINES) {
      const stations = RAIL_LINES[service] as string[];
      for (let i = 0; i + 1 < stations.length; i += 1) {
        const gap = segmentMinutes(stations[i] as string, stations[i + 1] as string);
        expect(gap, `${service} ${stations[i]}>${stations[i + 1]}`).toBeGreaterThanOrEqual(1);
        expect(gap, `${service} ${stations[i]}>${stations[i + 1]}`).toBeLessThanOrEqual(15);
      }
    }
  });

  it("reads the same either way round", () => {
    expect(segmentMinutes("CEN", "ADM")).toBe(segmentMinutes("ADM", "CEN"));
    expect(rideMinutes("TWL", "CEN", "TSW")).toBe(rideMinutes("TWL", "TSW", "CEN"));
  });

  it("adds up to the times the MTR publishes", () => {
    for (const [service, from, to, minutes] of PUBLISHED) {
      const ours = rideMinutes(service, from, to);
      expect(ours, `${service} ${from}>${to}`).toBeDefined();
      expect(
        Math.abs((ours as number) - minutes),
        `${service} ${from}>${to}: ${ours} vs ${minutes}`,
      ).toBeLessThanOrEqual(2);
    }
  });

  it("agrees with itself where two services share track", () => {
    // A LOHAS Park train and a Po Lam train cover the same ground to Tseung
    // Kwan O; a Lok Ma Chau train and a Lo Wu train the same ground to Sheung
    // Shui. The shared stretch must cost the same on both.
    expect(rideMinutes("TKL", "NOP", "TKO")).toBe(rideMinutes("TKL-LHP", "NOP", "TKO"));
    expect(rideMinutes("EAL", "ADM", "SHS")).toBe(rideMinutes("EAL-LMC", "ADM", "SHS"));
  });

  it("knows what a change costs, and that a platform is cheaper than a concourse", () => {
    expect(interchangeMinutes("ADM", "TWL", "ISL")).toBe(1);
    expect(interchangeMinutes("ADM", "TWL", "EAL")).toBe(4);
    expect(interchangeMinutes("KOT", "KTL", "EAL")).toBe(4);
    // A station one of the lines does not call at is not an interchange.
    expect(interchangeMinutes("TST", "TWL", "ISL")).toBeUndefined();
    // A branch train for a main-line one is a step across the platform.
    expect(interchangeMinutes("TKO", "TKL", "TKL-LHP")).toBe(1);
  });

  it("names every interchange in the table as a station two lines share", () => {
    // Every station that appears on two lines can be changed at, and every
    // change the table prices is at such a station. Walking links are the
    // exception, and they are listed as walks.
    const shared = railStations().filter((code) => new Set(servicesAt(code).map(lineOf)).size > 1);
    for (const code of shared) {
      const [a, b] = servicesAt(code);
      expect(interchangeMinutes(code, a as string, b as string), code).toBeGreaterThanOrEqual(1);
    }
    expect(shared).toContain("ADM");
    expect(shared).toContain("NAC");
    expect(shared).not.toContain("TST");
  });

  it("walks between stations that share a corridor but not a name", () => {
    expect(walkMinutes("CEN", "HOK")).toBe(10);
    expect(walkMinutes("HOK", "CEN")).toBe(10);
    expect(walkMinutes("CEN", "ADM")).toBeUndefined();
  });
});
