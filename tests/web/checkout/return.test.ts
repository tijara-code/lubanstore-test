/**
 * Back from Thawani (checkout module handleReturn): ?paid= is only a hint, the server's
 * verify decides; "could not check" is never "not paid"; ?cancelled=; the panel for a tab
 * with no basket.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { bootPage, flush, json, LINE, stubNavigation } from "./_page";

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});
const $ = <E extends HTMLElement = HTMLElement>(s: string) => document.querySelector(s) as E;
const ID = "LM-9990001235";
const PENDING = { id: "LM-1111111111", sid: "sess_9", omr: 28, total: 28, cur: "OMR", pay: "card", name: "سارة", phone: "+968 91234567", email: "", country: "عمان", city: "مسقط", region: "x", note: "", date: "2026-10-01T05:00:00.000Z", items: [{ scent: "عود", size: "كبير", qty: 1, price: 25, itemId: "oud-large" }] };

interface Seen {
  purchases: unknown[][];
  events: unknown[][];
  verifies: string[];
}
async function back(query: string, answers: Array<Response | "network">, o: { cart?: boolean; pending?: boolean; gate?: boolean } = {}) {
  const seen: Seen = { purchases: [], events: [], verifies: [] };
  let open: (() => void) | null = null;
  const gate = o.gate ? new Promise<void>((r) => (open = r)) : null;
  stubNavigation();
  const p = await bootPage({
    url: "/checkout.html" + query,
    cart: o.cart === false ? [] : [LINE("oud", "large")],
    session: o.pending === false ? {} : { lm_pending: JSON.stringify(PENDING) },
    coHold: true,
    setup: () => {
      (window as unknown as Record<string, unknown>).LMPX = { purchase: (a: unknown, b: unknown) => seen.purchases.push([a, b]), startCheckout() {} };
      (window as unknown as Record<string, unknown>).LMEV = { track: (...a: unknown[]) => seen.events.push(a) };
    },
    answer: (url) => {
      if (url.indexOf("/api/pay/verify") !== 0) return null;
      seen.verifies.push(url);
      const a = answers[Math.min(seen.verifies.length - 1, answers.length - 1)]!;
      const make = () => (a === "network" ? Promise.reject(new TypeError("Failed to fetch")) : Promise.resolve(a.clone()));
      return (gate && seen.verifies.length === 1 ? gate.then(make) : make()) as Promise<Response>;
    },
  });
  return { ...p, seen, open: () => open && open() };
}

// from test-v336-checkout.js §2/§9, test-resilience.js, test-v314.js (the verify sends sid), test-v443.js
describe("?paid=: the verify decides", () => {
  it("paid: the done screen under the URL's id, the pixels' copy at the charged figure, stats, the Forms copy, the pending copy gone", async () => {
    const p = await back("?paid=" + ID, [json({ ok: true, paid: true, id: ID, amount_omr: 26.175 })]);
    await flush();
    expect(p.seen.verifies).toEqual(["/api/pay/verify?ref=" + ID + "&sid=sess_9"]);
    expect(p.calls.find((c) => c.url.indexOf("/api/pay/verify") === 0)!.init).toEqual({ cache: "no-store" });
    expect($("#done").style.display).toBe("block");
    expect($("#verifying").style.display).toBe("none");
    expect($("#orderNo").textContent).toBe(ID);
    expect(location.search).toBe("");
    expect(sessionStorage.getItem("lm_pending")).toBe(null);
    expect(sessionStorage.getItem("lm_cart")).toBe(null);
    expect(p.seen.purchases.length).toBe(1);
    expect((p.seen.purchases[0]![0] as { id: string; omr: number }).id).toBe(ID);
    expect((p.seen.purchases[0]![0] as { omr: number }).omr).toBe(26.175);
    expect(p.seen.events).toEqual([["order_placed", "card"]]);
    const f = new URLSearchParams(String(p.calls.find((c) => c.url === "/")!.init!.body));
    expect([f.get("id"), f.get("pay"), f.get("charged")]).toEqual([ID, "بطاقة الخصم المباشر", "26.175 OMR"]);
    expect(document.documentElement.className).toBe("pg2 pg3");
  });

  it("paid, `already` (the webhook was first): the pixels' copy still goes, the stats event does not", async () => {
    const p = await back("?paid=" + ID, [json({ ok: true, paid: true, id: ID, already: true })]);
    await flush();
    expect(p.seen.purchases.length).toBe(1);
    expect(p.seen.events).toEqual([]);
  });

  it("paid with no pending copy (another browser): the done screen with the id; nothing claimed", async () => {
    const p = await back("?paid=" + ID, [json({ ok: true, paid: true, id: ID })], { pending: false, cart: false });
    await flush();
    expect(p.seen.verifies).toEqual(["/api/pay/verify?ref=" + ID]);
    expect($("#orderNo").textContent).toBe(ID);
    expect(p.seen.purchases.length).toBe(0);
    expect(p.calls.filter((c) => c.url === "/").length).toBe(0);
  });

  it("while it asks: the form gives way to #verifying (the head's co-back/co-paid lifted once drawn)", async () => {
    const p = await back("?paid=" + ID, [json({ ok: true, paid: true, id: ID })], { gate: true });
    expect($("#co").style.display).toBe("none");
    expect($("#verifying").style.display).toBe("block");
    p.open();
    await flush();
    expect($("#done").style.display).toBe("block");
  });

  it("unsure (db_read_failed, gateway_error, an error-less answer, the wire): retried, 4 tries in all, 1.5 s × tries apart; then 'do not pay again' with the order number, the pending copy kept", async () => {
    for (const a of [json({ ok: false, error: "db_read_failed" }, { status: 502 }), json({ ok: false, error: "gateway_error" }, { status: 502 }), json({ ok: false }, { status: 500 }), "network" as const]) {
      const p = await back("?paid=" + ID, [a], { gate: true });
      vi.useFakeTimers({ toFake: ["setTimeout"] });
      p.open();
      for (let i = 0; i < 6; i++) await vi.advanceTimersByTimeAsync(0);
      expect(p.seen.verifies.length).toBe(1);
      await vi.advanceTimersByTimeAsync(1499);
      expect(p.seen.verifies.length).toBe(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(p.seen.verifies.length).toBe(2);
      await vi.advanceTimersByTimeAsync(3000);
      expect(p.seen.verifies.length).toBe(3);
      await vi.advanceTimersByTimeAsync(4500);
      for (let i = 0; i < 6; i++) await vi.advanceTimersByTimeAsync(0);
      expect(p.seen.verifies.length).toBe(4);
      await vi.advanceTimersByTimeAsync(10000);
      expect(p.seen.verifies.length).toBe(4);
      vi.useRealTimers();
      expect($("#co").style.display).toBe("");
      expect($("#verifying").style.display).toBe("none");
      expect($("#payMsg").textContent).toBe("تعذر التحقق من الدفع الآن. إن كان المبلغ قد خُصم فطلبك محفوظ — راسلنا برقم الطلب " + ID + " ولا تدفع مرة أخرى.");
      expect($("#payMsg").hidden).toBe(false);
      expect(sessionStorage.getItem("lm_pending")).not.toBe(null);
      expect(p.seen.purchases.length).toBe(0);
      expect(location.search).toBe("?paid=" + ID);
    }
  });

  it("unsure with no basket: the panel — 'could not check', 'do not pay again'", async () => {
    const p = await back("?paid=" + ID, [json({ ok: false, error: "db_write_failed" }, { status: 502 })], { gate: true, cart: false });
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    p.open();
    for (let i = 0; i < 30; i++) await vi.advanceTimersByTimeAsync(1000);
    vi.useRealTimers();
    expect($("#returned").style.display).toBe("block");
    expect($("#retHead").textContent).toBe("طلبك " + ID);
    expect($("#retWhat").textContent).toBe("تعذر التحقق من الدفع الآن.");
    expect($("#retNext").textContent).toBe("إن خُصم المبلغ فطلبك محفوظ. لا تدفع مرة أخرى وراسلنا برقم الطلب.");
  });

  it("a second answer after an unsure one decides (paid on the 2nd try)", async () => {
    const p = await back("?paid=" + ID, [json({ ok: false, error: "db_read_failed" }, { status: 502 }), json({ ok: true, paid: true, id: ID })], { gate: true });
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    p.open();
    for (let i = 0; i < 6; i++) await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(1500);
    for (let i = 0; i < 6; i++) await vi.advanceTimersByTimeAsync(0);
    vi.useRealTimers();
    expect($("#done").style.display).toBe("block");
  });

  it("not paid, with the basket: back to the form, 'لم يكتمل الدفع. سلتك كما هي، جرب مرة أخرى.'", async () => {
    await back("?paid=" + ID, [json({ ok: true, paid: false, id: ID })]);
    await flush();
    expect($("#co").style.display).toBe("");
    expect($("#payMsg").textContent).toBe("لم يكتمل الدفع. سلتك كما هي، جرب مرة أخرى.");
    expect(location.search).toBe("");
  });

  it("amount mismatch (409): the shop completes it by hand — with and without the basket", async () => {
    await back("?paid=" + ID, [json({ ok: false, error: "amount_mismatch" }, { status: 409 })]);
    await flush();
    expect($("#payMsg").textContent).toBe("هناك اختلاف في المبلغ. راسلنا وسنكمل طلبك يدويا.");
    await back("?paid=" + ID, [json({ ok: false, error: "amount_mismatch" }, { status: 409 })], { cart: false });
    await flush();
    expect([$("#retWhat").textContent, $("#retNext").textContent]).toEqual(["هناك اختلاف في المبلغ.", "راسلنا وسنكمل طلبك يدويا."]);
  });

  it("not paid, no basket: the panel with the next step (cash suggested only where offered, v439)", async () => {
    const p = await back("?paid=" + ID, [json({ ok: true, paid: false, id: ID })], { cart: false });
    await flush();
    expect([$("#retWhat").textContent, $("#retNext").textContent]).toEqual(["لم يكتمل الدفع.", "استخدم الرابط في رسالتك للدفع، أو اختر الدفع عند الاستلام."]);
    expect($("#co").style.display).toBe("none");
    expect($<HTMLAnchorElement>("#retWa").href).toBe("https://wa.me/96876655565?text=" + encodeURIComponent("طلبك " + ID));
    expect($("#retWa").textContent).toBe("راسلنا على واتساب");
    expect(p.seen.purchases.length).toBe(0);
  });

  it("settled without a card payment: 'already being handled', never 'try again'; the pending copy dropped", async () => {
    await back("?paid=" + ID, [json({ ok: true, paid: false, settled: true, id: ID })]);
    await flush();
    expect([$("#retWhat").textContent, $("#retNext").textContent]).toEqual(["طلبك قيد المعالجة بالفعل.", "لا حاجة لأي إجراء. لأي استفسار راسلنا برقم الطلب."]);
    expect(document.body.textContent).not.toContain("جرب مرة أخرى.");
    expect(sessionStorage.getItem("lm_pending")).toBe(null);
  });

  it("an unknown order (404): the empty-basket screen, never a blank form; an id that is not an order number too", async () => {
    await back("?paid=" + ID, [json({ ok: false, error: "unknown_order" }, { status: 404 })], { cart: false });
    await flush();
    expect($("#empty").style.display).toBe("block");
    expect($("#returned").style.display).toBe("none");
    await back("?paid=nope", [json({ ok: true, paid: false })], { cart: false });
    await flush();
    expect($("#empty").style.display).toBe("block");
  });
});

// from test-v336-checkout.js §2, test-v439.js
describe("?cancelled=", () => {
  it("no basket: the panel — cancelled, the next step (cash where offered), WhatsApp; the form hidden", async () => {
    const p = await back("?cancelled=" + ID, [], { cart: false });
    expect($("#co").style.display).toBe("none");
    expect($("#returned").style.display).toBe("block");
    expect([$("#retHead").textContent, $("#retWhat").textContent, $("#retNext").textContent]).toEqual([
      "طلبك " + ID, "تم إلغاء الدفع.", "استخدم الرابط في رسالتك للدفع، أو اختر الدفع عند الاستلام.",
    ]);
    expect($<HTMLAnchorElement>("#retWa").href.indexOf("https://wa.me/96876655565?text=") === 0).toBe(true);
    expect(sessionStorage.getItem("lm_pending")).toBe(null);
    expect(location.search).toBe("");
    expect(p.seen.verifies.length).toBe(0);
    expect(document.documentElement.className).toBe("pg2 pg3");
  });

  it("with the basket: the form stays, the message says the basket is as it was (cash only where offered)", async () => {
    await back("?cancelled=" + ID, []);
    expect($("#co").style.display).toBe("");
    expect($("#payMsg").textContent).toBe("تم إلغاء الدفع. سلتك كما هي، جرب مرة أخرى أو اختر الدفع عند الاستلام.");
    expect(location.search).toBe("");
  });

  it("where cash is off (KW with codOn false): no cash suggested in either message", async () => {
    const { catalogueFile } = await import("./_page");
    const c = catalogueFile();
    c.countries.find((x) => x.code === "KW")!.codOn = false;
    stubNavigation();
    await bootPage({ url: "/checkout.html?country=KW&cancelled=" + ID, cart: [LINE("oud", "large")], catalogue: c });
    expect($("#payMsg").textContent).toBe("تم إلغاء الدفع. سلتك كما هي، جرب مرة أخرى.");
    await bootPage({ url: "/checkout.html?country=KW&cancelled=" + ID, cart: [], catalogue: c });
    expect($("#retNext").textContent).toBe("استخدم الرابط في رسالتك للدفع، أو راسلنا على واتساب.");
  });
});
