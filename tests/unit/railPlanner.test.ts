import { describe, expect, it } from "vitest";
import { planRail } from "~/data/railPlanner";

describe("planRail", () => {
  it("rides one line end to end without changing", () => {
    const [best] = planRail("CEN", "TSW");
    expect(best?.legs).toHaveLength(1);
    expect(best?.legs[0]?.line).toBe("TWL");
    expect(best?.legs[0]?.towards).toBe("TSW");
    expect(best?.legs[0]?.stations).toBe(15);
    // Running time alone, as the MTR states it.
    expect(best?.totalMinutes).toBe(32);
    // And nothing else: every other way there is a detour.
    expect(planRail("CEN", "TSW")).toHaveLength(1);
  });

  it("names the terminus the train is signed for, either way", () => {
    const [back] = planRail("TSW", "CEN");
    expect(back?.legs[0]?.towards).toBe("CEN");
  });

  it("changes once where one change is the answer", () => {
    // Kowloon to Yau Ma Tei: Tung Chung Line to Lai King, Tsuen Wan Line in.
    const journeys = planRail("KOW", "YMT");
    expect(journeys.length).toBeGreaterThan(0);
    const viaLaiKing = journeys.find((j) => j.legs.length === 2 && j.changes[0]?.at === "LAK");
    expect(viaLaiKing).toBeDefined();
    expect(viaLaiKing?.legs[0]?.line).toBe("TCL");
    expect(viaLaiKing?.legs[1]?.line).toBe("TWL");
    expect(viaLaiKing?.changes[0]?.minutes).toBe(1);
  });

  it("puts the quickest journey first and never more than two changes", () => {
    for (const [from, to] of [
      ["KOW", "YMT"],
      ["SOH", "LHP"],
      ["TUM", "CHW"],
    ]) {
      const journeys = planRail(from as string, to as string);
      expect(journeys.length).toBeGreaterThan(0);
      for (let i = 1; i < journeys.length; i += 1) {
        expect(journeys[i]!.totalMinutes).toBeGreaterThanOrEqual(journeys[i - 1]!.totalMinutes);
      }
      for (const j of journeys) expect(j.legs.length).toBeLessThanOrEqual(3);
    }
  });

  it("suggests the walk the MTR suggests for Kowloon to Yau Ma Tei", () => {
    // Tung Chung Line to Hong Kong, the corridor to Central, Tsuen Wan Line
    // out: what the MTR's planner offers, at the time it prints for it.
    const [best] = planRail("KOW", "YMT");
    expect(best?.legs.map((l) => l.line)).toEqual(["TCL", "TWL"]);
    expect(best?.changes[0]).toEqual({ at: "HOK", to: "CEN", minutes: 10 });
    expect(best?.totalMinutes).toBe(23);
  });

  it("never rides a line it has already left, nor changes for nothing", () => {
    for (const [from, to] of [
      ["CEN", "TSW"],
      ["KOW", "YMT"],
      ["TUM", "CHW"],
      ["SOH", "LHP"],
    ]) {
      for (const j of planRail(from as string, to as string)) {
        const lines = j.legs.map((l) => l.line);
        expect(new Set(lines).size, j.id).toBe(lines.length);
      }
    }
  });

  it("keeps the Airport Express for the airport", () => {
    expect(planRail("KOW", "HOK")[0]?.legs[0]?.line).toBe("TCL");
    expect(planRail("KOW", "AIR")[0]?.legs[0]?.line).toBe("AEL");
  });

  it("can walk between stations that share a corridor", () => {
    // Hong Kong to Central is a walk, and a planner that insists on a train
    // for it sends someone to Kowloon and back.
    const journeys = planRail("HOK", "ADM");
    const walked = journeys.find((j) => j.changes.some((c) => c.at !== c.to));
    expect(walked).toBeDefined();
  });

  it("counts the walking part of a change on its own", () => {
    const [best] = planRail("KOT", "HUH");
    // Kowloon Tong to Hung Hom is one East Rail train, no walking.
    expect(best?.legs).toHaveLength(1);
    expect(best?.changeMinutes).toBe(0);
  });

  it("answers nothing for a station to itself or one it does not know", () => {
    expect(planRail("CEN", "CEN")).toEqual([]);
    expect(planRail("CEN", "XXX")).toEqual([]);
  });

  it("is fast enough to run on every keystroke", () => {
    const start = performance.now();
    for (const [from, to] of [
      ["TUM", "CHW"],
      ["LOW", "SOH"],
      ["AWE", "POA"],
      ["KET", "WKS"],
    ]) {
      planRail(from as string, to as string);
    }
    expect(performance.now() - start).toBeLessThan(400);
  });
});
