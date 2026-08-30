// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { flush } from "solid-js";

/**
 * Every store on TanStack DB, through the one helper. Each test starts from
 * a known localStorage and re-imports the store so its collection is built
 * fresh. A change is applied at once and published a beat later, and a
 * signal written outside a computation is staged until Solid flushes, so
 * the tests flush after start-up and settle after a change.
 */
const memory = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => memory.get(k) ?? null,
  setItem: (k: string, v: string) => void memory.set(k, v),
  removeItem: (k: string) => void memory.delete(k),
  clear: () => memory.clear(),
  key: () => null,
  length: 0,
});
const settled = () => new Promise((resolve) => setTimeout(resolve, 0));
beforeEach(() => {
  memory.clear();
  vi.resetModules();
});

describe("settings", () => {
  it("adopts an older build's object, fills in what it lacks, and writes one row", async () => {
    memory.set("motherbus:settings", JSON.stringify({ lang: "en", radiusM: 800 }));
    const { settings, installSettingsEffects } = await import("~/stores/settings");
    installSettingsEffects();
    flush();
    expect(settings.lang()).toBe("en");
    expect(settings.radiusM()).toBe(800);
    // Never stored: the default.
    expect(settings.refreshSeconds()).toBe(20);

    settings.setLang("zh");
    await settled();
    expect(settings.lang()).toBe("zh");
    expect(settings.radiusM()).toBe(800);
    expect(memory.get("probus:db:settings")).toContain('"lang":"zh"');
  });

  it("starts from defaults on a new install and keeps the first write", async () => {
    const { settings, installSettingsEffects } = await import("~/stores/settings");
    installSettingsEffects();
    flush();
    expect(settings.theme()).toBe("auto");
    settings.setTheme("dark");
    await settled();
    expect(settings.theme()).toBe("dark");
  });
});

describe("alerts", () => {
  it("arms, replaces, and clears", async () => {
    const { alerts, installAlertEffects } = await import("~/stores/alerts");
    installAlertEffects();
    flush();
    const base = {
      routeKey: "1",
      co: "kmb" as const,
      stopId: "A",
      seq: 1,
      leadMinutes: 3,
      radiusM: 300,
    };
    alerts.arm({ ...base, kind: "arrival" });
    alerts.arm({ ...base, kind: "arrival", leadMinutes: 5 });
    await settled();
    expect(alerts.items()).toHaveLength(1);
    expect(alerts.find("arrival", "1", "A")?.leadMinutes).toBe(5);
    alerts.clear();
    await settled();
    expect(alerts.items()).toHaveLength(0);
  });
});

describe("frequent", () => {
  it("counts visits, ranks habits above one-offs, and forgets on request", async () => {
    const { frequent, installFrequentEffects } = await import("~/stores/frequent");
    installFrequentEffects();
    flush();
    frequent.record("2");
    frequent.record("1");
    frequent.record("1");
    await settled();
    expect(frequent.top()).toEqual(["1"]);
    expect(frequent.recent()[0]).toBe("1");
    frequent.forget("1");
    await settled();
    expect(frequent.top()).toEqual(["2"]);
  });
});

describe("trips", () => {
  it("toggles a trip by its ends", async () => {
    const { trips, installTripEffects } = await import("~/stores/trips");
    installTripEffects();
    flush();
    const from = { kind: "me" as const };
    const to = { kind: "stop" as const, id: "A" };
    trips.toggle(from, to, "Me → A");
    await settled();
    expect(trips.has(from, to)).toBe(true);
    trips.toggle(from, to, "Me → A");
    await settled();
    expect(trips.items()).toHaveLength(0);
  });
});

describe("dismissed", () => {
  it("carries an older build's list of ids across", async () => {
    memory.set("probus:dismissed", JSON.stringify(["welcome", 3]));
    const { dismissed, installDismissedEffects } = await import("~/stores/dismissed");
    installDismissedEffects();
    flush();
    expect(dismissed.has("welcome")).toBe(true);
    dismissed.dismiss("beta");
    await settled();
    expect(dismissed.has("beta")).toBe(true);
    expect(memory.has("probus:dismissed")).toBe(true);
  });
});
