// @vitest-environment jsdom
// happy-dom's DOMParser does not implement text/xml; jsdom does.
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchNotices, routesMentioned } from "~/data/notices";

/** Shaped exactly like the Transport Department's feed, Kangxi quirks and all. */
function feed(messages: string): string {
  return `<?xml version='1.0' encoding='utf-8'?>
<body xmlns='http://data.one.gov.hk/td'>${messages}</body>`;
}

const KANGXI = `
<message>
  <msgID>258337</msgID>
  <CurrentStatus>2</CurrentStatus>
  <ChinText>以下渡輪服務於2026年8⽉28⽇作出臨時調整：
珀麗灣客運有限公司
-⾺灣⾄中環：改由巴⼠服務(路線NR338S)代替營運</ChinText>
  <EngText>The following ferry services are temporarily adjusted:
Park Island Transport Company Limited
- Replaced by bus services (Route NR338S)</EngText>
</message>`;

const ONE_LINER = `
<message>
  <msgID>258400</msgID>
  <CurrentStatus>3</CurrentStatus>
  <ChinText>因交通意外，龍翔道近廣播道的行車線現已解封。</ChinText>
  <EngText>Lung Cheung Road near Broadcast Drive has reopened.</EngText>
</message>`;

function stub(xml: string, ok = true) {
  vi.stubGlobal("fetch", () =>
    Promise.resolve(new Response(xml, { status: ok ? 200 : 503 })),
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("fetchNotices", () => {
  it("reads both languages out of the feed", async () => {
    stub(feed(KANGXI));
    const [notice] = await fetchNotices();

    expect(notice?.id).toBe("258337");
    expect(notice?.text.zh).toContain("珀麗灣客運有限公司");
    expect(notice?.text.en).toContain("Park Island Transport");
  });

  it("normalises Kangxi radicals to ordinary characters", async () => {
    stub(feed(KANGXI));
    const [notice] = await fetchNotices();

    // The feed writes 8⽉ (U+2F49) and ⾺灣 and 巴⼠; all must come out normal.
    expect(notice?.text.zh).toContain("8月28日");
    expect(notice?.text.zh).toContain("馬灣");
    expect(notice?.text.zh).toContain("巴士");
    expect(notice?.text.zh).not.toContain("⽉");
  });

  it("leaves Chinese punctuation alone", async () => {
    stub(feed(KANGXI));
    const [notice] = await fetchNotices();

    // Full-width punctuation is correct typography here, not a defect to fix.
    expect(notice?.text.zh).toContain("：");
    expect(notice?.text.zh).not.toContain("調整:");
  });

  it("splits a heading from the rest so nothing is printed twice", async () => {
    stub(feed(KANGXI));
    const [notice] = await fetchNotices();

    expect(notice?.heading.zh).toBe("以下渡輪服務於2026年8月28日作出臨時調整：");
    expect(notice?.detail.zh).toContain("珀麗灣客運有限公司");
    expect(notice?.detail.zh).not.toContain("以下渡輪服務");
  });

  it("leaves a one-line notice with no detail to repeat", async () => {
    stub(feed(ONE_LINER));
    const [notice] = await fetchNotices();

    expect(notice?.heading.zh).toContain("龍翔道");
    expect(notice?.detail.zh).toBe("");
  });

  it("orders by the department's own severity", async () => {
    stub(feed(ONE_LINER + KANGXI));
    const notices = await fetchNotices();
    expect(notices.map((n) => n.status)).toEqual([2, 3]);
  });

  it("skips empty messages rather than rendering blanks", async () => {
    stub(feed("<message><msgID>1</msgID><ChinText></ChinText><EngText></EngText></message>"));
    await expect(fetchNotices()).resolves.toEqual([]);
  });

  it("raises when the feed is unavailable, so the screen can offer a retry", async () => {
    stub("", false);
    await expect(fetchNotices()).rejects.toThrow();
  });
});

describe("routesMentioned", () => {
  it("picks up a route named in either language", async () => {
    stub(feed(KANGXI));
    const [notice] = await fetchNotices();
    expect(routesMentioned(notice!)).toContain("NR338S");
  });

  it("does not mistake times or numbers in prose for routes", async () => {
    stub(
      feed(`<message><msgID>9</msgID><CurrentStatus>3</CurrentStatus>
        <ChinText>下午5時30分現時交通繁忙。</ChinText>
        <EngText>Traffic is heavy at 5:30 p.m.</EngText></message>`),
    );
    const [notice] = await fetchNotices();
    expect(routesMentioned(notice!)).toEqual([]);
  });
});
