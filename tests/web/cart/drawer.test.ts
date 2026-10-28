/**
 * The basket drawer and the "not available in your country" dialog (cart module), on the
 * product page and the checkout.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { bootPage, catalogueFile, LINE, marketOf, num, stubNavigation, text } from "../checkout/_page";
import type { Catalogue } from "../../../src/web/core/types";
import { G as W } from "../../../src/web/checkout/contracts";

afterEach(() => {
  vi.restoreAllMocks();
});
const $ = <E extends HTMLElement = HTMLElement>(s: string) => document.querySelector(s) as E;
const cart = () => JSON.parse(sessionStorage.getItem("lm_cart") || "[]") as Array<{ scentId: string; sizeId: string; qty: number }>;
const click = (s: string) => ($(s) as HTMLElement).click();
const home = (o: Parameters<typeof bootPage>[0] = {}) => bootPage({ page: "home", url: "/?country=OM", ...o });

// from test-cart-availability.js: OM sells both sizes; KW has the small box and amber sold out
function kwFixture(): Catalogue {
  const c = catalogueFile();
  const kw = marketOf(c, "KW");
  kw.sizes = c.sizes.map((z) => (z.id === "small" ? { ...z, soldOut: true } : { ...z }));
  kw.scents = c.scents.map((s) => (s.id === "amber" ? { ...s, soldOut: true } : { ...s }));
  c.offer = { ...c.offer!, id: "bundle", active: true, hours: 72, renew: "auto", sizeId: "small", countries: [] };
  return c;
}
const BASKET = [
  { scentId: "oud", scent: "عود", sizeId: "small", size: "صغير", price: 12, qty: 2 },
  { scentId: "oud", scent: "عود", sizeId: "large", size: "كبير", price: 25, qty: 1 },
];

describe("the drawer", () => {
  it("built once, hidden, a dialog named السلة; the icon opens it and focus goes to its close button", async () => {
    const p = await home({ cart: BASKET });
    const d = $("#drawer");
    expect(d.hidden).toBe(true);
    expect(d.querySelector(".drawer-panel")!.getAttribute("role")).toBe("dialog");
    expect(d.querySelector(".drawer-panel")!.getAttribute("aria-modal")).toBe("true");
    expect(d.querySelector(".drawer-panel")!.getAttribute("aria-label")).toBe("السلة");
    expect(d.querySelector(".drawer-x")!.getAttribute("aria-label")).toBe("إغلاق");
    expect($("#drawerPay").getAttribute("href")).toBe("checkout.html");
    $(".cart").focus();
    click(".cart");
    expect(d.hidden).toBe(false);
    expect(document.body.style.overflow).toBe("hidden");
    expect(document.activeElement).toBe(d.querySelector(".drawer-x"));
    const rows = d.querySelectorAll(".ci");
    expect(rows.length).toBe(2);
    expect(rows[1]!.querySelector(".ci-name")!.textContent).toBe(p.LM.lineLabel(p.LM.readCart()[1]).scent);
    expect(rows[1]!.querySelector(".ci-price")!.innerHTML).toBe(p.LM.moneyHTML(25));
    expect(rows[1]!.querySelector(".ci-meta")!.textContent).toBe(p.LM.lineLabel(p.LM.readCart()[1]).size);
    expect(rows[1]!.querySelector('[data-dec="1"]')!.getAttribute("aria-label")).toBe("إنقاص");
    expect(rows[1]!.querySelector('[data-inc="1"]')!.getAttribute("aria-label")).toBe("زيادة");
    expect(rows[1]!.querySelector('[data-del="1"]')!.getAttribute("aria-label")).toBe("حذف");
    expect(rows[1]!.querySelector(".thumb img")!.getAttribute("src")).toBe("assets/img/white-box-open-sm.jpg" + p.LM.v);
    expect($("#drawerTotal").innerHTML).toBe("(" + p.LM.moneyHTML(49) + ")");
    /* Escape closes it and focus returns to the opener */
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(d.hidden).toBe(true);
    expect(document.body.style.overflow).toBe("");
    expect(document.activeElement).toBe($(".cart"));
  });

  it("the veil and the ✕ close it; an empty basket says so and hides the foot", async () => {
    await home({ cart: [] });
    click(".cart");
    expect($("#drawerBody").innerHTML).toBe('<p class="drawer-empty">السلة فارغة</p>');
    expect($<HTMLElement>(".drawer-foot").style.display).toBe("none");
    click(".drawer-veil");
    expect($("#drawer").hidden).toBe(true);
    click(".cart");
    click(".drawer-x");
    expect($("#drawer").hidden).toBe(true);
  });

  it("+ / − / bin: the basket, the badge, the bar and lm:cart follow; focus stays on the twin, or the ✕", async () => {
    const p = await home({ cart: [LINE("oud", "large"), LINE("amber", "large", 2)] });
    let events = 0;
    window.addEventListener("lm:cart", () => events++);
    const ship = vi.fn();
    const real = W().lmShip!;
    W().lmShip = (x?: number) => {
      ship(x);
      real(x);
    };
    click(".cart");
    click('[data-inc="0"]');
    expect(cart().map((l) => l.qty)).toEqual([2, 2]);
    expect($("#cartCount").textContent).toBe("4");
    expect($("#cartCount").hidden).toBe(false);
    expect($(".cart").classList.contains("filled")).toBe(true);
    expect(document.activeElement!.getAttribute("data-inc")).toBe("0");
    expect(ship).toHaveBeenCalledWith(0);
    expect(events).toBe(1);
    click('[data-dec="1"]');
    expect(cart().map((l) => l.qty)).toEqual([2, 1]);
    click('[data-dec="1"]');
    expect(cart().length).toBe(1);
    expect(document.activeElement).toBe($(".drawer-x"));
    click('[data-del="0"]');
    expect(cart().length).toBe(0);
    expect($("#cartCount").hidden).toBe(true);
    expect($(".cart").classList.contains("filled")).toBe(false);
    expect($("#drawerBody").textContent).toBe("السلة فارغة");
    expect(num($("#cartCount"))).toBe(0);
    expect(p.LM.readCart()).toEqual([]);
  });

  it("+ stops at 20 and never cuts a line already above it; and at the shelf's room (LM.lineRoom)", async () => {
    const p = await home({ cart: [LINE("oud", "large", 19), LINE("amber", "large", 25)] });
    click(".cart");
    click('[data-inc="0"]');
    click('[data-inc="0"]');
    click('[data-inc="1"]');
    expect(cart().map((l) => l.qty)).toEqual([20, 25]);
    vi.spyOn(p.LM, "lineRoom").mockReturnValue(0);
    click('[data-dec="0"]');
    click('[data-inc="0"]');
    expect(cart()[0]!.qty).toBe(19);
  });

  it("a drawer drawn from an older basket (bfcache): a tap on a line no longer there changes nothing", async () => {
    await home({ cart: [LINE("oud", "large"), LINE("amber", "large")] });
    click(".cart");
    sessionStorage.setItem("lm_cart", JSON.stringify([LINE("oud", "large")]));
    click('[data-del="1"]');
    expect(cart().length).toBe(1);
    expect($("#drawerBody").querySelectorAll(".ci").length).toBe(1);
  });

  it("restored from the bfcache: an open drawer and the badge are redrawn from the basket as it is", async () => {
    await home({ cart: [LINE("oud", "large")] });
    click(".cart");
    sessionStorage.setItem("lm_cart", JSON.stringify([LINE("oud", "large"), LINE("amber", "large", 4)]));
    const ev = new Event("pageshow");
    Object.defineProperty(ev, "persisted", { value: true });
    window.dispatchEvent(ev);
    expect($("#drawerBody").querySelectorAll(".ci").length).toBe(2);
    expect($("#cartCount").textContent).toBe("5");
  });

  it("an off line: ci-off with its reason; with no price here the reason stands where the price would be; out of the total", async () => {
    const p = await home({ url: "/?country=SA", cart: [{ sizeId: "trio", scentId: null, mix: ["oud", "oud", "amber"], qty: 1, price: 1 }, LINE("lemon", "large")] });
    click(".cart");
    const off = $("#drawerBody").querySelectorAll(".ci")[0]!;
    expect(off.className).toBe("ci ci-off");
    expect(off.querySelector(".ci-price")!.innerHTML).toBe(p.LM.offWords(p.LM.readCart()[0]));
    expect(off.querySelector(".ci-meta")!.textContent).toBe(p.LM.lineLabel(p.LM.readCart()[0]).size);
    expect($("#drawerTotal").innerHTML).toBe("(" + p.LM.moneyHTML(250) + ")");
  });

  it("an off line that still has a price: the price, and the reason under it", async () => {
    const p = await home({ url: "/?country=KW", cart: BASKET, catalogue: kwFixture() });
    click(".cart");
    const off = $("#drawerBody").querySelectorAll(".ci")[0]!;
    expect(off.className).toBe("ci ci-off");
    expect(off.querySelector(".ci-price")!.innerHTML).toBe(p.LM.moneyHTML(10));
    expect(off.querySelector(".ci-meta")!.textContent).toBe(text(p.LM.offWords(p.LM.readCart()[0])));
    expect(text(off.querySelector(".ci-meta")!)).toBe("غير متوفر في بلدك");
  });

  it("a country change redraws an open drawer; lmCart.refresh too", async () => {
    const p = await home({ cart: [LINE("oud", "large")] });
    click(".cart");
    p.LM.setCountry("AE");
    expect($(".ci-price").innerHTML).toBe(p.LM.moneyHTML(250));
    p.LM.c = { ...p.LM.c, prices: { ...p.LM.c.prices, large: { now: 200, was: 320 } } };
    W().lmCart!.refresh();
    expect($(".ci-price").innerHTML).toBe(p.LM.moneyHTML(200));
  });

  it("an add-on line pictures its drawing; the summary's thumbnail and the drawer's are the same two kinds", async () => {
    const p = await home({ cart: [{ scentId: "", sizeId: "samples", qty: 1, scent: "عينات", size: "", price: 1 }, { scentId: "", sizeId: "burner", qty: 1, scent: "مبخرة", size: "", price: 6 }] });
    click(".cart");
    const rows = $("#drawerBody").querySelectorAll(".ci");
    expect(rows[0]!.querySelector(".thumb")!.className).toBe("thumb thumb-none");
    expect(rows[0]!.querySelector(".thumb")!.getAttribute("aria-hidden")).toBe("true");
    expect(rows[1]!.querySelector(".thumb img")!.getAttribute("src")).toBe("assets/img/burner-sm.jpg" + p.LM.v);
  });

  it("English: the drawer's words", async () => {
    await home({ url: "/en/?country=OM", english: true, cart: [LINE("oud", "large")] });
    click(".cart");
    expect($(".drawer-panel").getAttribute("aria-label")).toBe(window.LM_EN!["السلة"]);
    expect($(".drawer-note").textContent).toBe(window.LM_EN!["الشحن والضريبة تحسب عند الدفع"]);
    expect($("#drawerPay").textContent!.indexOf(String(window.LM_EN!["الدفع"]))).toBe(0);
  });
});

// from test-cart-availability.js
describe("not available in your country", () => {
  it("OM: nothing blocked; pay goes to the checkout", async () => {
    const nav = stubNavigation();
    await home({ cart: BASKET, catalogue: kwFixture() });
    click(".cart");
    click("#drawerPay");
    expect(nav.hrefs).toEqual(["checkout.html"]);
    expect($("#pop")).toBe(null);
  });

  it("KW: the small line flagged; pay stops and the dialog names the country and lists only it (as text)", async () => {
    const nav = stubNavigation();
    const p = await home({ url: "/?country=KW", cart: BASKET, catalogue: kwFixture() });
    expect(p.LM.blockedLines(p.LM.readCart()).length).toBe(1);
    click(".cart");
    const rows = $("#drawerBody").querySelectorAll(".ci");
    expect([rows[0]!.className, rows[1]!.className]).toEqual(["ci ci-off", "ci"]);
    expect(rows[0]!.textContent).toContain("غير متوفر في بلدك");
    $("#drawerPay").focus(); /* a click focuses a link in a browser */
    click("#drawerPay");
    expect(nav.hrefs).toEqual([]);
    const pop = $("#pop");
    expect(pop.hidden).toBe(false);
    expect(pop.className).toBe("avail-pop");
    expect(pop.querySelector(".avail-panel")!.getAttribute("role")).toBe("alertdialog");
    expect($("#popTitle").textContent).toBe("غير متوفر في بلدك");
    expect($("#popMsg").textContent).toBe("لا يمكننا شحن هذه المنتجات إلى الكويت حاليا:");
    const li = $("#popList").querySelectorAll("li");
    expect(li.length).toBe(1);
    expect(li[0]!.textContent).toContain("صغير");
    expect(li[0]!.children.length).toBe(0);
    expect(document.activeElement).toBe(pop.querySelector("[data-pop-drop]"));
    expect(document.body.style.overflow).toBe("hidden");
    /* Escape closes the dialog only; the drawer stays, with its lock */
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(pop.hidden).toBe(true);
    expect($("#drawer").hidden).toBe(false);
    expect(document.body.style.overflow).toBe("hidden");
    expect(document.activeElement).toBe($("#drawerPay"));
  });

  it("the drop action keeps only what sells here, closes, redraws, tells the checkout", async () => {
    stubNavigation();
    await home({ url: "/?country=KW", cart: BASKET, catalogue: kwFixture() });
    let told = 0;
    W().lmOnCartChange = () => void told++;
    click(".cart");
    click("#drawerPay");
    click("[data-pop-drop]");
    expect(cart().map((l) => l.sizeId)).toEqual(["large"]);
    expect($("#pop").hidden).toBe(true);
    expect($("#drawerBody").querySelectorAll(".ci").length).toBe(1);
    expect($("#cartCount").textContent).toBe("1");
    expect(told).toBe(2); /* sync() and the dialog's own hand-off, as the original */
    /* the basket is clear now: pay goes through */
    expect(W().lmCart!.warn()).toBe(true);
  });

  it("every blocked line an ended offer: 'انتهى العرض'; mixed: the ended one carries its own reason", async () => {
    const c = kwFixture();
    c.offer = { ...c.offer!, active: false };
    await home({ url: "/?country=OM", cart: [{ scentId: "bundle", sizeId: "bundle", qty: 1, price: 1 }], catalogue: c });
    expect(W().lmCart!.warn()).toBe(false);
    expect($("#popTitle").textContent).toBe("انتهى العرض");
    expect($("#popMsg").textContent).toBe("انتهى العرض على هذه المنتجات:");
    await home({ url: "/?country=KW", cart: [{ scentId: "bundle", sizeId: "bundle", qty: 1, price: 1 }, ...BASKET], catalogue: c });
    expect(W().lmCart!.warn()).toBe(false);
    expect($("#popTitle").textContent).toBe("غير متوفر في بلدك");
    const li = Array.prototype.map.call($("#popList").querySelectorAll("li"), (x: HTMLElement) => x.textContent) as string[];
    expect(li[0]!.endsWith(" · انتهى العرض")).toBe(true);
    click("[data-pop-close]");
    expect($("#pop").hidden).toBe(true);
    expect(document.body.style.overflow).toBe("");
  });

  it("the checkout's submit asks warn() before it builds the order", async () => {
    stubNavigation();
    const p = await bootPage({ url: "/checkout.html?country=KW", cart: BASKET, catalogue: kwFixture() });
    expect($("#items").children[0]!.className).toBe("sum-item sum-off");
    const { fillValid, submit } = await import("../checkout/_page");
    fillValid({ phone: "51234567" });
    submit();
    expect($("#pop").hidden).toBe(false);
    expect(p.posts("/api/pay/session").length + p.posts("/api/order").length).toBe(0);
    click("[data-pop-drop]");
    expect($("#items").children.length).toBe(1);
  });
});
