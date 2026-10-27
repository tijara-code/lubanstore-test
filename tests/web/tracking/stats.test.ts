/**
 * stats.ts — the beacon queue, the first-party events, the landing, the opt-out.
 */
import { afterEach, describe, expect, it } from "vitest";
import { bodies, dropListeners, items, loadPage, tick } from "./_page";

afterEach(() => dropListeners());

const statsOnly = { core: false, pixel: false } as const;

// from test-beacon.js: the browser — one queue, one request
describe("the beacon: one queue, one request", () => {
  it("publishes LMBeacon with queue, flush, hold, release, patch", async () => {
    await loadPage(statsOnly);
    const B = window.LMBeacon!;
    expect(Object.keys(B).sort()).toEqual(["flush", "hold", "patch", "queue", "release"]);
  });

  it("the page view, the session start and two relays leave as ONE post to /api/beacon", async () => {
    const p = await loadPage(statsOnly);
    window.LMBeacon!.queue("snap", { name: "PAGE_VIEW", id: "a" });
    window.LMBeacon!.queue("meta", { name: "PageView", id: "b" });
    expect(p.posted.length).toBe(0);                     // nothing sent synchronously
    await tick(150);
    expect(p.posted.length).toBe(1);
    expect(p.posted[0]!.url).toBe("/api/beacon");
    const b = (await bodies(p))[0]!.body;
    expect(b.items.length).toBe(4);
    expect(b.items.map((i) => i.kind).join(",")).toBe("ev,ev,snap,meta");
    expect(b.items[0]!.body.name).toBe("page_view");
    expect(b.items[1]!.body.name).toBe("session_start");
    // a dozen flushes at once
    for (let i = 0; i < 12; i++) window.LMBeacon!.queue("ev", { name: "size_open" });
    expect(p.posted.length).toBe(2);
  });

  it("flushes on pagehide and when the tab is hidden", async () => {
    const p = await loadPage(statsOnly);
    await tick(120);
    window.LMBeacon!.queue("ev", { name: "cart_open" });
    window.dispatchEvent(new Event("pagehide"));
    expect(p.posted.length).toBe(2);
    window.LMBeacon!.queue("ev", { name: "cart_open" });
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
    expect(p.posted.length).toBe(3);
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
  });

  it("falls back to fetch keepalive when sendBeacon is missing or refuses", async () => {
    for (const mode of ["absent", "refuse"] as const) {
      const p = await loadPage({ ...statsOnly, sendBeacon: mode });
      await tick(120);
      expect(p.fetches.map((f) => f.url)).toEqual(["/api/beacon"]);
      expect(p.fetches[0]!.body.items[0].body.name).toBe("page_view");
    }
  });

  it("never posts to /api/ev itself", async () => {
    const p = await loadPage({ ...statsOnly, sendBeacon: "absent" });
    window.LMEV!.track("cart_open");
    await tick(120);
    expect(p.fetches.some((f) => f.url === "/api/ev")).toBe(false);
  });
});

// from test-v209.js: a page on its way to /en/ counts nothing
describe("a page leaving for /en/", () => {
  it("queues nothing — and the same queue sends on a page that stays", async () => {
    const p = await loadPage({ ...statsOnly, leaving: true });
    window.LMBeacon!.queue("meta", { name: "PageView", id: "x" });
    window.LMBeacon!.flush();
    await tick(120);
    expect(p.posted.length).toBe(0);
    delete window.__lmLeaving;
    window.LMBeacon!.queue("meta", { name: "PageView", id: "y" });
    await tick(120);
    expect(p.posted.length).toBe(1);
    expect((await items(p)).map((i) => i.body.id)).toEqual(["y"]);
  });
});

// from test-v209.js / test-v314.js: the held batch
describe("hold / release / patch", () => {
  it("nothing leaves while held; release sends on the short timer; patch fills queued bodies", async () => {
    const p = await loadPage(statsOnly);
    const B = window.LMBeacon!;
    B.hold(() => {});
    B.queue("snap", { name: "PAGE_VIEW", id: "s1" });
    await tick(150);
    expect(p.posted.length).toBe(0);
    B.patch("snap", (b) => { b.scid = "scid-cookie"; });
    B.release();
    await tick(120);
    const its = await items(p);
    expect(its.map((i) => i.kind + ":" + (i.body.name || ""))).toEqual(["ev:page_view", "ev:session_start", "snap:PAGE_VIEW"]);
    expect(its[2]!.body.scid).toBe("scid-cookie");
  });

  it("a flush while held calls the holder first, then sends everything at once", async () => {
    const p = await loadPage(statsOnly);
    const B = window.LMBeacon!;
    B.hold(() => B.queue("meta", { name: "PageView", id: "held" }));
    B.flush();
    expect(await p.kinds()).toEqual(["ev:page_view,ev:session_start,meta:PageView"]);
  });
});

// from test-stats.js / test-v302.js: the session id, the landing, session_start once
describe("the session and the landing", () => {
  it("the sid is per tab: sessionStorage lm_sid, never localStorage or a cookie", async () => {
    const p = await loadPage(statsOnly);
    await tick(120);
    const sid = sessionStorage.getItem("lm_sid");
    expect(sid).toMatch(/^[a-z0-9]{9}$/);
    expect(Object.keys({ ...localStorage })).not.toContain("lm_sid");
    expect(document.cookie).toBe("");
    expect((await items(p)).every((i) => i.body.sid === sid)).toBe(true);
  });

  it("the landing keeps all six utm_ tags, the click ids present and the referrer's origin", async () => {
    await loadPage({ ...statsOnly, url: "/?utm_source=IG&utm_medium=Paid+Social&utm_campaign=Launch%20Day&utm_content=reel&utm_term=set1&utm_id=99&fbclid=AbC&ScCid=zz", referrer: "https://l.instagram.com/path?x=1" });
    expect(window.LMLanding!()).toEqual({
      src: "IG", ref: "https://l.instagram.com", fbclid: true, sccid: true, ttclid: false, gclid: false,
      utm: { source: "IG", medium: "Paid Social", campaign: "Launch Day", content: "reel", term: "set1", id: "99" },
    });
  });

  it("session_start once per tab, carrying the landing; the next page of the tab sends none", async () => {
    let p = await loadPage({ ...statsOnly, url: "/?utm_source=snapchat&utm_medium=paid_social" });
    await tick(120);
    let its = await items(p);
    const ss = its.filter((i) => i.body.name === "session_start");
    expect(ss.length).toBe(1);
    expect(ss[0]!.body.item).toBeUndefined();   // "" is dropped: the server places it
    expect(ss[0]!.body.land.utm).toEqual({ source: "snapchat", medium: "paid_social" });
    p = await loadPage({ ...statsOnly, url: "/checkout.html", sameTab: true });
    await tick(120);
    its = await items(p);
    expect(its.map((i) => i.body.name)).toEqual(["page_view", "checkout_view"]);
    expect(its[0]!.body.item).toBe("checkout");
    // the landing is still the first page's
    expect(window.LMLanding!().utm).toEqual({ source: "snapchat", medium: "paid_social" });
  });

  it("nothing past the tab: stats writes no localStorage", async () => {
    await loadPage({ ...statsOnly, url: "/?utm_source=ig" });
    await tick(120);
    expect(localStorage.length).toBe(0);
  });
});

// from test-stats.js: DNT / GPC
describe("the browser's own opt-out", () => {
  for (const o of [{ dnt: true }, { gpc: true }]) {
    it(JSON.stringify(o) + ": no ev is sent at all", async () => {
      const p = await loadPage({ ...statsOnly, ...o });
      window.LMEV!.track("cart_open");
      window.LMBeacon!.queue("meta", { name: "PageView", id: "m" });   // the ad relays are not first-party events
      await tick(120);
      expect((await items(p)).map((i) => i.kind)).toEqual(["meta"]);
    });
  }
});

// from test-v447.js, test-stats.js: the page item
describe("what page this is", () => {
  const cases: Array<[string, string | undefined, string]> = [
    ["/", undefined, "home"], ["/en/", undefined, "home"], ["/checkout.html", undefined, "checkout"],
    ["/en/checkout.html", undefined, "checkout"], ["/privacy.html", undefined, "privacy"],
    ["/en/privacy.html", undefined, "privacy"], ["/no-such-page", "404", "404"], ["/404.html", undefined, "404"],
  ];
  for (const [url, dataPage, want] of cases) {
    it(url + (dataPage ? " (data-page=404)" : "") + " → " + want, async () => {
      const p = await loadPage({ ...statsOnly, url, dataPage });
      await tick(120);
      expect((await items(p))[0]!.body).toMatchObject({ name: "page_view", item: want });
    });
  }
  it("the checkout also says checkout_view", async () => {
    const p = await loadPage({ ...statsOnly, url: "/checkout.html" });
    await tick(120);
    expect((await items(p)).map((i) => i.body.name)).toEqual(["page_view", "session_start", "checkout_view"]);
  });
});

// from test-stats.js (callers), test-beacon.js: the delegated clicks
describe("the delegated clicks", () => {
  it("wa.me → whatsapp_click (its class), .size → size_open (its name), .cart → cart_open, [data-pay] → pay_method", async () => {
    document.body.innerHTML = `
      <a class="fab" href="https://wa.me/968"><span id="wa">x</span></a><a href="https://wa.me/1" id="wa2">y</a>
      <div class="size"><b class="sz-name">  الحجم الكبير ٢٥٠ غرام  </b><i id="sz">.</i></div>
      <div class="size"><i id="sz2">.</i></div>
      <button class="cart" id="ct"><span id="ctin">1</span></button>
      <div data-pay="cod"><span id="cod">COD</span></div>`;
    const p = await loadPage(statsOnly);
    await tick(120);
    for (const id of ["wa", "wa2", "sz", "sz2", "ctin", "cod"]) (document.getElementById(id) as HTMLElement).click();
    await tick(120);
    const ev = (await items(p)).slice(2).map((i) => [i.body.name, i.body.item]);
    expect(ev).toEqual([
      ["whatsapp_click", "fab"], ["whatsapp_click", "link"], ["size_open", "الحجم الكبير ٢٥٠ غرام"], ["size_open", "size"],
      ["cart_open", undefined], ["pay_method", "cod"],
    ]);
    document.body.innerHTML = "";
  });
});
