// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { flush } from "solid-js";
import { Loading, render } from "@solidjs/web";

vi.mock("~/data/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/data/db")>();
  const stub = { holidays: [], routeList: {}, stopList: {}, stopMap: {}, serviceDayMap: {} };
  return {
    ...actual,
    loadRouteDb: () => Promise.resolve({ db: stub, etag: "a", fetchedAt: 1000 }),
  };
});

import { DbProvider, useDbMeta } from "~/data/context";
import { DB_UPDATED_EVENT, type CachedDb } from "~/data/db";

function Probe() {
  const meta = useDbMeta();
  return <span data-fetched={String(meta().fetchedAt)} />;
}

describe("DbProvider", () => {
  let host: HTMLDivElement;

  afterEach(() => {
    host?.remove();
  });

  it("adopts a newer copy without remounting through the splash", async () => {
    host = document.createElement("div");
    document.body.appendChild(host);

    const dispose = render(
      () => (
        <DbProvider>
          <Loading fallback={<span data-loading />}>
            <Probe />
          </Loading>
        </DbProvider>
      ),
      host,
    );

    await vi.waitFor(() => {
      expect(host.querySelector("[data-fetched]")?.getAttribute("data-fetched")).toBe("1000");
    });

    const next: CachedDb = {
      db: { holidays: [], routeList: {}, stopList: {}, stopMap: {}, serviceDayMap: {} },
      etag: "b",
      fetchedAt: 2000,
    };
    window.dispatchEvent(new CustomEvent(DB_UPDATED_EVENT, { detail: next }));
    flush();

    expect(host.querySelector("[data-fetched]")?.getAttribute("data-fetched")).toBe("2000");
    expect(host.querySelector("[data-loading]")).toBeNull();
    dispose();
  });
});
