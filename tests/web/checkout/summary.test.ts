/**
 * The الطلب column and the bar above التوصيل (checkout module + header module).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { bootPage, catalogueFile, flush, LINE, marketOf, num, stubNavigation, text } from "./_page";
import type { Catalogue } from "../../../src/web/core/types";
import { G as W } from "../../../src/web/checkout/contracts";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const wasOf = (h: string) => num(/<span class="was">([\s\S]*?)<\/span>/.exec(h)![1]!);
const nowOf = (h: string) => num(/<span class="now">([\s\S]*?)<\/span>/.exec(h)![1]!);

// from test-checkout-summary.js
describe("two prices per line, and the column adds up", () => {
  const CART = [
    { scentId: "oud", scent: "عود لافندر", sizeId: "bundle", size: "باقة", price: 299, qty: 1 },
    { scentId: "amber", scent: "عنبر توت", sizeId: "small", size: "100 جم", price: 120, qty: 2 },
  ];

  it("was above is, per line, unit × qty; المجموع, وفرت and the total reconcile (AE)", async () => {
    const { $, LM } = await bootPage({ url: "/checkout.html?country=AE", cart: CART });
    const rows = $("#items").children;
    expect(rows.length).toBe(2);
    const bundle = rows[0]!.innerHTML;
    expect(/class="was"/.test(bundle) && /class="now"/.test(bundle)).toBe(true);
    expect(bundle.indexOf('class="was"') < bundle.indexOf('class="now"')).toBe(true);
    expect([wasOf(bundle), nowOf(bundle)]).toEqual([360, 299]);
    const small = rows[1]!.innerHTML;
    /* the multiplier bug: two boxes at 160/120 is 320 above 240, never 160 */
    expect([wasOf(small), nowOf(small)]).toEqual([320, 240]);
    const sub = num($("#sub")), saved = num($("#saved"));
    expect(sub).toBe(680);
    expect(sub).toBe(wasOf(bundle) + wasOf(small));
    /* v414: وفرت counts the delivery this basket does not pay (AE: 30, free over 300) */
    expect(Math.abs(saved)).toBe(680 - 539 + LM.ship());
    expect(sub - (Math.abs(saved) - LM.ship())).toBe(nowOf(bundle) + nowOf(small));
    expect(num($("#total"))).toBe(539);
  });

  it("a line at full price shows one figure", async () => {
    const { $, LM } = await bootPage({ url: "/checkout.html?country=AE", cart: CART });
    const base = LM.c;
    LM.c = { ...base, prices: { ...base.prices, small: { now: 120, was: 0 } } };
    W().lmOnCartChange!();
    const plain = $("#items").children[1]!.innerHTML;
    expect(/class="was"/.test(plain)).toBe(false);
    expect(nowOf(plain)).toBe(240);
  });

  it("thumbnails: the size's packshot with the asset version, the scent's chip; an add-on without a photo draws its art", async () => {
    const { $, LM } = await bootPage({ url: "/checkout.html?country=OM", cart: [LINE("oud", "large"), { scentId: "", sizeId: "samples", qty: 1, scent: "عينات", size: "", price: 1 }] });
    const first = $("#items").children[0]!.innerHTML;
    expect(first).toContain('<img src="assets/img/white-box-open-sm.jpg' + LM.v + '" alt="" loading="lazy" decoding="async" width="58" height="58">');
    const norm = (h: string) => {
      const d = document.createElement("div");
      d.innerHTML = h;
      return d.innerHTML;
    };
    expect(first).toContain(norm(LM.lineMark(LM.readCart()[0])));
    const second = $("#items").children[1]!.innerHTML;
    expect(second.indexOf('<span class="thumb thumb-none" aria-hidden="true">')).toBe(0);
    expect(second).toContain(norm(LM.extraArt(LM.extraOf(LM.readCart()[1])!)));
  });
});

// from test-checkout-summary.js (the bar), test-free-ship.js (page side)
describe("the bar above التوصيل", () => {
  const AE = "/checkout.html?country=AE";
  it("past the market's threshold: says free, fill done, bar free, ship مجاني", async () => {
    const { $, LM } = await bootPage({ url: AE, cart: [LINE("oud", "bundle"), LINE("amber", "small", 2)] });
    expect($("#freeBar").hidden).toBe(false);
    expect(LM.freeOver()).toBe(300);
    expect(/مجاني/.test(text($("#freeMsg")))).toBe(true);
    expect($("#freeFill").classList.contains("done")).toBe(true);
    expect($("#freeBar").classList.contains("free")).toBe(true);
    expect(text($("#ship"))).toBe("مجاني");
  });

  it("short of it: asks for the difference as a rendered price, 40%, not done; one channel", async () => {
    const { $ } = await bootPage({ url: AE, cart: [LINE("oud", "small")] });
    const msg = $("#freeMsg");
    expect(/^أضف/.test(text(msg))).toBe(true);
    expect(num(msg)).toBe(300 - 120);
    expect(/التوصيل مجاني/.test(text(msg))).toBe(true);
    expect($("#freeFill").style.width).toBe("40%");
    expect($("#freeFill").classList.contains("done")).toBe(false);
    expect(/class="(dh|omr|sar)"/.test(msg.innerHTML)).toBe(true);
  });

  it("no threshold, no claim: the progress row hides (fill untouched) and comes back", async () => {
    const { $, LM } = await bootPage({ url: AE, cart: [LINE("oud", "small")] });
    const base = LM.c;
    LM.c = { ...base, freeOver: 0 };
    W().lmShip!(0);
    expect($("#freeProg").hidden).toBe(true);
    expect($("#freeFill").style.width).toBe("40%");
    LM.c = base;
    W().lmShip!(0);
    expect($("#freeProg").hidden).toBe(false);
    expect($("#freeBar").hidden).toBe(false);
  });

  it("the threshold is read once per paint: the checkout asks the header to paint (lmShip(0) after its totals)", async () => {
    const { LM } = await bootPage({ url: AE, cart: [LINE("oud", "small")] });
    const spy = vi.fn();
    const real = W().lmShip!;
    W().lmShip = (p?: number) => {
      spy(p);
      real(p);
    };
    const fo = vi.spyOn(LM, "freeOver");
    W().lmOnCartChange!();
    expect(spy).toHaveBeenCalledWith(0);
    fo.mockClear();
    real(0);
    /* paintFree is handed the threshold; freeMin() reads it once (the checkout's own
       totals read it separately, for the till's rule) */
    expect(fo).toHaveBeenCalledTimes(1);
  });

  it("a free-delivery offer at 0 (freeDeal, no threshold): every basket qualifies — bar free at 100%, ship free", async () => {
    const c: Catalogue = catalogueFile();
    (c as Record<string, unknown>).freeShip = { active: true, countries: { OM: { on: true, over: 0 } } };
    const { $, LM } = await bootPage({ url: "/checkout.html?country=OM", cart: [LINE("oud", "small")], catalogue: c });
    expect(LM.freeDeal()).toEqual({ over: 0, end: null });
    expect($("#freeFill").style.width).toBe("100%");
    expect($("#freeBar").classList.contains("free")).toBe(true);
    expect(text($("#ship"))).toBe("مجاني");
    expect($("#freeAdd").hidden).toBe(true);
    /* and the header band says so, standing still */
    expect($("#shipTxt").textContent).toBe("التوصيل مجاني ✓");
    expect($("#shipFill").style.width).toBe("100%");
  });
});

// from test-v414.js (the checkout column), test-v447.js (an off line out of the saving)
describe("the summary column (v414, v447)", () => {
  it("free delivery struck beside مجاني (sr-only), counted in وفرت; #sub.was only with a saving", async () => {
    const { $, LM } = await bootPage({ url: "/checkout.html?country=OM", cart: [LINE("oud", "large", 2)] });
    /* 50 ≥ 30: free; the fee (3) is struck and saved */
    expect($("#ship").classList.contains("free")).toBe(true);
    expect($("#ship").classList.contains("sr-only")).toBe(true);
    expect($("#shipWas").hidden).toBe(false);
    expect($("#shipWas").innerHTML).toBe(LM.moneyHTML(3));
    expect(num($("#saved"))).toBe(2 * (32 - 25) + 3);
    expect($("#savedRow").style.display).toBe("flex");
    expect($("#sub").classList.contains("was")).toBe(true);
    expect($("#saved").innerHTML).toBe("− " + LM.moneyHTML(17));
  });

  it("paying delivery: the fee shows, nothing struck; no offer saving → #sub not struck, وفرت hidden", async () => {
    const c = catalogueFile();
    marketOf(c, "OM").prices!.large = { now: 25, was: 0 };
    const { $, LM } = await bootPage({ url: "/checkout.html?country=OM", cart: [LINE("oud", "large")], catalogue: c });
    expect($("#ship").innerHTML).toBe(LM.moneyHTML(3));
    expect($("#ship").classList.contains("free")).toBe(false);
    expect($("#ship").classList.contains("sr-only")).toBe(false);
    expect($("#shipWas").hidden).toBe(true);
    expect($("#sub").classList.contains("was")).toBe(false);
    expect($("#savedRow").style.display).toBe("none");
    expect($("#saved").innerHTML).toBe("");
    expect(num($("#total"))).toBe(28);
  });

  it("v447: a line this market cannot buy is out of the subtotal, the saving and the price column", async () => {
    /* the trio in Saudi (no tiers priced there) */
    const { $ } = await bootPage({
      url: "/checkout.html?country=SA",
      cart: [{ sizeId: "trio", scentId: null, mix: ["oud", "oud", "amber"], qty: 1, scent: "3", size: "", price: 1 }, LINE("lemon", "large")],
    });
    const rows = $("#items").children;
    expect(rows[0]!.className).toBe("sum-item sum-off");
    expect(rows[0]!.querySelector(".p")!.innerHTML).toBe("");
    /* 250 + 30 delivery; the saving is the large box's own (320 − 250) only */
    expect(num($("#total"))).toBe(280);
    expect(num($("#sub"))).toBe(320);
    expect(num($("#saved"))).toBe(70);
  });

  it("an offer line names its mix and its count in offers (no × 1)", async () => {
    const c = catalogueFile();
    c.tiers = { active: true, sizeId: "large", countries: [] }; /* no window: on */
    const { $, LM } = await bootPage({ url: "/checkout.html?country=OM", catalogue: c, cart: [{ sizeId: "trio", scentId: null, mix: ["oud", "oud", "amber"], qty: 2, scent: "3", size: "", price: 1 }] });
    expect(LM.tierOn("trio")).toBe(true);
    const m = $("#items").querySelector(".m")!.textContent!;
    expect(m).toBe(LM.lineLabel(LM.readCart()[0]).size + " · 2 عروض");
    expect(m).not.toMatch(/× 2$/);
  });
});

// from test-dirham.js (checkout price sites), test-fx.js (page OMR), test-v437.js (the FX line)
describe("currency marks and the amount due", () => {
  it("Oman: المبلغ المستحق carries the rial mark; no ≈ figure; #sumFx hidden; .same", async () => {
    const { $, LM } = await bootPage({ url: "/checkout.html?country=OM", cart: [LINE("oud", "large")] });
    expect($("#hlLocal").innerHTML).toBe(LM.moneyHTML(28));
    expect($("#hlLocal").innerHTML).toContain('class="omr"');
    expect($("#hlOmr").textContent).toBe("");
    expect($("#payHl").classList.contains("same")).toBe(true);
    expect($("#sumFx").hidden).toBe(true);
    expect($("#sumFxV").textContent).toBe("");
    for (const id of ["#sub", "#ship", "#total"]) expect($(id).innerHTML).toMatch(/class="omr"/);
  });

  it("elsewhere: the currency spelled out as text beside ≈ OMR; the phone's FX line says the same", async () => {
    const { $, LM } = await bootPage({ url: "/checkout.html?country=AE", cart: [LINE("oud", "large")] });
    expect($("#hlLocal").innerHTML).toBe("280 AED");
    expect($("#hlLocal").children.length).toBe(0);
    expect($("#hlOmr").textContent).toBe(LM.omr(280));
    expect($("#payHl").classList.contains("same")).toBe(false);
    expect($("#sumFx").hidden).toBe(false);
    expect($("#sumFxV").textContent).toBe("280 AED ≈ " + LM.omr(280));
    expect($("#total").innerHTML).toBe(LM.moneyHTML(280));
    expect($("#total").innerHTML).toMatch(/class="dh"/);
    expect($("#totalNote").textContent).toBe("جميع المدفوعات تخصم بالريال العماني");
  });

  it("a hostile currency code never reaches the parser through the amount due", async () => {
    const c = catalogueFile();
    marketOf(c, "QA").cur = "<img src=x onerror=alert(1)>";
    const { $ } = await bootPage({ url: "/checkout.html?country=QA", cart: [LINE("oud", "large")], catalogue: c });
    expect($("#hlLocal").querySelector("img")).toBe(null);
    expect($("#sumFxV").querySelector("img")).toBe(null);
    expect($("#total").innerHTML).not.toContain("<img");
  });
});

// from test-v405 (the notes beside the ways to pay), test-v437.js, test-cod-refusal.js (the button follows the market)
describe("the ways to pay", () => {
  it("the cash fee beside cash, مجانا beside the card, only while cash costs more and is offered", async () => {
    const { $, LM } = await bootPage({ url: "/checkout.html?country=OM", cart: [LINE("oud", "large")] });
    const codEm = document.querySelector('[data-pay="cod"] em') as HTMLElement;
    const cardEm = document.querySelector('[data-pay="card"] em') as HTMLElement;
    expect(codEm.innerHTML).toBe("+ " + LM.moneyHTML(1));
    expect(codEm.hidden).toBe(false);
    expect(cardEm.textContent).toBe("مجانا");
    expect(cardEm.hidden).toBe(false);
    LM.c = { ...LM.c, cod: 0 };
    W().lmOnCartChange!();
    expect([codEm.innerHTML, codEm.hidden, cardEm.hidden]).toEqual(["", true, true]);
    LM.c = { ...LM.c, cod: 1, codOn: false };
    W().lmOnCartChange!();
    expect(cardEm.hidden).toBe(true);
    expect($("#pays").classList.contains("no-cod")).toBe(true);
  });

  it("COD offered: shown and choosable; switched off: hidden, card re-chosen, no fee in the total; back on: shown", async () => {
    const { $, LM } = await bootPage({ url: "/checkout.html?country=AE", cart: [LINE("oud", "small")] });
    const cod = $('[data-pay="cod"]');
    expect(cod.hidden).toBe(false);
    cod.click();
    expect(cod.getAttribute("aria-checked")).toBe("true");
    expect($("#codRow").style.display).toBe("flex");
    expect(num($("#cod"))).toBe(10);
    LM.c = { ...LM.c, codOn: false };
    W().lmOnCartChange!();
    expect(cod.hidden).toBe(true);
    expect($('[data-pay="card"]').getAttribute("aria-checked")).toBe("true");
    expect($("#codRow").style.display).toBe("none");
    LM.c = { ...LM.c, codOn: true };
    W().lmOnCartChange!();
    expect(cod.hidden).toBe(false);
  });

  it("v315/AddPaymentInfo: each tap reports the method chosen", async () => {
    const { $ } = await bootPage({ url: "/checkout.html?country=OM", cart: [LINE("oud", "large")] });
    const seen: string[] = [];
    (window as unknown as Record<string, unknown>).LMPX = { addPaymentInfo: (p: string) => seen.push(p), purchase() {}, startCheckout() {} };
    $('[data-pay="cod"]').click();
    $('[data-pay="card"]').click();
    expect(seen).toEqual(["cod", "card"]);
  });
});

// from test-samples-free.js (the checkout page)
describe("samples do not count toward free delivery (page)", () => {
  it("boxes + samples past the threshold still pay delivery; the bar asks for what is really missing and says why", async () => {
    /* OM: freeOver 30, small 12, samples 1 → q = 2 boxes (24), m = 6 samples */
    const { $, LM } = await bootPage({ url: "/checkout.html?country=OM", cart: [LINE("oud", "small", 2), { scentId: "", sizeId: "samples", qty: 6, scent: "عينات", size: "", price: 1 }] });
    expect(LM.extraOf(LM.readCart()[1])!.countsFree).toBe(false);
    expect($("#ship").innerHTML).toBe(LM.moneyHTML(LM.ship()));
    expect(num($("#freeMsg"))).toBe(30 - 24);
    expect($("#freeMsg").innerHTML).toContain('<span class="free-note">العينات لا تُحتسب ضمن التوصيل المجاني</span>');
    expect($("#freeBar").classList.contains("free")).toBe(false);
    expect(num($("#total"))).toBe(24 + 6 + 3);
  });

  it("one more box: free, and the note gone; a short basket without samples has no note", async () => {
    const { $ } = await bootPage({ url: "/checkout.html?country=OM", cart: [LINE("oud", "small", 3), { scentId: "", sizeId: "samples", qty: 1, scent: "عينات", size: "", price: 1 }] });
    expect(text($("#ship"))).toBe("مجاني");
    expect($("#freeMsg").innerHTML).not.toContain("free-note");
    const p2 = await bootPage({ url: "/checkout.html?country=OM", cart: [LINE("oud", "small", 1)] });
    expect(p2.$("#freeMsg").innerHTML).not.toContain("free-note");
  });
});

// from test-v336-checkout.js (layout hold) and the summary's own repaint
describe("the page settles", () => {
  it("co-wait is lifted once the summary is drawn; an empty basket shows #empty (co-none lifted)", async () => {
    const { $ } = await bootPage({ url: "/checkout.html", cart: [LINE("oud", "large")] });
    expect(document.documentElement.className).toBe("pg2 pg3");
    expect(document.documentElement.style.getPropertyValue("--co-lines")).toBe("1");
    expect($("#items").children.length).toBe(1);
    const e = await bootPage({ url: "/checkout.html", cart: [] });
    expect(e.$("#co").style.display).toBe("none");
    expect(e.$("#empty").style.display).toBe("block");
    expect(document.documentElement.className).toBe("pg2 pg3");
    expect(e.$("#cartCount").hidden).toBe(true);
  });

  it("the summary's bin removes the line (and an emptied basket reloads the page)", async () => {
    const nav = stubNavigation();
    const { $ } = await bootPage({ url: "/checkout.html?country=OM", cart: [LINE("oud", "large"), LINE("amber", "large", 2)] });
    expect($("#cartCount").textContent).toBe("3");
    ($("#items").querySelector('[data-rm="0"]') as HTMLElement).click();
    expect(JSON.parse(sessionStorage.getItem("lm_cart")!).map((l: { scentId: string }) => l.scentId)).toEqual(["amber"]);
    expect($("#items").children.length).toBe(1);
    expect($("#cartCount").textContent).toBe("2");
    expect($("#items").querySelector('[data-rm="0"]')!.getAttribute("aria-label")).toBe("حذف");
    ($("#items").querySelector('[data-rm="0"]') as HTMLElement).click();
    expect(nav.reloads()).toBe(1);
  });

  it("the summary ages: re-drawn once a minute while shown", async () => {
    vi.useFakeTimers({ toFake: ["setInterval"] });
    const { $, LM } = await bootPage({ url: "/checkout.html?country=OM", cart: [LINE("oud", "large")] });
    LM.c = { ...LM.c, prices: { ...LM.c.prices, large: { now: 20, was: 32 } } };
    vi.advanceTimersByTime(60e3);
    await flush();
    expect(num($("#total"))).toBe(23);
    vi.useRealTimers();
  });

  it("#year is this year", async () => {
    const { $ } = await bootPage({ url: "/checkout.html", cart: [] });
    expect($("#year").textContent).toBe(String(new Date().getFullYear()));
  });
});
