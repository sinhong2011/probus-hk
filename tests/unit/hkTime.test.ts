import { describe, expect, it } from "vitest";
import { hkDateKey, hkInstant, hkNow, parseHhmm } from "~/lib/hkTime";

describe("parseHhmm", () => {
  it("reads a normal timetable time", () => {
    expect(parseHhmm("0535")).toBe(5 * 60 + 35);
    expect(parseHhmm("2340")).toBe(23 * 60 + 40);
  });

  it("accepts hours past midnight, which timetables really use", () => {
    // "2620" means 02:20 the following day.
    expect(parseHhmm("2620")).toBe(26 * 60 + 20);
  });

  it("rejects malformed input rather than guessing", () => {
    expect(parseHhmm("535")).toBeNull();
    expect(parseHhmm("05:35")).toBeNull();
    expect(parseHhmm("0575")).toBeNull();
  });
});

describe("hkNow", () => {
  it("reports Hong Kong wall-clock regardless of the host clock", () => {
    // 2026-03-01T00:30:00Z is 08:30 on 1 March in Hong Kong.
    const parts = hkNow(new Date("2026-03-01T00:30:00Z"));
    expect(parts.year).toBe(2026);
    expect(parts.month).toBe(3);
    expect(parts.day).toBe(1);
    expect(parts.minutesSinceMidnight).toBe(8 * 60 + 30);
  });

  it("rolls the date forward for late-evening UTC", () => {
    // 2026-03-01T17:00:00Z is 01:00 on 2 March in Hong Kong.
    const parts = hkNow(new Date("2026-03-01T17:00:00Z"));
    expect(parts.day).toBe(2);
    expect(parts.minutesSinceMidnight).toBe(60);
  });
});

describe("hkDateKey", () => {
  it("formats the key the holiday list uses", () => {
    expect(hkDateKey(hkNow(new Date("2026-01-01T04:00:00Z")))).toBe("20260101");
  });
});

describe("hkInstant", () => {
  it("turns a Hong Kong wall-clock time into the right instant", () => {
    const parts = hkNow(new Date("2026-03-01T00:30:00Z"));
    // 09:00 Hong Kong on 1 March is 01:00 UTC.
    expect(hkInstant(parts, 9 * 60).toISOString()).toBe("2026-03-01T01:00:00.000Z");
  });

  it("carries past-midnight minutes into the next day", () => {
    const parts = hkNow(new Date("2026-03-01T00:30:00Z"));
    // 26:20 on 1 March is 02:20 on 2 March Hong Kong = 18:20 UTC on 1 March.
    expect(hkInstant(parts, 26 * 60 + 20).toISOString()).toBe("2026-03-01T18:20:00.000Z");
  });
});
