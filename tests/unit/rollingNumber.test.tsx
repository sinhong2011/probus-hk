// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot, createSignal, flush } from "solid-js";
import { render } from "@solidjs/web";
import { RollingNumber } from "~/components/RollingNumber";

function mountRoll() {
  document.documentElement.style.setProperty("--duration-roll", "0ms");
  document.documentElement.style.setProperty("--ease-out", "linear");
  window.matchMedia = vi.fn().mockReturnValue({ matches: false }) as typeof window.matchMedia;
  Element.prototype.animate = vi.fn().mockReturnValue({ cancel: vi.fn() });
}

function visibleDigits(host: HTMLElement): string {
  return Array.from(
    host.querySelectorAll('[aria-hidden="true"] span.relative > span.absolute:not(.opacity-0)'),
  )
    .map((el) => el.textContent)
    .join("");
}

describe("RollingNumber", () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    mountRoll();
    host = document.createElement("div");
    document.body.appendChild(host);
  });

  afterEach(() => {
    host.remove();
  });

  it("follows value updates", () => {
    createRoot((dispose) => {
      const [value, setValue] = createSignal(5, { ownedWrite: true });
      render(() => <RollingNumber value={value()} />, host);

      setValue(8);
      flush();
      expect(host.querySelector(".sr-only")?.textContent).toBe("8");

      dispose();
    });
  });

  it("snaps when the digit count changes so a correction does not paint 010", () => {
    createRoot((dispose) => {
      const [value, setValue] = createSignal(0, { ownedWrite: true });
      render(() => <RollingNumber value={value()} />, host);

      setValue(10);
      flush();
      expect(host.querySelector(".sr-only")?.textContent).toBe("10");
      expect(visibleDigits(host)).toBe("10");

      setValue(11);
      flush();
      expect(visibleDigits(host)).toBe("11");

      dispose();
    });
  });

  it("clears leaving digits when a roll is cancelled mid-flight", () => {
    createRoot((dispose) => {
      const [value, setValue] = createSignal(12, { ownedWrite: true });
      render(() => <RollingNumber value={value()} />, host);

      setValue(11);
      flush();
      setValue(12);
      flush();
      expect(visibleDigits(host)).toBe("12");

      dispose();
    });
  });
});
