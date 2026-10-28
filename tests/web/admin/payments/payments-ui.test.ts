/**
 * The Payments tab in happy-dom with the API stubbed: what calls Thawani and what does not, every
 * page read, the tiles following the filters, a row's detail (ids, card, payloads, Ask Thawani),
 * the refund (a reason, refusals in words) and "mark paid by hand" (Thawani's payment id, a
 * different amount asks). Ported UI checks of test-payments, test-admin-tweaks (Payments),
 * test-v446 (payment states), test-v447 ("inProccess").
 */
import { h } from "preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { route } from "../../../../src/admin/app/route";
import { clearQueries, refreshActive } from "../../../../src/admin/data/query";
import { DialogHost, Toast } from "../../../../src/admin/kit";
import { Payments, resetPaymentsSession } from "../../../../src/admin/tabs/payments/Payments";
import { byText, click, mount, settle, stubFetch, type, type Call } from "../_render";

const ROW = (over: Record<string, unknown>) => ({
  orderId: "LM-1000001", customer: "سالم", country: "OM", orderTotal: 30, orderCur: "OMR", paymentId: "pay_100000001", invoice: "20261000000001",
  session: "checkout_1", intent: "", status: "successful", paid: true, refunded: false, amount: 30, fee: 0.6, net: 29.4, card: "424242******4242",
  cardType: "Visa", at: "2026-10-26T08:00:00.000Z", reason: "", refunds: [], stale: false, invoiceKey: "k".repeat(32), pay: "card", source: "order",
  ...over,
});

let rows: Array<ReturnType<typeof ROW>>;
function routes(over: Record<string, (c: Call) => unknown> = {}) {
  return {
    "GET /payments": (c: Call) => {
      const skip = Number(c.query.get("skip") || 0);
      const limit = Number(c.query.get("limit") || 50);
      const page = rows.slice(skip, skip + limit);
      return { ok: true, rows: page, limit, skip, more: skip + limit < rows.length, total: rows.length, gateway: true, lookedUp: 0, pending: c.query.get("lookups") === "0" ? 2 : 0, mode: "uat" };
    },
    ...over,
  };
}

function page() {
  return mount(h("div", null, h("div", { class: "tab" }, h(Payments, null)), h(DialogHost, null), h(Toast, null)));
}
const toastText = () => document.querySelector(".toast")!.textContent;
const dialog = () => document.querySelector("[role=dialog]") as HTMLElement;
const tile = (m: ReturnType<typeof page>, label: string) => [...m.$$(".kpi")].find((k) => k.querySelector(".kpi-top span")!.textContent === label)!;

beforeEach(() => {
  rows = [
    ROW({}),
    ROW({ orderId: "LM-1000002", paymentId: "", invoice: "20261000000002", status: "inProccess", paid: false, amount: 20, fee: 0, net: 20, card: "", cardType: "", stale: true }),
    ROW({ orderId: "LM-1000003", paymentId: "", status: "cancelled", paid: false, amount: 11, fee: 0, net: 11, card: "" }),
    ROW({ orderId: "LM-1000004", paymentId: "pay_100000004", refunded: true, amount: 9, fee: 0.18, net: 8.82, refunds: [{ id: "r1", amount: 9, status: "successful", reason: "damaged", at: null }] }),
  ];
  resetPaymentsSession();
  history.replaceState(null, "", "#payments");
  route.set({ tab: "payments", params: {} });
});
afterEach(() => {
  vi.unstubAllGlobals();
  clearQueries();
  document.body.innerHTML = "";
});

describe("reading the payments", () => {
  // from test-admin-tweaks.js: Refresh on Payments does not call Thawani (lookups 0); "Ask Thawani now" does (12)
  it("the first read asks Thawani about the gaps (the server's cap); Refresh never does; Ask Thawani now does", async () => {
    const { calls } = stubFetch(routes());
    const m = page();
    await settle(10);
    const first = calls.filter((c) => c.path === "/payments");
    expect(first.length).toBe(1);
    expect(first[0]!.query.has("lookups")).toBe(false);
    expect(first[0]!.query.get("limit")).toBe("100");
    await refreshActive("refresh");
    await settle(10);
    expect(calls.filter((c) => c.path === "/payments").pop()!.query.get("lookups")).toBe("0");
    await click(byText(m.root, "button", "Ask Thawani now"));
    await settle(10);
    expect(calls.filter((c) => c.path === "/payments").pop()!.query.get("lookups")).toBe("12");
    expect(toastText()).toBe("Asked Thawani");
    // the stamp says how many gaps were left unasked
    await refreshActive("auto");
    await settle(10);
    expect(m.text()).toMatch(/2 not fetched from Thawani yet/);
    m.unmount();
  });

  // from test-v446.js: every page is read (skip += page while more), lookups 0 after the first
  it("every page of the range is read, Thawani asked only on the first", async () => {
    rows = Array.from({ length: 230 }, (_, i) => ROW({ orderId: "LM-2" + String(i).padStart(6, "0"), paymentId: "pay_" + (100000 + i) }));
    const { calls } = stubFetch(routes());
    const m = page();
    await settle(14);
    const reads = calls.filter((c) => c.path === "/payments");
    expect(reads.map((c) => c.query.get("skip"))).toEqual(["0", "100", "200"]);
    expect(reads.slice(1).every((c) => c.query.get("lookups") === "0")).toBe(true);
    expect(tile(m, "Transactions").querySelector("b")!.textContent).toBe("230");
    expect(m.$(".pg-count")!.textContent).toBe("20 of 230");
    m.unmount();
  });

  it("the dates are sent as Muscat days (the server reads them)", async () => {
    const { calls } = stubFetch(routes());
    route.set({ tab: "payments", params: { from: "2026-10-01", to: "2026-10-07" } });
    const m = page();
    await settle(10);
    const c = calls.find((x) => x.path === "/payments")!;
    expect([c.query.get("from"), c.query.get("to")]).toEqual(["2026-10-01", "2026-10-07"]);
    m.unmount();
  });

  it("no Thawani keys: said in words", async () => {
    stubFetch(routes({ "GET /payments": () => [409, { ok: false, error: "thawani_not_configured" }] }));
    const m = page();
    await settle(10);
    expect(m.text()).toMatch(/No Thawani keys are set on the server yet\./);
    m.unmount();
  });
});

describe("the tiles and the filters", () => {
  // from test-v446.js / test-v447.js: one state per row; "inProccess" is pending, not failed
  it("the five tiles over every row, and the pills", async () => {
    stubFetch(routes());
    const m = page();
    await settle(10);
    expect(tile(m, "Collected").querySelector("b")!.textContent).toBe("39 OMR");
    expect(tile(m, "Collected").querySelector(".delta")!.textContent).toBe("38.22 OMR net to the bank · 9 OMR refunded");
    expect(tile(m, "Pending").querySelector("b")!.textContent).toBe("20 OMR");
    expect(tile(m, "Pending").querySelector(".delta")!.textContent).toBe("1 waiting");
    expect(tile(m, "Settled").querySelector("b")!.textContent).toBe("1");
    expect(tile(m, "Settled").querySelector(".delta")!.textContent).toBe("0.78 OMR in fees");
    expect(tile(m, "Transactions").querySelector("b")!.textContent).toBe("4");
    expect(tile(m, "Failed").querySelector("b")!.textContent).toBe("1");
    expect(m.$$("tr.row .pill").map((p) => p.textContent)).toEqual(["Settled", "Pending", "Failed", "Refunded"]);
    // a row never checked with Thawani says so; a refund shows its reason
    expect(m.$("tr.row[data-pay='LM-1000002']")!.textContent).toMatch(/not checked with Thawani/);
    expect(m.$("tr.row[data-pay='LM-1000004']")!.textContent).toMatch(/damaged/);
    m.unmount();
  });

  // from test-v446.js: the filter reads the same state and goes back to page one; the tiles follow it (test-admin-tweaks)
  it("a state filter narrows the rows and the tiles, lives in the address and goes back to page 1", async () => {
    stubFetch(routes());
    route.set({ tab: "payments", params: { page: "2" } });
    const m = page();
    await settle(10);
    await click(byText(m.root, ".seg button", "Failed"));
    expect(route.get().params).toEqual({ state: "failed" });
    await settle();
    expect(m.$$("tr.row").map((r) => r.getAttribute("data-pay"))).toEqual(["LM-1000003"]);
    expect(tile(m, "Transactions").querySelector("b")!.textContent).toBe("1");
    expect(tile(m, "Collected").querySelector("b")!.textContent).toBe("0 OMR");
    m.unmount();
  });

  it("search narrows by card, invoice, payment id or order", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    stubFetch(routes());
    const m = page();
    await settle(10);
    await type(m.$("input[type=search]"), "pay_100000004");
    await vi.advanceTimersByTimeAsync(400);
    await settle();
    expect(route.get().params).toEqual({ q: "pay_100000004" });
    expect(m.$$("tr.row").map((r) => r.getAttribute("data-pay"))).toEqual(["LM-1000004"]);
    vi.useRealTimers();
    m.unmount();
  });

  // from test-payments.js (panel): Refund only on a successful, un-refunded charge; the pay link on an unpaid card order
  it("each row offers only what applies: Refund on a settled charge, the pay link on an unpaid card order", async () => {
    stubFetch(routes());
    const m = page();
    await settle(10);
    const acts = (id: string) => [...m.$(`tr.row[data-pay='${id}']`)!.querySelectorAll(".acts .btn span")].map((s) => s.textContent);
    expect(acts("LM-1000001")).toEqual(["Refund"]);
    expect(acts("LM-1000002")).toEqual(["Pay link"]);
    expect(acts("LM-1000004")).toEqual([]);
    m.unmount();
  });
});

describe("a payment, opened", () => {
  it("the ids, the card, the money; the stored payload with Copy; Ask Thawani refreshes the display only", async () => {
    const { calls } = stubFetch(
      routes({
        "GET /orders/LM-1000002/gateway": () => ({ ok: true, id: "LM-1000002", gateway: { session: { session_id: "checkout_1" } } }),
        "GET /payments/ask/LM-1000002": () => ({
          ok: true,
          row: { ...rows[1], status: "successful", paid: true, paymentId: "pay_777777", card: "512345******0008", cardType: "Mastercard", fee: 0.4, net: 19.6, stale: false },
          payments: [{ paymentId: "pay_777777", status: "successful" }],
        }),
      }),
    );
    const m = page();
    await settle(10);
    await click(m.$("tr.row[data-pay='LM-1000002'] td.num"));
    const det = m.$("tr.detail[data-pay-detail='LM-1000002']")!;
    expect(det.textContent).toMatch(/Sessioncheckout_1/);
    expect(det.textContent).toMatch(/Invoice20261000000002/);
    expect(det.textContent).toMatch(/Thawani's statusinProccess/);
    // the raw payload loads when its fold opens
    const raw = det.querySelector("details.raw") as HTMLDetailsElement;
    raw.open = true;
    raw.dispatchEvent(new Event("toggle"));
    await settle();
    expect(det.querySelector("pre")!.textContent).toMatch(/checkout_1/);
    await click(byText(det, "button", "Ask Thawani"));
    expect(det.textContent).toMatch(/Payment idpay_777777/);
    expect(det.textContent).toMatch(/Card512345\*\*\*\*\*\*0008/);
    expect(det.textContent).toMatch(/as Thawani says now/);
    expect(det.querySelectorAll("details.raw").length).toBe(2);
    expect(calls.filter((c) => c.method !== "GET").length).toBe(0); // nothing written
    m.unmount();
  });

  // from test-payments.js (panel): requires a reason ≥ 3 characters; warns "cannot be undone"
  it("refund: a reason is required, the server's refusals in words, success marks the order", async () => {
    let answer: [number, unknown] = [409, { ok: false, error: "already_refunded" }];
    const { calls } = stubFetch(routes({ "POST /payments/refund": () => answer }));
    const m = page();
    await settle(10);
    await click(byText(m.$("tr.row[data-pay='LM-1000001']")!, "button", "Refund"));
    expect(dialog().textContent).toMatch(/cannot be undone/);
    await click(byText(dialog(), "button", /^Refund 30 OMR/));
    expect(dialog().querySelector("[role=alert]")!.textContent).toBe("A refund needs a reason.");
    expect(calls.some((c) => c.method === "POST")).toBe(false);
    await type(dialog().querySelector("textarea"), "  Damaged in transit ");
    await click(byText(dialog(), "button", /^Refund 30 OMR/));
    expect(calls.find((c) => c.method === "POST")!.body).toEqual({ paymentId: "pay_100000001", reason: "Damaged in transit" });
    expect(dialog().querySelector("[role=alert]")!.textContent).toBe("Thawani says this payment has already been refunded.");
    answer = [200, { ok: true, refundId: "r9", orderId: "LM-1000001", amount: 30 }];
    await click(byText(dialog(), "button", /^Refund 30 OMR/));
    expect(document.querySelector("[role=dialog]")).toBeNull();
    expect(toastText()).toBe("Refunded 30 OMR · order LM-1000001 cancelled and marked refunded");
    m.unmount();
  });

  it("mark paid by hand: Thawani's payment id; a different amount asks, then sends acceptAmount", async () => {
    let n = 0;
    const { calls } = stubFetch(
      routes({
        "POST /payments/mark-paid": (c) =>
          ++n === 1
            ? [404, { ok: false, error: "no_such_payment" }]
            : (c.body as { acceptAmount?: boolean }).acceptAmount
              ? { ok: true, id: "LM-1000003", paymentId: "pay_555555", amount: 10.5 }
              : [409, { ok: false, error: "amount_mismatch", expected_baisa: 11000, paid_baisa: 10500 }],
      }),
    );
    const m = page();
    await settle(10);
    await click(m.$("tr.row[data-pay='LM-1000003'] td.num"));
    await click(byText(m.$("tr.detail")!, "button", "Mark paid by hand…"));
    await type(dialog().querySelector("input"), "x");
    await click(byText(dialog(), "button", "Check with Thawani and mark paid"));
    expect(dialog().querySelector("[role=alert]")!.textContent).toMatch(/Thawani's payment id/);
    expect(calls.some((c) => c.method === "POST")).toBe(false);
    await type(dialog().querySelector("input"), "pay_555555");
    await click(byText(dialog(), "button", "Check with Thawani and mark paid"));
    expect(dialog().querySelector("[role=alert]")!.textContent).toBe("Thawani has no payment with that id.");
    await click(byText(dialog(), "button", "Check with Thawani and mark paid"));
    expect(dialog().querySelector("[role=alert]")!.textContent).toBe("Thawani's charge is 10.5 OMR; the order recorded 11 OMR. Mark it paid with Thawani's figure?");
    await click(byText(dialog(), "button", "Mark paid with Thawani's figure"));
    const posts = calls.filter((c) => c.method === "POST").map((c) => c.body);
    expect(posts).toEqual([{ id: "LM-1000003", paymentId: "pay_555555" }, { id: "LM-1000003", paymentId: "pay_555555" }, { id: "LM-1000003", paymentId: "pay_555555", acceptAmount: true }]);
    expect(toastText()).toBe("LM-1000003 marked paid · 10.5 OMR (Thawani pay_555555)");
    m.unmount();
  });
});
