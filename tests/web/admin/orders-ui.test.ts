/**
 * The Orders tab in happy-dom with the API stubbed: the rows and their pills, the accordion,
 * the flag, the bulk bar, the filters in the address, and the open order — status moves
 * (moving back asks, a live parcel asks), tracking by hand, the editors, Empower (a duplicate
 * asks), the WhatsApp link. Ported UI checks of test-admin-boot/-tweaks/-batch, v402, v408.
 */
import { h } from "preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { route } from "../../../src/admin/app/route";
import { clearQueries } from "../../../src/admin/data/query";
import { DialogHost, Toast } from "../../../src/admin/kit";
import { forget, rowsStore } from "../../../src/admin/tabs/orders/rows";
import { Orders } from "../../../src/admin/tabs/orders/Orders";
import { byText, click, mount, settle, stubFetch, type, type Call } from "./_render";

const SHIP = { id: "omf-LM-1000002", sentId: "LM-1000002", reference: "OMF77", awb: "44123", courier: "Aramex", status: "picked_up", at: "2026-10-20T10:00:00Z", deliveredAt: null };
// the list's rows as the API sends them (loosely typed fixtures)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ROW = (over: Record<string, unknown>): Record<string, any> => ({
  id: "LM-1000001", createdAt: "2026-10-26T08:00:00Z", updatedAt: "2026-10-26T08:00:00Z", status: "new", paymentStatus: "cod", pay: "cod", lang: "ar",
  origin: "instagram", name: "سالم البلوشي", phone: "+968 91234567", phoneKey: "96891234567", email: null, country: "عُمان", countryCode: "OM",
  city: "مسقط", region: "الخوير", note: "", items: [{ itemId: "oud-large", scent: "عود", size: "كبير", price: 30, qty: 1 }], cur: "OMR", sub: 30,
  ship: 0, codFee: 0, total: 30, omrRate: 1, omr: 30, amountBaisa: null, attribution: null, invoiceNo: null, paidAt: null, paymentId: null,
  maskedCard: null, refunded: false, gatewayFee: null, netAmount: null, lastPaymentError: null, tracking: null, carrier: null, shippedAt: null,
  deliveredAt: null, adminNote: null, flagged: false, flaggedAt: null, trashed: false, trashedAt: null, hasGateway: false, invoiceKey: "k".repeat(32),
  ...over,
});
const ROWS = [
  ROW({ check: ["phone", "area"] }),
  ROW({ id: "LM-1000002", countryCode: "AE", cur: "AED", status: "ship", shipment: SHIP, name: "فاطمة", origin: "whatsapp_order" }),
  ROW({ id: "LM-1000003", countryCode: "KW", cur: "KWD", name: "Hassan" }),
  ROW({ id: "LM-1000004", status: "pending", pay: "card", paymentStatus: "unpaid", amountBaisa: 30000, name: "Layla", countryCode: "AE", cur: "AED", total: 250 }),
];

let state: { rows: ReturnType<typeof ROW>[] };
function routes(over: Record<string, (c: Call) => unknown> = {}) {
  return {
    "GET /orders": (c: Call) => ({ ok: true, orders: c.query.get("trash") === "1" ? [] : state.rows, total: 46, limit: 20, offset: Number(c.query.get("offset") || 0), tag: "t" + state.rows.length, empowerUnsure: ["LM-1000003"] }),
    "GET /catalogue": () => ({ ok: true, data: { countries: [{ code: "OM", cur: "OMR", dial: "968", cod: 1 }, { code: "AE", cur: "AED", dial: "971", cod: 10 }, { code: "KW", cur: "KWD", dial: "965", courier: "manual" }] } }),
    "GET /orders/options": () => ({ ok: true, country: "OM", cur: "OMR", dec: 3, items: [{ itemId: "oud-large", kind: "box", name: "عود · كبير", name_en: "Oud · Large", price: 30, was: null, soldOut: false, active: true, scentId: "oud", sizeId: "large" }, { itemId: "burner", kind: "extra", name: "مبخرة", name_en: "Burner", price: 6, was: null, soldOut: true, active: false }] }),
    ...Object.fromEntries(
      state.rows.map((r) => [
        "GET /orders/" + r.id,
        () => ({ ok: true, order: { ...r, check: r.check || [] }, events: [{ id: 1, orderId: r.id, at: r.createdAt, kind: "created", from: null, to: "new", by: "shopper", detail: { origin: "instagram" } }], shipments: r.shipment ? [{ id: r.shipment.id, sentId: r.shipment.sentId, reference: "OMF77", awb: "44123", courierName: "Aramex", status: "picked_up", createdAt: r.shipment.at, deliveredAt: null }] : [] }),
      ]),
    ),
    ...over,
  };
}

function page() {
  return mount(h("div", null, h("div", { class: "tab" }, h(Orders, null)), h(DialogHost, null), h(Toast, null)));
}
const toastText = () => document.querySelector(".toast")!.textContent;
const dialog = () => document.querySelector("[role=dialog]") as HTMLElement;

beforeEach(() => {
  state = { rows: ROWS.map((r) => ({ ...r })) as never };
  history.replaceState(null, "", "#orders");
  route.set({ tab: "orders", params: {} });
  rowsStore.set(forget());
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  clearQueries();
  document.body.innerHTML = "";
});

describe("the list", () => {
  it("each row: the number and where it came from, the customer, the total, the pills; 20 a page with the count", async () => {
    stubFetch(routes());
    const m = page();
    await settle(10);
    const rows = m.$$("tr.row");
    expect(rows.length).toBe(4);
    expect(rows[0]!.querySelector(".id")!.textContent).toBe("LM-1000001Instagram");
    expect(rows[1]!.querySelector(".id .src")!.textContent).toBe("WhatsApp (typed in)");
    expect(rows[0]!.querySelector(".who")!.textContent).toBe("سالم البلوشي+968 91234567");
    expect(rows[0]!.querySelector(".total")!.textContent).toBe("30 OMR");
    const pills = (i: number) => [...rows[i]!.querySelectorAll(".pill")].map((p) => p.textContent);
    expect(pills(0)).toEqual(["New Order", "Cash on delivery", "Check: phone digits, area"]);
    expect(pills(1)).toEqual(["Shipped", "Cash on delivery", "Empower"]);
    // v402: a push being checked; KW is shipped by hand — the unsure push is said first
    expect(pills(2)).toEqual(["New Order", "Cash on delivery", "Empower?"]);
    expect(pills(3)).toEqual(["Awaiting Payment", "Unpaid"]);
    // v408: Aramex for the UAE parcel, nothing for the others
    const trk = rows[1]!.querySelector<HTMLAnchorElement>("a.trk")!;
    expect(trk.href).toBe("https://www.aramex.com/track/results?ShipmentNumber=44123");
    expect(trk.target).toBe("_blank");
    expect(trk.rel).toBe("noopener");
    expect(rows[0]!.querySelector("a.trk")).toBeNull();
    expect(m.$(".pg-count")!.textContent).toBe("20 of 46");
    m.unmount();
  });

  it("the whole row opens the order; a control inside it does only its own job; the accordion and the pin", async () => {
    const { calls } = stubFetch(routes({ "PUT /orders/LM-1000001/flag": () => ({ ok: true, updated: 1, flagged: true }) }));
    const m = page();
    await settle(10);
    await click(m.$$("tr.row")[0]!.querySelector(".who b"));
    expect(m.$("tr.detail[data-detail='LM-1000001']")).not.toBeNull();
    expect(m.$("tr.detail")!.textContent).toMatch(/Order placed/);
    // the flag is a control: it flags, it does not open or close
    await click(m.$$("tr.row")[0]!.querySelector("button.flag"));
    expect(calls.find((c) => c.method === "PUT")!.body).toEqual({ on: true });
    expect(m.$("tr.detail[data-detail='LM-1000001']")).not.toBeNull();
    // opening another closes the first
    await click(m.$$("tr.row")[1]!.querySelector(".total"));
    expect(m.$$("tr.detail").map((d) => d.getAttribute("data-detail"))).toEqual(["LM-1000002"]);
    // the pin keeps one open while another opens
    await click(m.$$("tr.row")[1]!.querySelector("button.pin"));
    await click(m.$$("tr.row")[2]!.querySelector(".total"));
    expect(m.$$("tr.detail").map((d) => d.getAttribute("data-detail"))).toEqual(["LM-1000002", "LM-1000003"]);
    expect(m.$$("tr.row")[2]!.querySelector(".chev")!.getAttribute("aria-expanded")).toBe("true");
    m.unmount();
  });

  it("filters live in the address and any filter goes back to page 1; the CSV carries them", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    stubFetch(routes());
    route.set({ tab: "orders", params: { page: "3" } });
    const m = page();
    await settle(10);
    await type(m.$("input[type=search]"), "سالم");
    await vi.advanceTimersByTimeAsync(400);
    await settle();
    expect(route.get().params).toEqual({ q: "سالم" });
    const csv = m.$<HTMLAnchorElement>("a[download]")!;
    expect(decodeURIComponent(csv.getAttribute("href")!)).toBe("/api/admin/orders/export.csv?q=سالم");
    const sel = m.$<HTMLSelectElement>("select[aria-label=Payment]")!;
    sel.value = "cod";
    sel.dispatchEvent(new Event("change", { bubbles: true }));
    await settle();
    expect(route.get().params).toEqual({ q: "سالم", payment: "cod" });
    m.unmount();
  });

  it("the bulk bar: selection, Flag (all flagged → clear), Trash; the trash view offers Restore and Delete forever", async () => {
    const { calls } = stubFetch(routes({ "POST /orders/bulk": (c) => ({ ok: true, op: (c.body as { op: string }).op, updated: (c.body as { ids: string[] }).ids.length, stale: [] }) }));
    const m = page();
    await settle(10);
    await click(m.$$("tr.row")[0]!.querySelector("input[type=checkbox]"));
    await click(m.$$("tr.row")[1]!.querySelector("input[type=checkbox]"));
    expect(m.$("#bulkBar")!.textContent).toMatch(/^2 selected/);
    expect(m.$<HTMLInputElement>("thead input")!.indeterminate).toBe(true);
    await click(byText(m.$("#bulkBar")!, "button", "Flag"));
    expect(calls.filter((c) => c.path === "/orders/bulk").map((c) => c.body)).toEqual([{ op: "flag", ids: ["LM-1000001", "LM-1000002"], on: true }]);
    expect(toastText()).toBe("Flagged 2 orders");
    expect(m.$("#bulkBar")).toBeNull();
    // select all on the page, then all matching (the server's every page)
    await click(m.$("thead input"));
    expect(m.$("#bulkBar")!.textContent).toMatch(/4 selected/);
    expect(byText(m.$("#bulkBar")!, "button", "Select all 46 matching")).not.toBeNull();
    await click(byText(m.root, "button", "Trash"));
    await settle(10);
    expect(byText(m.root, "button", "Back to orders")).not.toBeNull();
    expect(route.get().params).toEqual({ trash: "1" });
    expect(m.text()).toMatch(/The trash is empty/);
    m.unmount();
  });
});

describe("the open order", () => {
  async function open(i: number, over: Record<string, (c: Call) => unknown> = {}) {
    const f = stubFetch(routes(over));
    const m = page();
    await settle(10);
    await click(m.$$("tr.row")[i]!.querySelector(".total"));
    await settle(6);
    return { m, ...f, det: () => m.$("tr.detail")! };
  }

  it("the status flow: forward moves sent as they are", async () => {
    const { m, calls, det } = await open(0, { "POST /orders/LM-1000001/status": () => ({ ok: true, id: "LM-1000001", from: "new", to: "prep", changed: true }) });
    const btns = [...det().querySelectorAll(".flow .step")].map((b) => b.textContent);
    expect(btns).toEqual(["New", "Preparing", "Shipped", "Delivered", "Cancel order"]);
    expect(det().querySelector(".step.here")!.textContent).toBe("New");
    await click(byText(det(), ".flow button", "Preparing"));
    expect(calls.find((c) => c.method === "POST")!.body).toEqual({ to: "prep" });
    expect(toastText()).toBe("LM-1000001 → Preparing");
    m.unmount();
  });

  // v314/v326: moving back asks; the server's live-parcel refusal asks; force on a yes
  it("moving back asks first and is sent with force; a cancel over a live parcel asks again", async () => {
    let n = 0;
    const { m, calls, det } = await open(1, {
      "POST /orders/LM-1000002/status": (c) => {
        const b = c.body as { to: string; force?: boolean };
        if (b.to === "void" && !b.force) return [409, { ok: false, error: "parcel_live", detail: "Aramex 44123", ids: ["LM-1000002"] }];
        n++;
        return { ok: true, id: "LM-1000002", from: "ship", to: b.to, changed: true };
      },
    });
    await click(byText(det(), ".flow button", "New"));
    expect(dialog().textContent).toMatch(/Move LM-1000002 back\?/);
    await click(byText(dialog(), "button", "Move back"));
    await settle();
    expect(calls.filter((c) => c.method === "POST").map((c) => c.body)).toEqual([{ to: "new", force: true }]);
    await click(byText(det(), ".flow button", "Cancel order"));
    await click(byText(dialog(), "button", "Cancel order"));
    await settle();
    expect(dialog().textContent).toMatch(/has a live parcel/);
    expect(dialog().textContent).toMatch(/Aramex 44123/);
    await click(byText(dialog(), "button", "Cancel anyway"));
    await settle();
    expect(calls.filter((c) => c.method === "POST").map((c) => c.body).slice(1)).toEqual([{ to: "void" }, { to: "void", force: true }]);
    expect(n).toBe(2);
    m.unmount();
  });

  it("a stale order says so and the list is read again", async () => {
    const { m, calls, det } = await open(0, { "POST /orders/LM-1000001/status": () => [409, { ok: false, error: "stale" }] });
    const before = calls.filter((c) => c.path === "/orders").length;
    await click(byText(det(), ".flow button", "Delivered"));
    await settle();
    expect(toastText()).toMatch(/changed while you were looking at it/);
    expect(calls.filter((c) => c.path === "/orders").length).toBeGreaterThan(before);
    m.unmount();
  });

  it("an awaiting-payment card order offers only Cancel, and the payment reminder on WhatsApp with both links", async () => {
    const { m, det } = await open(3);
    const enabled = [...det().querySelectorAll<HTMLButtonElement>(".flow button")].filter((b) => !b.disabled).map((b) => b.textContent);
    expect(enabled).toEqual(["Cancel order"]);
    const wa = byText(det(), "a", "WhatsApp: Payment reminder") as HTMLAnchorElement;
    expect(wa.href.startsWith("https://wa.me/96891234567?text=")).toBe(true);
    const text = decodeURIComponent(wa.href.split("text=")[1]!);
    expect(text).toMatch(/للدفع بالبطاقة:\nhttp:\/\/localhost(:\d+)?\/resume\/LM-1000004\?k=k+/);
    expect(text).toMatch(/أو الدفع عند الاستلام \(260 AED\)/);
    expect(det().querySelector("button[disabled][title='Not paid yet']")).not.toBeNull();
    m.unmount();
  });

  it("tracking by hand: the number and carrier, saved and marked shipped", async () => {
    const { m, calls, det } = await open(0, { "PUT /orders/LM-1000001/tracking": () => ({ ok: true }) });
    await click(byText(det(), "button", /Ship by hand instead/));
    const [trk, car] = [...det().querySelectorAll<HTMLInputElement>(".hand input")];
    await type(trk!, "DHL123456");
    await type(car!, "DHL");
    await click(byText(det(), "button", "Save & mark shipped"));
    expect(calls.find((c) => c.method === "PUT")!.body).toEqual({ tracking: "DHL123456", carrier: "DHL", ship: true });
    expect(toastText()).toBe("LM-1000001 → Shipped · DHL123456");
    m.unmount();
  });

  it("a market shipped by hand shows the tracking fields at once", async () => {
    const { m, det } = await open(2);
    expect(det().querySelector(".hand")).not.toBeNull();
    expect(det().textContent).toMatch(/By hand \(tracking typed here\)/);
    m.unmount();
  });

  // test-order-items.js (panel half): only the changed fields; the item editor sends ids and quantities only
  it("the customer editor sends only what changed; the item editor re-quotes ids and quantities", async () => {
    const { m, calls, det } = await open(0, {
      "PATCH /orders/LM-1000001/customer": () => ({ ok: true, patch: {} }),
      "PUT /orders/LM-1000001/items": () => ({ ok: true, items: [], cur: "OMR", ship: 0, total: 66, omr: 66, catalogueTotal: 66, codAmount: null, was: 30 }),
    });
    await click(det().querySelector("[aria-label='Edit the customer of LM-1000001']"));
    const name = det().querySelector<HTMLInputElement>(".cust-edit input")!;
    await type(name, "سالم الحارثي");
    // Oman: the governorate is a list, its value kept
    expect(det().querySelector<HTMLSelectElement>(".cust-edit select")!.value).toBe("مسقط");
    await click(byText(det(), ".cust-edit button", "Save"));
    expect(calls.find((c) => c.method === "PATCH")!.body).toEqual({ name: "سالم الحارثي" });
    expect(toastText()).toBe("Customer details saved");

    await click(det().querySelector("[aria-label='Edit the items of LM-1000001']"));
    await settle();
    // a sold-out add-on is offered, marked
    expect([...det().querySelectorAll(".item-line option")].map((o) => o.textContent)).toContain("Burner · مبخرة — 6 OMR — sold out");
    await click(det().querySelector("[aria-label='One more']"));
    // unpaid cash: an amount to collect may be typed
    await type(det().querySelector(".cod-amt input"), "55");
    await click(byText(det(), "button", "Re-quote & save"));
    expect(calls.find((c) => c.method === "PUT" && c.path.endsWith("/items"))!.body).toEqual({ items: [{ itemId: "oud-large", qty: 2 }], codAmount: "55" });
    expect(toastText()).toBe("Total is now 66 OMR (was 30 OMR)");
    m.unmount();
  });

  // v402: Omniful already has it — a person decides: record it, or send under a new id
  it("Push to Empower asks first; a duplicate offers to record it (adopt) rather than send twice", async () => {
    const { m, calls, det } = await open(0, {
      "POST /empower/push": (c) => ((c.body as { adopt?: boolean }).adopt ? { ok: true, adopted: true, status: "prep", sentId: "LM-1000001" } : [409, { ok: false, error: "omniful_duplicate", duplicate: true, sentId: "LM-1000001" }]),
    });
    await click(byText(det(), "button", "Push to Empower"));
    expect(dialog().textContent).toMatch(/Push LM-1000001 to Empower\?/);
    await click(byText(dialog(), "button", "Push to Empower"));
    await settle();
    expect(dialog().textContent).toMatch(/Omniful already has LM-1000001/);
    await click(byText(dialog(), "button", "Record it (send nothing)"));
    await settle();
    expect(calls.filter((c) => c.path === "/empower/push").map((c) => c.body)).toEqual([
      { id: "LM-1000001", any: true },
      { id: "LM-1000001", any: true, adopt: true },
    ]);
    expect(toastText()).toBe("LM-1000001 recorded as on Empower · Preparing");
    m.unmount();
  });

  it("an order on Empower: its reference, status and waybill, Take off Empower, the Aramex message to copy", async () => {
    const { m, det } = await open(1);
    expect(det().textContent).toMatch(/On Empower · OMF77/);
    expect(det().textContent).toMatch(/Aramex · 44123/);
    expect(byText(det(), "button", "Take off Empower")).not.toBeNull();
    expect(byText(det(), "button", "Copy tracking message")).not.toBeNull();
    expect((byText(det(), "a", "Track on Aramex") as HTMLAnchorElement).href).toBe("https://www.aramex.com/track/results?ShipmentNumber=44123");
    m.unmount();
  });
});
