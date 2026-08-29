import { describe, expect, it } from "vitest";
import type { Eta } from "~/data/types";
import {
  concessionFare,
  countdown,
  fareAt,
  fareLabel,
  followingMinutes,
  formatFare,
  isLastRun,
} from "~/lib/format";
import { plateStyle } from "~/lib/operators";

const NOW = new Date("2026-03-01T12:00:00Z").getTime();

function eta(minutesFromNow: number, source: Eta["source"] = "live"): Eta {
  return { at: new Date(NOW + minutesFromNow * 60_000), source, co: "kmb" };
}

describe("countdown", () => {
  it("rounds down, so a bus is never shown as later than it is", () => {
    // 3 minutes 50 seconds away is still "3", because you can still catch it.
    const at = new Date(NOW + 3 * 60_000 + 50_000);
    expect(countdown({ at, source: "live", co: "kmb" }, NOW).minutes).toBe(3);
  });

  it("becomes 'arriving' inside the last minute", () => {
    expect(countdown(eta(0.5), NOW).kind).toBe("arriving");
    expect(countdown(eta(0.99), NOW).kind).toBe("arriving");
  });

  it("treats a bus one minute out as a number, not as arriving", () => {
    expect(countdown(eta(1), NOW).kind).toBe("minutes");
  });

  it("marks departures well in the past as gone", () => {
    expect(countdown(eta(-2), NOW).kind).toBe("gone");
  });

  it("keeps a just-missed bus visible briefly rather than flickering out", () => {
    expect(countdown(eta(-0.2), NOW).kind).toBe("arriving");
  });

  it("carries the timetable flag through so the UI can mark it", () => {
    expect(countdown(eta(10, "scheduled"), NOW).scheduled).toBe(true);
    expect(countdown(eta(10, "live"), NOW).scheduled).toBe(false);
  });

  it("carries the operator's remark through, which is how a rider learns this is the last one", () => {
    const last = { ...eta(29), remark: { zh: "最後班次", en: "Last departure" } };
    expect(countdown(last, NOW).remark).toEqual({ zh: "最後班次", en: "Last departure" });
  });

  it("drops a remark the countdown already makes in its own shape", () => {
    // The tilde and the scheduled note say this; a third copy is noise.
    const planned = { ...eta(12, "scheduled"), remark: { zh: "原定班次", en: "Scheduled" } };
    expect(countdown(planned, NOW).remark).toBeUndefined();
  });
});

describe("isLastRun", () => {
  it("recognises the operators' several ways of saying it", () => {
    expect(isLastRun({ zh: "最後班次", en: "Last departure" })).toBe(true);
    expect(isLastRun({ zh: "尾班車", en: "" })).toBe(true);
    expect(isLastRun({ zh: "延誤", en: "Delayed" })).toBe(false);
  });
});

describe("followingMinutes", () => {
  it("lists the arrivals after the first", () => {
    expect(followingMinutes([eta(3), eta(11), eta(24)], NOW)).toBe("11 · 24");
  });

  it("is empty when there is only one arrival", () => {
    expect(followingMinutes([eta(3)], NOW)).toBe("");
  });
});

describe("fares", () => {
  it("formats to one decimal place", () => {
    expect(formatFare("6.7")).toBe("$6.7");
    expect(formatFare("12")).toBe("$12.0");
  });

  it("returns null rather than NaN for missing values", () => {
    expect(formatFare(null)).toBeNull();
    expect(formatFare("")).toBeNull();
    expect(formatFare("abc")).toBeNull();
  });

  it("indexes fares by stop, and has none for the terminus", () => {
    // 25 stops carry 24 fares: the last stop has no onward fare.
    const fares = Array.from({ length: 24 }, (_, i) => String(i + 1));
    expect(fareAt(fares, 1)).toBe("$1.0");
    expect(fareAt(fares, 24)).toBe("$24.0");
    expect(fareAt(fares, 25)).toBeNull();
  });
});

describe("concessionFare", () => {
  it("is a flat $2 up to ten dollars", () => {
    // Values checked against what the operators actually charge.
    expect(concessionFare("5.1")).toBe("$2.0");
    expect(concessionFare("8.6")).toBe("$2.0");
    expect(concessionFare("9.3")).toBe("$2.0");
    expect(concessionFare("10")).toBe("$2.0");
  });

  it("is a fifth of the fare above ten dollars", () => {
    expect(concessionFare("10.8")).toBe("$2.2");
    expect(concessionFare("11.8")).toBe("$2.4");
    expect(concessionFare("15.4")).toBe("$3.1");
    expect(concessionFare("17.9")).toBe("$3.6");
    expect(concessionFare("19.3")).toBe("$3.9");
    expect(concessionFare("21.8")).toBe("$4.4");
  });

  it("has nothing to say about a missing fare", () => {
    expect(concessionFare(null)).toBeNull();
    expect(concessionFare("")).toBeNull();
    expect(concessionFare("free")).toBeNull();
  });
});

describe("fareLabel", () => {
  it("shows the full fare beside the concession", () => {
    expect(fareLabel("9.3")).toBe("$9.3 · $2.0");
    expect(fareLabel("21.8")).toBe("$21.8 · $4.4");
  });

  it("is null when there is no fare at all", () => {
    expect(fareLabel(null)).toBeNull();
  });
});

describe("line colours", () => {
  it("gives every MTR line its own plate", () => {
    const twl = plateStyle(["mtr"], "TWL").background;
    const ktl = plateStyle(["mtr"], "KTL").background;
    const ael = plateStyle(["mtr"], "AEL").background;
    // Riders navigate by line colour; one maroon plate for ten lines threw
    // away the only thing that tells them apart at a glance.
    expect(new Set([twl, ktl, ael]).size).toBe(3);
  });

  it("picks ink that can be read on the line's own colour", () => {
    // South Island is lime and Tsuen Wan is red: the same ink cannot serve both.
    expect(plateStyle(["mtr"], "SIL").color).toBe("#101012");
    expect(plateStyle(["mtr"], "TWL").color).toBe("#ffffff");
    expect(plateStyle(["lightRail"], "615").color).toBe("#101012");
  });

  it("leaves a bus route on its operator's colour", () => {
    expect(plateStyle(["kmb"], "TWL").background).toBe("#d71920");
  });

  it("never leaves a plate below the 3:1 floor for large text", () => {
    const luminance = (hex: string) => {
      const v = Number.parseInt(hex.slice(1), 16);
      const ch = (s: number) => {
        const c = ((v >> s) & 0xff) / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * ch(16) + 0.7152 * ch(8) + 0.0722 * ch(0);
    };
    const contrast = (bg: string, ink: string) => {
      const [a, b] = [luminance(bg) + 0.05, luminance(ink) + 0.05].sort((x, y) => y - x);
      return (a as number) / (b as number);
    };

    // Convention says white on every operator's route number; measurement says
    // white on Tung Chung orange is about 2.2:1. Legibility wins.
    const lines = ["TWL", "KTL", "ISL", "TKL", "TCL", "AEL", "EAL", "TML", "SIL", "DRL"];
    const light = ["505", "507", "610", "614", "614P", "615", "615P", "705", "706", "751", "761P"];
    for (const route of lines) {
      const { background, color } = plateStyle(["mtr"], route);
      expect(contrast(background, color), route).toBeGreaterThanOrEqual(3);
    }
    for (const route of light) {
      const { background, color } = plateStyle(["lightRail"], route);
      expect(contrast(background, color), route).toBeGreaterThanOrEqual(3);
    }
  });
});
