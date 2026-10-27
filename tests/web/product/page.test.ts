/**
 * The rest of the page main.js drew: the six points, the delivery copy per market, the
 * free-delivery strip, the gallery, the badge and checkout link, the country select (and its
 * place in the header), the catalogue's one door (escaping), the year.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cat, marketOf, openPage, tap, type Page } from "./_page";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const perkTexts = (p: Page) => p.$$("#ptsTop .sz-perks li > span").map((s) => s.textContent);

describe("from test-v309.js / test-v211.js / test-v196.js / test-v198.js / test-v301.js: the six points", () => {
  it("OM: free over the threshold, Visa or cash, 24 h, the guarantee, 48 h, three scents — in that order", async () => {
    const p = await openPage();
    expect(perkTexts(p)).toEqual([
      "توصيل مجاني فوق " + p.$("#ptsTop .nw")!.textContent,
      "فيزا أو الدفع عند الاستلام",
      "تعديل أو إلغاء خلال 24 ساعة",
      "15 يومًا ضمان استرداد الأموال",
      "شحن سريع خلال 48 ساعة",
      "3 روائح حصرية",
    ]);
    expect(p.$("#ptsTop .nw")!.innerHTML).toBe(p.LM.moneyHTML(p.LM.freeOver()));
    const icons = p.$$("#ptsTop .sz-perks li svg").map((s) => s.innerHTML.slice(0, 20));
    expect(icons[0]).toBe('<path d="M4.5 12.6 9');
    expect(p.$$("#ptsTop .ship-eta").length).toBe(1);
  });

  it("card only where cash is off; free for all with a running offer at 0; the market's scent count; KW keeps 72 h", async () => {
    const c = cat();
    const kw = marketOf(c, "KW");
    kw.codOn = false;
    kw.freeOver = 0;
    kw.scents = JSON.parse(JSON.stringify(c.scents)).slice(0, 2);
    c.freeShip = { active: true, countries: { KW: { on: true, over: 0 } } };
    const p = await openPage({ catalogue: c, url: "/?country=KW" });
    expect(perkTexts(p)).toEqual(["توصيل مجاني لكل الطلبات", "الدفع بالفيزا", "تعديل أو إلغاء خلال 24 ساعة", "15 يومًا ضمان استرداد الأموال", "شحن سريع خلال 72 ساعة", "رائحتان حصريتان"]);
    kw.scents = kw.scents!.slice(0, 1);
    c.freeShip = undefined;
    const q = await openPage({ catalogue: c, url: "/?country=KW" });
    expect(perkTexts(q)[0]).toBe("الدفع بالفيزا"); // no threshold, no deal: no free-delivery point
    expect(perkTexts(q)[4]).toBe("رائحة حصرية");
  });

  it("English: \"15 day refund guarantee\", \"Free delivery over …\"", async () => {
    const p = await openPage({ lang: "en", english: true });
    const t = perkTexts(p);
    expect(t[0]).toMatch(/^Free delivery over /);
    expect(t[3]).toBe("15 day refund guarantee");
    expect(t[4]).toBe("48 hour shipping");
  });
});

describe("from test-clip.js / test-v202.js / test-v198.js: the delivery copy in the الشحن panel", () => {
  it("per market: the threshold with its mark, the fee under it, the cash line, the delivery time", async () => {
    const p = await openPage({ url: "/?country=AE" });
    const free = p.$<HTMLElement>(".ship-free")!, cost = p.$<HTMLElement>(".ship-cost")!, faq = p.$(".ship-eta-faq")!;
    expect(free.textContent).toContain("فوق");
    expect(free.innerHTML).toContain("300");
    expect(free.innerHTML).toContain('class="dh"');
    expect(cost.innerHTML).toBe("الشحن " + p.LM.moneyHTML(30) + " للطلبات الأقل من ذلك");
    expect(faq.textContent).toBe("توصيل خلال 72 ساعة لجميع دول الخليج");
    p.LM.setCountry("OM");
    expect(free.innerHTML).toContain("30");
    expect(free.innerHTML).not.toContain("300");
    expect(free.innerHTML).toContain('class="omr"');
    expect(faq.textContent).toBe("توصيل خلال 48 ساعة داخل عُمان");
    expect(faq.getAttribute("data-def")).toBe("توصيل خلال 72 ساعة لجميع دول الخليج");
    p.LM.setCountry("KW");
    expect(free.textContent).toContain("KWD");
    expect(faq.textContent).toBe("توصيل خلال 72 ساعة لجميع دول الخليج");
    p.LM.setCountry("SA");
    expect(faq.textContent).toBe("توصيل خلال 3-5 أيام إلى السعودية");
    expect(p.$(".ship-eta")!.textContent).toBe("شحن خلال 3-5 أيام");
    p.LM.setCountry("QA");
    expect(faq.textContent).toBe("توصيل خلال 3-5 أيام إلى قطر");
  });

  it("no threshold and no fee: both lines hidden; cash off: the cash line hidden", async () => {
    const c = cat();
    Object.assign(marketOf(c, "BH"), { freeOver: 0, ship: 0, codOn: false });
    const p = await openPage({ catalogue: c, url: "/?country=BH" });
    expect(p.$<HTMLElement>(".ship-free")!.hidden).toBe(true);
    expect(p.$(".ship-free")!.textContent).not.toContain("فوق");
    expect(p.$<HTMLElement>(".ship-cost")!.hidden).toBe(true);
    expect(p.$<HTMLElement>(".cod-faq")!.hidden).toBe(true);
    p.LM.setCountry("OM");
    expect(p.$<HTMLElement>(".cod-faq")!.hidden).toBe(false);
  });
});

describe("from test-free-ship.js / test-v413.js: the free-delivery strip (#fsBar)", () => {
  it("painted from LM.freeDeal(), whole days, re-checked every minute; hidden (and the page repainted) at the end", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
    vi.setSystemTime(new Date("2026-09-23T15:01:00+04:00"));
    const c = cat();
    c.freeShip = { active: true, countries: { OM: { on: true, over: 10, days: 5, from: "2026-09-23T15:00:00+04:00" } } };
    const p = await openPage({ catalogue: c });
    const bar = p.$<HTMLElement>("#fsBar")!;
    expect(bar.hidden).toBe(false);
    expect(p.$("#fsTxt")!.innerHTML).toBe("<b>توصيل مجاني</b> فوق " + '<span class="fs-amt">' + p.LM.moneyHTML(10) + "</span>");
    expect(p.$("#fsLeft")!.innerHTML).toBe("باقي <b>5 أيام</b>");
    expect(p.$<HTMLElement>("#fsDot")!.hidden).toBe(false);
    vi.setSystemTime(new Date("2026-09-24T09:00:00+04:00"));
    vi.advanceTimersByTime(60e3);
    expect(p.$("#fsLeft")!.innerHTML).toBe("باقي <b>4 أيام</b>");
    vi.setSystemTime(new Date("2026-09-27T23:00:00+04:00"));
    vi.advanceTimersByTime(60e3);
    expect(p.$("#fsLeft")!.innerHTML).toBe("باقي <b>يوم واحد</b>");
    const ships = p.ship.length;
    vi.setSystemTime(new Date("2026-09-28T00:00:30+04:00"));
    vi.advanceTimersByTime(60e3);
    expect(bar.hidden).toBe(true);
    expect(p.ship.length).toBe(ships + 1); // sync(): every threshold repainted
  });

  it("free on every order with no end: no days; nothing running: hidden", async () => {
    const c = cat();
    c.freeShip = { active: true, countries: { AE: { on: true, over: 0 } } };
    const p = await openPage({ catalogue: c, url: "/?country=AE" });
    expect(p.$("#fsTxt")!.innerHTML).toBe("<b>توصيل مجاني</b> على جميع الطلبات");
    expect(p.$<HTMLElement>("#fsLeft")!.hidden).toBe(true);
    expect(p.$<HTMLElement>("#fsDot")!.hidden).toBe(true);
    p.LM.setCountry("KW");
    expect(p.$<HTMLElement>("#fsBar")!.hidden).toBe(true);
  });
});

describe("from test-gallery.js / test-v205.js / test-v438.js / test-v204.js: the gallery", () => {
  it("three frames in order; the HTML's first picture kept; thumbs labelled; square sizes; the version on every URL", async () => {
    const first = () => document.querySelector("#slides img");
    const p0 = document.createElement("div");
    void p0;
    const p = await openPage({ assetV: "abc" });
    const slides = p.$$("#slides .gal-slide");
    expect(slides.length).toBe(3);
    const srcs = slides.map((s) => s.querySelector("img")!.getAttribute("src"));
    // the kept first picture is the HTML's own (its version is the build's placeholder here)
    expect(srcs[0]).toMatch(/^assets\/img\/white-box-open\.jpg/);
    expect(srcs.slice(1)).toEqual(["assets/img/resin-macro.jpg?v=abc", "assets/img/box-front.jpg?v=abc"]);
    expect(first()!.getAttribute("fetchpriority")).toBe("high");
    expect(slides[1]!.querySelector("img")!.getAttribute("loading")).toBe("lazy");
    expect(slides[1]!.querySelector("img")!.getAttribute("width")).toBe("1080");
    expect(slides[1]!.querySelector("source")!.getAttribute("srcset")).toBe("assets/img/resin-macro.avif?v=abc");
    const thumbs = p.$$("#thumbs button");
    expect(thumbs.map((t) => t.getAttribute("aria-label"))).toEqual(["صورة 1", "صورة 2", "صورة 3"]);
    expect(thumbs.map((t) => t.getAttribute("aria-current"))).toEqual(["true", "false", "false"]);
    expect(thumbs[2]!.querySelector("img")!.getAttribute("src")).toBe("assets/img/box-front-sm.jpg?v=abc");
    expect(thumbs[2]!.querySelector("img")!.getAttribute("width")).toBe("320");
    expect(thumbs[2]!.querySelector("img")!.getAttribute("alt")).toBe("لبان صلالة معطر");
    // a thumb jumps the strip and marks itself
    const strip = p.$("#slides")!;
    const to = vi.fn();
    strip.scrollTo = to as unknown as typeof strip.scrollTo;
    tap(thumbs[2]!);
    const rtl = getComputedStyle(document.documentElement).direction === "rtl";
    expect(to).toHaveBeenCalledWith({ left: 2 * strip.clientWidth * (rtl ? -1 : 1), behavior: "smooth" });
    expect(thumbs.map((t) => t.getAttribute("aria-current"))).toEqual(["false", "false", "true"]);
    // v438: back to the first picture on load / pageshow
    window.dispatchEvent(new Event("pageshow"));
    expect(thumbs.map((t) => t.getAttribute("aria-current"))).toEqual(["true", "false", "false"]);
  });

  it("v438: the grid's pictures survive a rebuild (same nodes, by address)", async () => {
    const p = await openPage();
    const before = p.$$("#sizes picture");
    p.LM.setCountry("AE"); // a full redraw of the grid
    const after = p.$$("#sizes picture");
    expect(after.length).toBe(before.length);
    after.forEach((pic) => expect(before).toContain(pic));
  });
});

describe("the badge, the checkout link, the year", () => {
  it("badge counts the basket; the checkout link wakes only with something in it", async () => {
    const p = await openPage({ cart: [{ sizeId: "large", scentId: "oud", qty: 2 }] });
    expect(p.$("#cartCount")!.textContent).toBe("2");
    expect(p.$<HTMLElement>("#cartCount")!.hidden).toBe(false);
    expect(p.$(".cart")!.getAttribute("aria-label")).toBe("السلة (2)");
    expect(p.$(".cart")!.classList.contains("filled")).toBe(true);
    expect(p.$("#goCheckout")!.classList.contains("on")).toBe(true);
    expect(p.$("#goCheckout")!.getAttribute("aria-disabled")).toBe("false");
    const q = await openPage();
    expect(q.$("#goCheckout")!.getAttribute("aria-disabled")).toBe("true");
    const e = new MouseEvent("click", { bubbles: true, cancelable: true });
    q.$("#goCheckout")!.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true);
    expect(q.$("#year")!.textContent).toBe(String(new Date().getFullYear()));
  });
});

describe("from test-catalogue-injection.js: the catalogue's one door", () => {
  it("names, tags, colours and ids from a hostile catalogue never become markup", async () => {
    const X = '"><img src=x onerror=alert(1)>';
    const H = '#fff" onmouseover="alert(1)';
    const p = await openPage({
      setup: (LM) => {
        const sizes = LM.sizes, scents = LM.scents;
        LM.sizes = () => sizes.call(LM).map((s) => Object.assign({}, s, { name: X, weight: X, tag: X, tagColor: H }));
        LM.scents = () =>
          scents
            .call(LM)
            .map((s, i) => Object.assign({}, s, { name: X, notes: X, tag: X, tagColor: H, accent: H, id: i === 0 ? s.id : i === 1 ? 'bad" onmouseover="x' : "<script>" }));
        LM.offer = ((real) => (id?: string) => {
          const o = real.call(LM, id);
          return o ? Object.assign({}, o, { name: X, note: X, badge: X, term: X }) : o;
        })(LM.offer);
      },
    });
    const html = document.body.innerHTML;
    /* nothing became an element or a handler: every <img> is one the page drew, no element
       carries an on* attribute, no <script> */
    const all = Array.from(document.body.querySelectorAll("*"));
    expect(all.filter((e) => Array.from(e.attributes).some((a) => /^on/i.test(a.name)))).toEqual([]);
    expect(document.body.querySelectorAll("script").length).toBe(0);
    expect(Array.from(document.body.querySelectorAll("img")).filter((i) => /^x$/.test(i.getAttribute("src") || ""))).toEqual([]);
    expect(p.$(".tile-name")!.textContent).toBe('"><img src=x onerror=alert(1)>');
    expect(p.$(".tile-name")!.innerHTML).toBe("\"&gt;&lt;img src=x onerror=alert(1)&gt;");
    for (const m of html.matchAll(/--(?:accent|tag):([^;"]+)/g)) expect(m[1]).toMatch(/^#[0-9a-fA-F]{3,8}$/);
    for (const m of html.matchAll(/data-scent="([^"]*)"/g)) expect(m[1]).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(p.$$("#sizes [data-scent]").length).toBeGreaterThan(0);
  });

  it("the country options are escaped", async () => {
    const p = await openPage({
      setup: (LM) => {
        const real = LM.countries;
        LM.countries = () => real.call(LM).map((c, i) => (i === 0 ? Object.assign({}, c, { name: "<b>x</b>", flag: '"><i>' }) : c));
      },
    });
    const opts = p.$("#cty")!.innerHTML;
    expect(opts).toContain("&lt;b&gt;x&lt;/b&gt;");
    expect(opts).not.toContain("<b>x</b>");
    expect(p.$("#cty option[selected]")!.getAttribute("value")).toBe("OM");
    expect(p.$$("#cty option").length).toBe(p.LM.countries().length);
  });
});

describe("from test-v337.js / test-v400.js: the country select's place (placeCountry)", () => {
  it("768px and up: one .hdr-end holding [country, language, basket]; below: back beside the name", async () => {
    const p = await openPage({ media: { wide: true } });
    const bar = document.querySelector(".hdr-bar")!;
    expect(bar.querySelectorAll(".hdr-end").length).toBe(1);
    expect(Array.from(bar.querySelector(".hdr-end")!.children).map((c) => c.className)).toEqual(["cty", "lang", "cart"]);
    expect(p.$("#cty")!.closest(".hdr-end")).not.toBe(null);

    /* a narrow page, then the query changes both ways */
    const q = await openPage();
    expect(document.querySelector(".hdr-end")).toBe(null);
    const home = q.$("#cty")!.parentElement;
    let listener: (() => void) | null = null;
    const state = { wide: true };
    vi.stubGlobal("matchMedia", (m: string) => ({
      get matches() {
        return /min-width/.test(m) ? state.wide : false;
      },
      addEventListener: (_e: string, f: () => void) => (listener = f),
      removeEventListener() {},
    }));
    const { placeCountry } = await import("../../../src/web/product/country");
    placeCountry();
    expect(Array.from(document.querySelector(".hdr-end")!.children).map((c) => c.className)).toEqual(["cty", "lang", "cart"]);
    state.wide = false;
    listener!();
    expect(document.querySelector(".hdr-end")).toBe(null);
    expect(q.$("#cty")!.parentElement).toBe(home);
    expect(Array.from(document.querySelector(".hdr-bar")!.children).slice(-2).map((c) => c.className)).toEqual(["lang", "cart"]);
  });
});
