/**
 * The header (header module): the delivery band with its running text and progress, the
 * basket badge's neighbours, the language switch, the scrolled state.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { bootPage, catalogueFile, LINE, stubNavigation } from "../checkout/_page";
import { G as W } from "../../../src/web/checkout/contracts";

afterEach(() => {
  vi.restoreAllMocks();
});
const $ = <E extends HTMLElement = HTMLElement>(s: string) => document.querySelector(s) as E;
const home = (o: Parameters<typeof bootPage>[0] = {}) => bootPage({ page: "home", url: "/?country=OM", ...o });

// from test-v309.js, test-v310.js, test-v311.js, test-v445.js, test-checkout-summary.js
describe("the delivery band", () => {
  it("short of free delivery: the threshold (with its mark) runs with the shop's two lines, in two copies", async () => {
    const { LM } = await home({ cart: [LINE("oud", "large")] });
    const txt = $("#shipTxt");
    const seq =
      "<span>" + LM.moneyHTML(30) + " للتوصيل المجاني</span>" + '<span class="ship-dot" aria-hidden="true">·</span>' +
      '<span class="ship-x">تجربة فريدة للأصالة العمانية</span><span class="ship-dot" aria-hidden="true">·</span>' +
      '<span class="ship-x">احجز علبتك الآن</span><span class="ship-dot" aria-hidden="true">·</span>';
    expect(txt.getAttribute("data-run")).toBe(seq);
    expect(txt.innerHTML).toBe('<span class="ship-run"><span class="ship-seq">' + seq + '</span><span class="ship-seq" aria-hidden="true">' + seq + "</span></span>");
    /* 25 of 30 → 83% */
    expect($("#shipFill").style.width).toBe("83%");
    expect($("#shipFill").classList.contains("done")).toBe(false);
    expect(txt.classList.contains("over")).toBe(true);
    expect($<HTMLElement>(".ship-track").classList.contains("free")).toBe(false);
    /* written again only when the message changes (the loop does not jump back) */
    const run = txt.firstChild;
    W().lmShip!(0);
    expect(txt.firstChild).toBe(run);
  });

  it("the pace: one copy's width at 60 px/s (6 s at least), cloned to fill the widest window (≤ 10), --ship-w", async () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ width: 480, height: 10, top: 0, left: 0, right: 480, bottom: 10, x: 0, y: 0, toJSON() {} } as DOMRect);
    await home({ cart: [LINE("oud", "large")] });
    const r = $("#shipTxt").firstChild as HTMLElement;
    expect(r.style.animationDuration).toBe("8s");
    expect(r.style.getPropertyValue("--ship-w")).toBe("-480px");
    const need = Math.min(10, Math.ceil(Math.max(window.innerWidth || 0, (window.screen && screen.width) || 0) / 480) + 1);
    expect(r.children.length).toBe(Math.max(2, need));
    expect(r.children[r.children.length - 1]!.getAttribute("aria-hidden")).toBe("true");
  });

  it("free: 'التوصيل مجاني ✓', standing still, the fill done, the track green; a preview never says free", async () => {
    const { LM } = await home({ cart: [LINE("oud", "large", 2)] });
    expect($("#shipTxt").textContent).toBe("التوصيل مجاني ✓");
    expect($("#shipTxt").hasAttribute("data-run")).toBe(false);
    expect($("#shipFill").classList.contains("done")).toBe(true);
    expect($<HTMLElement>(".ship-track").classList.contains("free")).toBe(true);
    sessionStorage.setItem("lm_cart", JSON.stringify([LINE("oud", "large")]));
    W().lmShip!(LM.price("large"));
    expect($("#shipFill").style.width).toBe("100%");
    expect($("#shipFill").classList.contains("done")).toBe(false);
    expect($("#shipTxt").textContent).not.toContain("✓");
  });

  it("no threshold known: nothing claimed (empty, 0%)", async () => {
    const c = catalogueFile();
    c.countries.forEach((x) => (x.freeOver = 0));
    await home({ cart: [LINE("oud", "large")], catalogue: c });
    expect($("#shipTxt").textContent).toBe("");
    expect($("#shipFill").style.width).toBe("0%");
  });

  it("the set ships free (v408): the band says free on a basket with the set", async () => {
    const c = catalogueFile();
    c.offer = { ...c.offer!, freeShip: true } as never;
    const { LM } = await home({ cart: [{ scentId: "bundle", sizeId: "bundle", qty: 1, price: 1 }], catalogue: c });
    expect(LM.setFree(LM.readCart())).toBe(true);
    expect($("#shipTxt").textContent).toBe("التوصيل مجاني ✓");
    expect($("#shipFill").style.width).toBe("100%");
    expect($("#shipFill").classList.contains("done")).toBe(true);
  });

  it("samples and off lines do not count toward it", async () => {
    await home({ url: "/?country=OM", cart: [LINE("oud", "large"), { scentId: "", sizeId: "samples", qty: 10, price: 1 }] });
    expect($("#shipFill").style.width).toBe("83%");
  });

  it("a market change repaints it in that market's threshold and currency", async () => {
    const { LM } = await home({ cart: [LINE("oud", "large")] });
    LM.setCountry("AE");
    expect($("#shipTxt").getAttribute("data-run")).toContain(LM.moneyHTML(300) + " للتوصيل المجاني");
    expect($("#shipFill").style.width).toBe("83%");
  });

  it("English: the band's words", async () => {
    await home({ url: "/en/?country=OM", english: true, cart: [LINE("oud", "large")] });
    const run = $("#shipTxt").getAttribute("data-run")!;
    expect(run).toContain(String(window.LM_EN!["احجز علبتك الآن"]));
    expect(run).toContain(String(window.LM_EN!["تجربة فريدة للأصالة العمانية"]));
  });
});

describe("the header", () => {
  it("scrolled past 90 px: .alt; back: not", async () => {
    await home({ cart: [] });
    const hdr = $("#hdr");
    expect(hdr.classList.contains("alt")).toBe(false);
    Object.defineProperty(window, "scrollY", { configurable: true, value: 120 });
    window.dispatchEvent(new Event("scroll"));
    expect(hdr.classList.contains("alt")).toBe(true);
    Object.defineProperty(window, "scrollY", { configurable: true, value: 10 });
    window.dispatchEvent(new Event("scroll"));
    expect(hdr.classList.contains("alt")).toBe(false);
  });

  it("the language switch remembers the choice and carries ?country= across (not ?lang=)", async () => {
    const nav = stubNavigation();
    await home({ url: "/?country=AE&lang=ar", cart: [] });
    const en = document.querySelector('.lang a[data-lang="en"]') as HTMLAnchorElement;
    en.click();
    expect(localStorage.getItem("lm_lang")).toBe("en");
    expect(nav.hrefs).toEqual(["en/?country=AE"]);
    /* the current language's link does nothing */
    (document.querySelector('.lang a[aria-current]') as HTMLAnchorElement).click();
    expect(localStorage.getItem("lm_lang")).toBe("en");
    expect(nav.hrefs.length).toBe(1);
  });

  it("with nothing to carry, the plain link is followed", async () => {
    const nav = stubNavigation();
    await home({ url: "/?lang=ar", cart: [] });
    const en = document.querySelector('.lang a[data-lang="en"]') as HTMLAnchorElement;
    const ev = new MouseEvent("click", { bubbles: true, cancelable: true });
    en.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
    expect(nav.hrefs).toEqual([]);
  });
});

// from test-suggest-scent.js (the rank named once, boxFor)
describe("the suggestion's rules", () => {
  it("RANK is oud, amber, lemon; boxFor prefers the small box, else the large, else none", async () => {
    const { LM } = await bootPage({ url: "/checkout.html?country=OM", cart: [LINE("oud", "large")] });
    /* the page's own instance of the module (after vi.resetModules) */
    const mod = await import("../../../src/web/header");
    expect(mod.RANK).toEqual(["oud", "amber", "lemon"]);
    expect(mod.boxFor("oud")).toBe("small");
    LM.c = { ...LM.c, prices: { ...LM.c.prices, small: { now: 0 } } };
    expect(mod.boxFor("oud")).toBe("large");
    LM.c = { ...LM.c, prices: { ...LM.c.prices, small: { now: 0 }, large: { now: 0 } } };
    expect(mod.boxFor("oud")).toBe(null);
  });
});
