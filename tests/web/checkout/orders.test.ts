/**
 * The order leaving the page: the cash till (POST /api/order, refusals, the parked queue),
 * the card till (POST /api/pay/session → the gateway), the Netlify Forms copy, the pixels'
 * hand-offs, the refusal words, stock_short's one-tap fix, bfcache (checkout module).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { bootPage, fillValid, flush, json, LINE, stubNavigation, submit, tick } from "./_page";
import { G as W } from "../../../src/web/checkout/contracts";

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});
const $ = <E extends HTMLElement = HTMLElement>(s: string) => document.querySelector(s) as E;

type Answer = (url: string, init?: RequestInit) => Response | Promise<Response> | null;
interface Spies {
  purchases: unknown[][];
  events: unknown[][];
  started: number;
}
function pixels(): Spies {
  const s: Spies = { purchases: [], events: [], started: 0 };
  (window as unknown as Record<string, unknown>).LMPX = {
    purchase: (o: unknown, j: unknown) => s.purchases.push([JSON.parse(JSON.stringify(o)), j]),
    startCheckout: () => void s.started++,
    signals: () => ({ sc: "cookie" }),
    landing: () => ({ src: "ig" }),
  };
  (window as unknown as Record<string, unknown>).LMEV = { track: (...a: unknown[]) => s.events.push(a) };
  return s;
}

async function cashPage(answer: Answer, o: { url?: string; cart?: unknown[]; phone?: string } = {}) {
  const nav = stubNavigation();
  const p = await bootPage({ url: o.url || "/checkout.html?country=OM", cart: (o.cart as never) || [LINE("oud", "large")], answer });
  const spies = pixels();
  fillValid({ phone: o.phone });
  $('[data-pay="cod"]').click();
  return { ...p, nav, spies };
}
const order = (status: number, body: unknown): Answer => (url) => (url === "/api/order" ? json(body, { status }) : null);

// from test-cod-refusal.js, test-v336-checkout.js, test-v427.js, test-extras.js, test-fx.js
describe("a cash order", () => {
  it("posts one order the till can read; the button says so while it waits; the done screen shows the till's number", async () => {
    let release!: (r: Response) => void;
    const p = await cashPage((url) => (url === "/api/order" ? new Promise<Response>((r) => (release = r)) : null), {
      cart: [LINE("oud", "large", 2), { scentId: "", sizeId: "burner", qty: 1, scent: "مبخرة", size: "مبخرة معدنية", price: 6 }],
    });
    submit();
    expect($<HTMLButtonElement>("#confirm").disabled).toBe(true);
    expect($("#confirm").textContent).toBe("جار تأكيد طلبك…");
    expect($("#confirm").classList.contains("ok-go")).toBe(true);
    const sent = p.posts("/api/order");
    expect(sent.length).toBe(1);
    const o = sent[0]!.body.order;
    expect(o.id).toMatch(/^LM-\d{10}$/);
    expect(new Date(o.date).toISOString()).toBe(o.date);
    expect([o.name, o.email, o.phone, o.country, o.countryCode, o.city, o.region, o.note, o.pay]).toEqual(["سارة الهاشمي", "", "+968 91234567", "عمان", "OM", "مسقط", "الخوير", "", "cod"]);
    expect(o.items).toEqual([
      { scent: "oud", size: "large", price: 25, qty: 2, itemId: "oud-large" },
      { scent: "مبخرة", size: "مبخرة معدنية", price: 6, qty: 1, itemId: "burner" },
    ]);
    expect([o.cur, o.ship, o.codFee, o.total, o.omr, o.omrRate]).toEqual(["OMR", 0, 1, 57, 57, 1]);
    expect(typeof o.dedupeId).toBe("string");
    expect(o.dedupeId.length > 8).toBe(true);
    expect([o.snap, o.ref, o.lang, o.status]).toEqual([{ sc: "cookie" }, { src: "ig" }, "ar", "new"]);
    expect(o.pageUrl).toBe(location.href);
    /* nothing is claimed before the till answers */
    expect(p.spies.purchases.length).toBe(0);
    expect($("#done").style.display).toBe("none");
    release(json({ ok: true, id: "LM-7000000042", omr: 56.5 }));
    await flush();
    expect($("#orderNo").textContent).toBe("LM-7000000042");
    expect($("#doneHead").textContent).toBe("تم استلام طلبك");
    expect($("#co").style.display).toBe("none");
    expect($("#done").style.display).toBe("block");
    expect(sessionStorage.getItem("lm_cart")).toBe(null);
    expect($("#cartCount").hidden).toBe(true);
    /* the pixels' copy under the till's id and total; the stats event; the Forms copy */
    expect(p.spies.purchases.length).toBe(1);
    expect((p.spies.purchases[0]![0] as { id: string; omr: number }).id).toBe("LM-7000000042");
    expect((p.spies.purchases[0]![0] as { omr: number }).omr).toBe(56.5);
    expect(p.spies.purchases[0]![1]).toEqual({ ok: true, id: "LM-7000000042", omr: 56.5 });
    expect(p.spies.events).toEqual([["order_placed", "cod"]]);
    const forms = p.calls.filter((c) => c.url === "/");
    expect(forms.length).toBe(1);
    expect(forms[0]!.init!.method).toBe("POST");
    expect((forms[0]!.init!.headers as Record<string, string>)["Content-Type"]).toBe("application/x-www-form-urlencoded");
    const f = new URLSearchParams(String(forms[0]!.init!.body));
    expect([...f.keys()]).toEqual(["form-name", "id", "date", "name", "phone", "email", "country", "city", "region", "note", "pay", "items", "total", "charged"]);
    expect([f.get("form-name"), f.get("id"), f.get("pay"), f.get("items"), f.get("total"), f.get("charged")]).toEqual([
      "orders", "LM-7000000042", "الدفع عند الاستلام", "oud large ×2 | مبخرة مبخرة معدنية ×1", "57 OMR", "56.5 OMR",
    ]);
    /* (v336) the receipts nothing read are not written */
    expect(localStorage.getItem("lm_orders")).toBe(null);
    expect(sessionStorage.getItem("lm_last")).toBe(null);
  });

  it("an answer without a well-formed id keeps the page's id; a non-positive omr keeps the page's figure", async () => {
    const p = await cashPage(order(200, { ok: true, id: "<b>", omr: 0 }));
    submit();
    await flush();
    const sent = p.posts("/api/order")[0]!.body.order;
    expect($("#orderNo").textContent).toBe(sent.id);
    expect((p.spies.purchases[0]![0] as { omr: number }).omr).toBe(sent.omr);
  });

  it("AE: the OMR figure is the till's rounding of total × rate", async () => {
    const p = await cashPage(order(200, { ok: true }), { url: "/checkout.html?country=AE", phone: "501234567" });
    submit();
    await flush();
    const o = p.posts("/api/order")[0]!.body.order;
    expect([o.total, o.omrRate, o.omr]).toEqual([290, 0.1047, Math.round(290 * 0.1047 * 1000) / 1000]);
  });

  it("an older build's receipts (lm_orders, lm_last) are removed on load", async () => {
    localStorage.setItem("lm_orders", "[1]");
    await bootPage({ url: "/checkout.html", cart: [LINE("oud", "large")], session: { lm_last: "{}" }, local: { lm_orders: "[1]" } });
    expect(localStorage.getItem("lm_orders")).toBe(null);
    expect(sessionStorage.getItem("lm_last")).toBe(null);
  });
});

describe("a refusal is not a sale (test-cod-refusal.js)", () => {
  it("400 cod_not_offered: posted once, no done screen, nothing parked, the reason, the button back as ادفع الآن", async () => {
    const p = await cashPage(order(400, { ok: false, error: "cod_not_offered" }));
    submit();
    await flush();
    expect(p.posts("/api/order").length).toBe(1);
    expect($("#done").style.display).toBe("none");
    expect($("#co").style.display).toBe("");
    expect(localStorage.getItem("lm_order_queue")).toBe(null);
    expect($("#payMsg").textContent).toBe("الدفع عند الاستلام غير متاح في بلدك. اختر الدفع بالبطاقة.");
    expect($("#payMsg").hidden).toBe(false);
    expect($<HTMLButtonElement>("#confirm").disabled).toBe(false);
    expect($("#confirm").textContent).toBe("ادفع الآن");
    expect($("#confirm").classList.contains("bad")).toBe(true);
    expect(p.spies.purchases.length + p.spies.events.length).toBe(0);
    expect(p.calls.filter((c) => c.url === "/").length).toBe(0);
  });

  it("every code the tills name has its own words", async () => {
    const words: Record<string, string> = {
      gateway_not_configured: "بوابة الدفع غير مهيأة بعد. اختر الدفع عند الاستلام أو راسلنا.",
      amount_too_small: "المبلغ أقل من الحد المسموح للدفع بالبطاقة.",
      incomplete: "تأكد من إكمال بياناتك.",
      unavailable_here: "أحد المنتجات في سلتك غير متوفر في بلدك. احذفه وأعد المحاولة.",
      unknown_item: "أحد المنتجات في سلتك لم يعد متاحا. احذفه وأعد المحاولة.",
      offer_closed: "انتهى عرض الباقة. احذفها من السلة وأعد المحاولة.",
      unpriced_item: "أحد المنتجات في سلتك غير مسعّر لبلدك. احذفه وأعد المحاولة.",
      stock_short: "الكمية المتوفرة أقل مما في سلتك. قلّل الكمية وأعد المحاولة.",
      unknown_country: "اختر بلدك من القائمة وأعد المحاولة.",
      too_many: "الكمية أكبر من المسموح لطلب واحد. قلّلها أو راسلنا على واتساب.",
      bad_qty: "تعذر إتمام الطلب. جرب مرة أخرى أو راسلنا على واتساب.",
    };
    for (const code of Object.keys(words)) {
      await cashPage(order(code === "stock_short" ? 409 : 400, { ok: false, error: code }));
      submit();
      await flush();
      expect($("#payMsg").textContent, code).toBe(words[code]);
      expect(localStorage.getItem("lm_order_queue"), code).toBe(null);
    }
  });

  it("gateway_not_configured where cash is off: no cash suggested", async () => {
    const p = await cashPage(order(400, { ok: false, error: "gateway_not_configured" }));
    p.LM.c = { ...p.LM.c, codOn: false };
    submit();
    await flush();
    expect($("#payMsg").textContent).toBe("بوابة الدفع غير مهيأة بعد. راسلنا على واتساب.");
  });

  it("after a refusal the summary is repainted (what was refused may have changed); the red shake clears", async () => {
    /* the market changes while the order is out (the drawer's dialog would stop it before) */
    const p = await cashPage((url) => {
      if (url !== "/api/order") return null;
      window.LM.c = { ...window.LM.c, scents: window.LM.listFor("scents").map((s) => ({ ...s, soldOut: s.id === "oud" })) };
      return json({ ok: false, error: "unavailable_here", item: "oud-large" }, { status: 400 });
    });
    submit();
    await flush();
    expect($("#items").children[0]!.className).toBe("sum-item sum-off");
    expect($("#confirm").classList.contains("bad")).toBe(true);
    await tick(1850);
    expect($("#confirm").classList.contains("bad")).toBe(false);
  });
});

// from test-cod-refusal.js (the wire drops), test-v336-checkout.js §5, test-v329 (429 queued)
describe("the wire drops: the order is parked and the shopper told it is received", () => {
  for (const [label, answer] of [
    ["network", ((url: string) => (url === "/api/order" ? Promise.reject(new TypeError("Failed to fetch")) : null)) as Answer],
    ["502 db_write_failed", order(502, { ok: false, error: "db_write_failed" })],
    ["503", order(503, { ok: false, error: "db_write_failed" })],
    ["429", order(429, { ok: false, error: "rate_limited" })],
    ["200 without ok", order(200, { nope: 1 })],
    ["4xx without a named error", order(400, { ok: false })],
  ] as Array<[string, Answer]>) {
    it(label, async () => {
      const p = await cashPage(answer);
      submit();
      await flush(10);
      const q = JSON.parse(localStorage.getItem("lm_order_queue") || "[]");
      expect(q.length).toBe(1);
      expect(q[0].id).toBe(p.posts("/api/order")[0]!.body.order.id);
      expect($("#done").style.display).toBe("block");
      expect($("#doneHead").textContent).toBe("استلمنا طلبك وسنؤكده قريبًا");
      /* its Purchase waits for the till (LM.flushOrders fires it); the Forms copy and the stats event go now */
      expect(p.spies.purchases.length).toBe(0);
      expect(p.spies.events).toEqual([["order_placed", "cod"]]);
      expect(p.calls.filter((c) => c.url === "/").length).toBe(1);
      expect(window.name).not.toContain("lm_order_queue");
    });
  }

  it("the checkout flushes the queue on load (after its own work)", async () => {
    let posted = 0;
    await bootPage({
      url: "/checkout.html?country=OM",
      cart: [LINE("oud", "large")],
      local: { lm_order_queue: JSON.stringify([{ id: "LM-1234567890", omr: 5, items: [] }]) },
      answer: (url) => (url === "/api/order" ? (posted++, json({ ok: true, id: "LM-1234567890", omr: 5 })) : null),
    });
    await flush(10);
    expect(posted).toBe(1);
    expect(localStorage.getItem("lm_order_queue")).toBe(null);
  });
});

// from test-v336-checkout.js §4, test-v211.js
describe("stock_short: named, marked, one tap to fix", () => {
  const short = (left: number, item = "oud-large") => order(409, { ok: false, error: "stock_short", item, left });
  it("left 1: the name (not the id), the line marked, 'اجعلها 1' sets the qty and lifts the message; the shelf re-read", async () => {
    const p = await cashPage(short(1), { cart: [LINE("oud", "large", 3), LINE("amber", "large")] });
    const stock = vi.spyOn(p.LM, "loadStock");
    submit();
    await flush();
    const nm = p.LM.lineLabel(p.LM.readCart()[0]);
    expect($("#payMsg").firstChild!.textContent).toBe("بقي 1 فقط من " + nm.scent + " " + nm.size + ".");
    expect($("#payMsg").childNodes[1]!.textContent).toBe(" ");
    expect($("#items").children[0]!.className).toBe("sum-item sum-short");
    expect($("#items").children[1]!.className).toBe("sum-item");
    const fix = $("#payMsg").querySelector(".pm-fix") as HTMLButtonElement;
    expect([fix.tagName, fix.type, fix.textContent]).toEqual(["BUTTON", "button", "اجعلها 1"]);
    expect(stock).toHaveBeenCalledTimes(1);
    fix.click();
    expect(JSON.parse(sessionStorage.getItem("lm_cart")!)[0].qty).toBe(1);
    expect($("#payMsg").hidden).toBe(true);
    expect($("#items").children[0]!.className).toBe("sum-item");
    expect($("#cartCount").textContent).toBe("2");
  });

  it("left 0: 'نفدت الكمية من …' and 'احذفه من السلة' removes the line", async () => {
    await cashPage(short(0), { cart: [LINE("oud", "large", 3), LINE("amber", "large")] });
    submit();
    await flush();
    expect($("#payMsg").firstChild!.textContent).toMatch(/^نفدت الكمية من .+\.$/);
    const fix = $("#payMsg").querySelector(".pm-fix") as HTMLButtonElement;
    expect(fix.textContent).toBe("احذفه من السلة");
    fix.click();
    expect(JSON.parse(sessionStorage.getItem("lm_cart")!).map((l: { scentId: string }) => l.scentId)).toEqual(["amber"]);
  });

  it("a box held only inside the set: named from its id, no button, 'عدّل سلتك وأعد المحاولة.'", async () => {
    const p = await cashPage(short(1, "lemon-small"), { cart: [{ scentId: "bundle", sizeId: "bundle", qty: 2, price: 1 }] });
    submit();
    await flush();
    const nm = p.LM.lineLabel({ scentId: "lemon", sizeId: "small" } as never);
    expect($("#payMsg").textContent).toBe("بقي 1 فقط من " + nm.scent + " " + nm.size + ". عدّل سلتك وأعد المحاولة.");
    expect($("#payMsg").querySelector(".pm-fix")).toBe(null);
  });

  it("the card till carries item and left too; a fresh submit lifts the mark", async () => {
    stubNavigation();
    const p = await bootPage({
      url: "/checkout.html?country=OM",
      cart: [LINE("oud", "large", 3)],
      answer: (url) => (url === "/api/pay/session" ? json({ ok: false, error: "stock_short", item: "oud-large", left: 2 }, { status: 409 }) : null),
    });
    fillValid();
    submit();
    await flush();
    expect($("#payMsg").querySelector(".pm-fix")!.textContent).toBe("اجعلها 2");
    expect($("#items").children[0]!.className).toBe("sum-item sum-short");
    expect($("#payWait").hidden).toBe(true);
    expect($("#confirm").textContent).toBe("ادفع الآن");
    expect(p.posts("/api/pay/session").length).toBe(1);
  });
});

// from test-v443.js, test-v444.js, test-v336-checkout.js §9, test-i18n (lang on the order)
describe("a card order", () => {
  it("label → the countdown → POST /api/pay/session; the pending copy (with the session id); straight to the gateway", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    let release!: (r: Response) => void;
    const nav = stubNavigation();
    const p = await bootPage({
      url: "/checkout.html?country=OM",
      cart: [LINE("oud", "large")],
      answer: (url) => (url === "/api/pay/session" ? new Promise<Response>((r) => (release = r)) : null),
    });
    pixels();
    fillValid();
    submit();
    expect($("#confirm").textContent).toBe("جار تحويلك للدفع…");
    expect($<HTMLButtonElement>("#confirm").disabled).toBe(true);
    expect($("#confirm").classList.contains("ok-go")).toBe(false);
    expect($("#payWait").hidden).toBe(false);
    expect($("#payWaitN").textContent).toBe("15");
    vi.advanceTimersByTime(3000);
    expect($("#payWaitN").textContent).toBe("12");
    const sent = p.posts("/api/pay/session");
    expect(sent.length).toBe(1);
    expect(sent[0]!.body.order.pay).toBe("card");
    expect(sent[0]!.body.order.codFee).toBe(0);
    expect(JSON.parse(sessionStorage.getItem("lm_pending")!).id).toBe(sent[0]!.body.order.id);
    release(json({ ok: true, url: "https://uatcheckout.thawani.om/pay/sess_1?key=k", session_id: "sess_1" }));
    await flush();
    expect(nav.hrefs).toEqual(["https://uatcheckout.thawani.om/pay/sess_1?key=k"]);
    expect(JSON.parse(sessionStorage.getItem("lm_pending")!).sid).toBe("sess_1");
    /* the basket stays until the gateway says paid */
    expect(sessionStorage.getItem("lm_cart")).not.toBe(null);
    /* the count runs to zero and stops */
    vi.advanceTimersByTime(30000);
    expect($("#payWaitN").textContent).toBe("0");
  });

  it("a refusal stops the countdown and puts the button back; 429 rests the button for Retry-After (5–120 s)", async () => {
    for (const [ra, wait] of [["30", 30], [null, 60], ["1", 5], ["999", 120]] as const) {
      await bootPage({
        url: "/checkout.html?country=OM",
        cart: [LINE("oud", "large")],
        answer: (url) => (url === "/api/pay/session" ? json({ ok: false, error: "rate_limited" }, { status: 429, headers: ra ? { "Retry-After": ra } : {} }) : null),
      });
      fillValid();
      vi.useFakeTimers({ toFake: ["setTimeout", "setInterval", "clearInterval"] });
      submit();
      for (let i = 0; i < 5; i++) await vi.advanceTimersByTimeAsync(0);
      expect($("#payWait").hidden).toBe(true);
      expect($("#payMsg").textContent).toBe("محاولات كثيرة الآن. جرب مرة أخرى بعد دقيقة.");
      expect($<HTMLButtonElement>("#confirm").disabled, String(ra)).toBe(true);
      await vi.advanceTimersByTimeAsync(wait * 1000 - 100);
      expect($<HTMLButtonElement>("#confirm").disabled, String(ra)).toBe(true);
      await vi.advanceTimersByTimeAsync(200);
      expect($<HTMLButtonElement>("#confirm").disabled, String(ra)).toBe(false);
      expect($("#confirm").textContent).toBe("ادفع الآن");
      vi.useRealTimers();
    }
  });

  it("an unreadable answer or a dropped wire: the general words (http_<status> is not a code)", async () => {
    await bootPage({ url: "/checkout.html?country=OM", cart: [LINE("oud", "large")], answer: (url) => (url === "/api/pay/session" ? new Response("<html>", { status: 502 }) : null) });
    fillValid();
    submit();
    await flush();
    expect($("#payMsg").textContent).toBe("تعذر إتمام الطلب. جرب مرة أخرى أو راسلنا على واتساب.");
    expect($<HTMLButtonElement>("#confirm").disabled).toBe(false);
  });

  it("an English page sends lang en", async () => {
    stubNavigation();
    const p = await bootPage({ url: "/en/checkout.html?country=OM", english: true, cart: [LINE("oud", "large")], answer: (u) => (u === "/api/pay/session" ? json({ ok: false, error: "x" }, { status: 400 }) : null) });
    fillValid();
    submit();
    await flush();
    expect(p.posts("/api/pay/session")[0]!.body.order.lang).toBe("en");
    expect($("#confirm").textContent).toBe("Pay now");
  });
});

// from test-v202.js (bfcache), test-v336-checkout.js
describe("back/forward cache and baskets changed elsewhere", () => {
  it("restored: the button re-enabled as ادفع الآن, the countdown hidden, the basket re-read", async () => {
    stubNavigation();
    await bootPage({ url: "/checkout.html?country=OM", cart: [LINE("oud", "large")], answer: (u) => (u === "/api/pay/session" ? new Promise<Response>(() => {}) : null) });
    fillValid();
    submit();
    expect($<HTMLButtonElement>("#confirm").disabled).toBe(true);
    sessionStorage.setItem("lm_cart", JSON.stringify([LINE("oud", "large", 3)]));
    const ev = new Event("pageshow") as Event & { persisted: boolean };
    Object.defineProperty(ev, "persisted", { value: true });
    window.dispatchEvent(ev);
    expect($<HTMLButtonElement>("#confirm").disabled).toBe(false);
    expect($("#confirm").textContent).toBe("ادفع الآن");
    expect($("#confirm").className).toBe("btn btn-go");
    expect($("#payWait").hidden).toBe(true);
    expect($("#cartCount").textContent).toBe("3");
  });

  it("restored with the form gone or the basket emptied: reload; a plain pageshow does nothing", async () => {
    const nav = stubNavigation();
    await bootPage({ url: "/checkout.html?country=OM", cart: [LINE("oud", "large")] });
    window.dispatchEvent(new Event("pageshow"));
    expect(nav.reloads()).toBe(0);
    sessionStorage.setItem("lm_cart", "[]");
    const ev = new Event("pageshow");
    Object.defineProperty(ev, "persisted", { value: true });
    window.dispatchEvent(ev);
    expect(nav.reloads()).toBe(1);
  });

  it("the drawer emptying the basket on this page reloads it; changing it repaints", async () => {
    const nav = stubNavigation();
    await bootPage({ url: "/checkout.html?country=OM", cart: [LINE("oud", "large")] });
    sessionStorage.setItem("lm_cart", JSON.stringify([LINE("oud", "large", 4)]));
    W().lmOnCartChange!();
    expect($("#cartCount").textContent).toBe("4");
    sessionStorage.setItem("lm_cart", "[]");
    W().lmOnCartChange!();
    expect(nav.reloads()).toBe(1);
  });

  it("the funnel: InitiateCheckout once the page is ready; not on a return from the gateway", async () => {
    let started = 0;
    const setup = () => {
      (window as unknown as Record<string, unknown>).LMPX = { startCheckout: () => void started++, purchase() {} };
    };
    await bootPage({ url: "/checkout.html?country=OM", cart: [LINE("oud", "large")], setup });
    expect(started).toBe(1);
    await bootPage({ url: "/checkout.html?cancelled=LM-1234567890", cart: [], setup });
    expect(started).toBe(1);
  });
});
