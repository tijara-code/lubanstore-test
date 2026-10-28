/**
 * The Empower tab in happy-dom with the API stubbed: the connection and the figures; Waiting
 * (the details check, the row opening to the order with Edit customer / Edit items in the
 * "adjust before push" mode, Push, Push all looping on `left` and offering to record
 * duplicates, the auto push switch asking first); the WhatsApp order form; Pushed (15 a page,
 * the stage filter, the row opening to Omniful's record, the tracking message, Take off with
 * the mark-only fallback, Check statuses); routes; SKU codes (Match, Save). Ported UI-side
 * checks of test-v189, test-v316, test-v338, test-v402, test-empower / test-omniful (panel).
 */
import { h } from "preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearQueries } from "../../../../src/admin/data/query";
import { DialogHost, Toast } from "../../../../src/admin/kit";
import { Empower } from "../../../../src/admin/tabs/empower/Empower";
import { byText, click, mount, settle, stubFetch, type, type Call } from "../_render";

const STATUS = (over: Record<string, unknown> = {}) => ({
  ok: true, configured: true, env: "production", base: "https://prodapi.omniful.com", hub: "set", renews: true, missing: [],
  lastSweep: { at: new Date(Date.now() - 18 * 60000).toISOString(), pushed: 2, waiting: 3, failed: [] }, lastPoll: { at: new Date(Date.now() - 12 * 60000).toISOString(), tracked: 3, updated: 1, moved: 1, errors: [] },
  routing: [{ code: "OM", name: "Oman", courier: "omniful", chosen: true }, { code: "AE", name: "UAE", courier: "omniful", chosen: false }, { code: "KW", name: "Kuwait", courier: "manual", chosen: true }],
  couriers: ["omniful", "manual"], labels: { omniful: "Empower (Omniful)", manual: "Shipped by hand" },
  waiting: 2, pushed: 20, hookPath: "/api/omniful/hook", hookGuarded: true, skus: { "oud-large": "LM3001" },
  auto: { on: false, since: null, afterMin: 3, everyMin: 1, retryH: 6, last: { at: "2026-10-27T09:45:00Z", pushed: 2, flagged: [{ id: "LM-1000003", missing: ["area"] }], failed: [] } },
  ...over,
});
const W = (id: string, over: Record<string, unknown> = {}) => ({
  id, createdAt: "2026-10-27T10:00:00Z", name: "سالم", phone: "+968 91234567", countryCode: "OM", city: "مسقط", region: "الخوير", cur: "OMR", total: 25, ship: 0, codFee: 0,
  pay: "cod", paymentStatus: "cod", origin: "instagram", items: [{ itemId: "oud-large", scent: "عود", size: "كبير", price: 25, qty: 1 }], lines: [{ code: "oud-large", sku: "LM3001", qty: 1 }], ...over,
});
const WAITING = [W("LM-1000001"), W("LM-1000002", { origin: "whatsapp_order", check: ["area"], name: "Layla", unsure: true })];
const ROW = (n: number, over: Record<string, unknown> = {}) => ({
  id: "omf-LM-20000" + String(n).padStart(2, "0"), orderId: "LM-20000" + String(n).padStart(2, "0"), carrier: "empower", sentId: "LM-20000" + String(n).padStart(2, "0"),
  reference: "OMF" + n, awb: n % 2 ? "4412" + n : null, courierName: "Aramex", status: n === 3 ? "Shipment Refused" : "picked_up", cod: 25, createdAt: "2026-10-2" + (n % 8) + "T10:00:00Z",
  updatedAt: "2026-10-27T10:00:00Z", pickedUpAt: null, deliveredAt: n === 4 ? "2026-10-27T10:00:00Z" : null, syncedAt: null, lastError: n === 3 ? "Consignee refused the parcel" : null, ...over,
});
const PUSHED = Array.from({ length: 20 }, (_, i) => ROW(i + 1));
const ORDER = (id: string, over: Record<string, unknown> = {}) => ({
  ok: true,
  order: { ...W(id), status: "new", email: null, note: "", country: "عُمان", check: [], refunded: false, adminNote: "call first", hasGateway: false, ...over },
  events: [], shipments: [],
});

let state: { waiting: typeof WAITING; auto: boolean };
function routes(over: Record<string, (c: Call) => unknown> = {}) {
  return {
    "GET /empower": () => STATUS({ auto: { ...STATUS().auto as object, on: state.auto } }),
    "GET /empower/waiting": () => ({ ok: true, orders: state.waiting }),
    "GET /empower/pushed": () => ({ ok: true, rows: PUSHED }),
    "GET /catalogue": () => ({ ok: true, data: { countries: [{ code: "OM", name: "عُمان", cur: "OMR", dial: "968", cod: 1 }], sizes: [{ id: "large", name: "كبير", name_en: "Large" }], scents: [{ id: "oud", name: "عود", name_en: "Oud" }], extras: [], offer: { name_en: "Set" } } }),
    "GET /orders/options": () => ({ ok: true, country: "OM", cur: "OMR", dec: 3, items: [{ itemId: "oud-large", kind: "box", name: "عود · كبير", name_en: "Oud · Large", price: 25, was: null, soldOut: false, active: true, scentId: "oud", sizeId: "large" }, { itemId: "oud-small", kind: "box", name: "عود · صغير", name_en: "Oud · Small", price: 12, was: null, soldOut: true, active: true, scentId: "oud", sizeId: "small" }] }),
    "GET /orders/LM-1000001": () => ORDER("LM-1000001"),
    "GET /orders/LM-1000002": () => ORDER("LM-1000002", { name: "Layla" }),
    "GET /orders/LM-2000001": () => ORDER("LM-2000001", { countryCode: "AE", cur: "AED", status: "prep", phone: "+971 501234567" }),
    "GET /orders/LM-2000002": () => ORDER("LM-2000002", { status: "prep" }),
    ...over,
  };
}
const page = () => mount(h("div", null, h("div", { class: "tab" }, h(Empower, null)), h(DialogHost, null), h(Toast, null)));
const toastText = () => document.querySelector(".toast")!.textContent;
const dialog = () => document.querySelector("[role=dialog]") as HTMLElement;
const sent = (calls: Call[], k: string) => calls.filter((c) => c.method + " " + c.path === k);
const waitRow = (id: string) => [...document.querySelectorAll(".omf-wait tbody tr.row")].find((r) => r.querySelector(".id")!.textContent === id) as HTMLElement;

beforeEach(() => {
  clearQueries();
  state = { waiting: WAITING.map((o) => ({ ...o })) as never, auto: false };
});
afterEach(() => {
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("the connection and the figures", () => {
  it("live, the last push and status read, the four figures, the webhook", async () => {
    stubFetch(routes());
    const m = page();
    await settle();
    expect(document.querySelector("#omfCard .stamp")!.textContent).toBe("live");
    expect(m.text()).toMatch(/Last push ran \d+ (min|h) ago\. 2 pushed · 3 still waiting\./);
    expect(m.text()).toMatch(/3 checked · 1 changed · 1 order moved/);
    const kpis = [...document.querySelectorAll(".kpi")].map((k) => k.textContent);
    expect(kpis).toEqual(["Waiting to push2", "Pushed to Omniful20", "Still in flight19", "Carrying an error1"]);
    expect(m.text()).toMatch(/\/api\/omniful\/hook\?k=<your OMNIFUL_HOOK_SECRET>/);
  });
  it("not set up: says what is missing, and Push / Push all are off with the reason", async () => {
    stubFetch(routes({ "GET /empower": () => STATUS({ configured: false, missing: ["OMNIFUL_API_TOKEN", "OMNIFUL_HUB_CODE"] }) }));
    const m = page();
    await settle();
    expect(document.querySelector("#omfCard .stamp")!.textContent).toBe("no API token");
    expect(m.text()).toMatch(/OMNIFUL_API_TOKEN: access token/);
    const push = byText(waitRow("LM-1000001"), "button", "Push") as HTMLButtonElement;
    expect(push.disabled).toBe(true);
    expect(push.title).toBe("Omniful not connected. Add its API token on the server.");
    expect((byText(m.root, "button", "Push all") as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("waiting to be pushed", () => {
  it("rows with the details check, the unsure push and the typed-in order marked while auto is on", async () => {
    state.auto = true;
    stubFetch(routes());
    const m = page();
    await settle();
    expect(m.text()).toMatch(/2 waiting/);
    const r2 = waitRow("LM-1000002");
    expect(r2.textContent).toMatch(/Check: area/);
    expect(r2.textContent).toMatch(/Empower\?/);
    expect(r2.textContent).toMatch(/manual/);
    expect(waitRow("LM-1000001").textContent).not.toMatch(/Check:/);
  });

  // test-v189: the order as the warehouse will be told it, editable inside the row; items in manual mode
  it("a row opens to the order: the SKU each line goes out as, what to collect; Edit items sends manual", async () => {
    const { calls } = stubFetch(
      routes({
        "PUT /orders/LM-1000001/items": () => ({ ok: true, items: [], cur: "OMR", ship: 0, total: 12, omr: 12, catalogueTotal: 12, codAmount: null, was: 25 }),
        "PATCH /orders/LM-1000001/customer": () => ({ ok: true, patch: { region: "x" } }),
      }),
    );
    page();
    await settle();
    await click(waitRow("LM-1000001").querySelector(".id"));
    const det = document.querySelector("#omf-det-LM-1000001") as HTMLElement;
    expect(det.textContent).toMatch(/LM3001/);
    expect(det.textContent).toMatch(/Collect25 OMR on delivery/);
    expect(det.textContent).toMatch(/Internal notecall first/);
    expect(det.textContent).toMatch(/Warehouse lines1× LM3001/);
    await click(det.querySelector('[aria-label="Edit the items of LM-1000001"]'));
    const sel = det.querySelector(".item-edit select") as HTMLSelectElement;
    sel.value = "oud-small";
    sel.dispatchEvent(new Event("change", { bubbles: true }));
    await settle();
    await click(byText(det, "button", /Re-quote/));
    const body = sent(calls, "PUT /orders/LM-1000001/items")[0]!.body as Record<string, unknown>;
    expect(body.manual).toBe(true);
    expect(toastText()).toMatch(/Total is now 12 OMR \(was 25 OMR\)/);
    // the Waiting list is read again after an edit
    expect(sent(calls, "GET /empower/waiting").length).toBeGreaterThan(1);
    await click(det.querySelector('[aria-label="Edit the customer of LM-1000001"]'));
    await type(det.querySelector(".cust-edit input"), "سالم البلوشي");
    await click(byText(det, "button", "Save"));
    expect(sent(calls, "PATCH /orders/LM-1000001/customer")[0]!.body).toEqual({ name: "سالم البلوشي" });
  });

  it("Push sends one order; Omniful's duplicate asks what to do", async () => {
    let n = 0;
    const { calls } = stubFetch(
      routes({
        "POST /empower/push": (c) => {
          n++;
          const b = c.body as { adopt?: boolean };
          if (n === 1) return { ok: true, sentId: "LM-1000001", status: "prep" };
          if (!b.adopt) return [409, { ok: false, error: "omniful_duplicate", detail: "order_id has already been taken" }];
          return { ok: true, adopted: true, status: "prep" };
        },
      }),
    );
    page();
    await settle();
    await click(byText(waitRow("LM-1000001"), "button", "Push"));
    expect(sent(calls, "POST /empower/push")[0]!.body).toMatchObject({ id: "LM-1000001" });
    expect(toastText()).toBe("LM-1000001 sent to Empower · Preparing");
    await click(byText(waitRow("LM-1000002"), "button", "Push"));
    expect(dialog().textContent).toMatch(/Omniful already has LM-1000002/);
    await click(byText(dialog(), "button", "Record it (send nothing)"));
    expect(sent(calls, "POST /empower/push")[2]!.body).toMatchObject({ id: "LM-1000002", adopt: true });
    expect(toastText()).toBe("LM-1000002 recorded as on Empower · Preparing");
  });

  // test-v402: one press, every order; the ones Omniful already had offered for recording
  it("Push all asks, loops on `left` until done, then offers the record from our earlier push", async () => {
    state.waiting = Array.from({ length: 8 }, (_, i) => W("LM-10000" + (21 + i))) as never;
    const asked: string[][] = [];
    const { calls } = stubFetch(
      routes({
        "POST /empower/push-many": (c) => {
          const ids = (c.body as { ids: string[] }).ids;
          asked.push(ids);
          const now = ids.slice(0, 6);
          return { ok: true, pushed: now.filter((x) => x !== "LM-1000022").length, left: ids.slice(6), failed: now.indexOf("LM-1000022") > -1 ? [{ id: "LM-1000022", error: "omniful_duplicate", detail: "order_id has already been taken" }] : [] };
        },
        "POST /empower/push": () => ({ ok: true, adopted: true, status: "prep" }),
      }),
    );
    const m = page();
    await settle();
    await click(byText(m.root, "button", "Push all"));
    expect(dialog().textContent).toMatch(/Push all 8 waiting orders to Omniful\?/);
    expect(dialog().textContent).toMatch(/Each moves to Preparing/);
    state.waiting = [];
    await click(byText(dialog(), "button", "Push all"));
    expect(asked.map((a) => a.length)).toEqual([8, 2]);
    expect(dialog().textContent).toMatch(/1 order is already in Omniful/);
    expect(dialog().textContent).toMatch(/LM-1000022/);
    await click(byText(dialog(), "button", "Record our earlier push"));
    expect(sent(calls, "POST /empower/push")[0]!.body).toEqual({ id: "LM-1000022", adopt: true });
    expect(toastText()).toBe("8 pushed · nothing waiting");
  });

  // test-v316: the switch asks before it goes on, and says what its last run did
  it("Auto push: asks first, then PUT {on}; its note", async () => {
    const { calls } = stubFetch(
      routes({
        "PUT /empower/auto": (c) => {
          state.auto = (c.body as { on: boolean }).on;
          return { ok: true, ...(STATUS().auto as object), on: state.auto };
        },
      }),
    );
    const m = page();
    await settle();
    expect(m.text()).toMatch(/Last run .*: 2 pushed · 1 held back \(check details\)\./);
    const b = byText(m.root, "button", "Auto push: Off")!;
    expect(b.getAttribute("aria-pressed")).toBe("false");
    await click(b);
    expect(dialog().textContent).toMatch(/WhatsApp orders typed in here are never sent automatically/);
    await click(byText(dialog(), "button", "Cancel"));
    expect(sent(calls, "PUT /empower/auto")).toHaveLength(0);
    await click(byText(m.root, "button", "Auto push: Off"));
    await click(byText(dialog(), "button", "Turn on"));
    expect(sent(calls, "PUT /empower/auto")[0]!.body).toEqual({ on: true });
    expect(toastText()).toBe("Auto push on");
    expect(byText(m.root, "button", "Auto push: On")!.getAttribute("aria-pressed")).toBe("true");
    expect(m.text()).toMatch(/On: complete website orders go to Empower 3 min after they are placed/);
    // off goes without asking
    await click(byText(m.root, "button", "Auto push: On"));
    expect(sent(calls, "PUT /empower/auto")[1]!.body).toEqual({ on: false });
  });

  it("Refresh only reads", async () => {
    const { calls } = stubFetch(routes());
    const m = page();
    await settle();
    await click(byText(m.root, "button", "Refresh"));
    // (the WhatsApp form's running total is a POST quote; nothing is sent to Omniful)
    expect(calls.filter((c) => c.method !== "GET" && c.path !== "/orders/manual/quote")).toHaveLength(0);
    expect(toastText()).toBe("Refreshed: 2 waiting");
  });

  it("no market routed to Empower says so", async () => {
    state.waiting = [];
    stubFetch(routes({ "GET /empower": () => STATUS({ routing: [{ code: "OM", name: "Oman", courier: "manual", chosen: true }] }) }));
    const m = page();
    await settle();
    expect(m.text()).toMatch(/No market is routed to Omniful yet/);
  });
});

describe("the WhatsApp order", () => {
  it("phase 1's form is on the tab; a created order reads the Waiting list again", async () => {
    const { calls } = stubFetch(
      routes({
        "POST /orders/manual/quote": () => ({ ok: true, cur: "OMR", sub: 25, ship: 0, codFee: 1, total: 26, omr: 26, pay: "cod" }),
        "POST /orders/manual": () => ({ ok: true, id: "LM-1000099", already: false, cur: "OMR", sub: 25, ship: 0, codFee: 1, total: 26, omr: 26 }),
      }),
    );
    const m = page();
    await settle();
    const form = document.querySelector(".omf-wa") as HTMLElement;
    expect(form.textContent).toMatch(/New WhatsApp order/);
    const inputs = form.querySelectorAll<HTMLInputElement>(".form-grid input");
    await type(inputs[0]!, "Salim");
    await type(inputs[1]!, "91234567");
    // Oman: the governorate is a list
    const gov = [...form.querySelectorAll<HTMLSelectElement>(".form-grid select")].find((x) => x.querySelector("option[value='']"))!;
    gov.value = gov.options[1]!.value;
    gov.dispatchEvent(new Event("change", { bubbles: true }));
    await settle();
    const before = sent(calls, "GET /empower/waiting").length;
    await click(byText(form, "button", "Create order"));
    void m;
    expect(sent(calls, "POST /orders/manual")[0]!.body).toMatchObject({ countryCode: "OM", name: "Salim", phone: "91234567", items: [{ itemId: "oud-large", qty: 1 }] });
    expect(toastText()).toMatch(/Created LM-1000099/);
    expect(sent(calls, "GET /empower/waiting").length).toBeGreaterThan(before);
  });
});

describe("pushed to Omniful", () => {
  it("15 a page, the stage filter, the search", async () => {
    stubFetch(routes());
    const m = page();
    await settle();
    const rows = () => document.querySelectorAll(".omf-pushed tbody tr.row");
    expect(rows()).toHaveLength(15);
    expect(m.text()).toMatch(/20 of 20/);
    expect(m.text()).toMatch(/15 of 20/);
    await click(document.querySelector('[aria-label="Next page"]'));
    expect(rows()).toHaveLength(5);
    const stage = document.querySelector('select[aria-label="Stage"]') as HTMLSelectElement;
    stage.value = "problem";
    stage.dispatchEvent(new Event("change", { bubbles: true }));
    await settle();
    expect(rows()).toHaveLength(1);
    expect(rows()[0]!.textContent).toMatch(/Shipment Refused/);
    expect(rows()[0]!.textContent).toMatch(/Consignee refused the parcel/);
    await click(byText(document.querySelector(".omf-pushed")!.closest(".card")!, "button", "Clear"));
    await type(document.querySelector('input[aria-label="Search what was pushed"]'), "OMF12");
    expect(rows()).toHaveLength(1);
  });

  // test-v338: the tracking message, copied; Take off with the mark-only fallback
  it("a row opens to Omniful's record and the order; the tracking message; Take off Empower", async () => {
    let n = 0;
    const { calls } = stubFetch(
      routes({
        "POST /empower/take-off": (c) => {
          n++;
          if (!(c.body as { markOnly?: boolean }).markOnly) return [409, { ok: false, error: "omniful_rejected", detail: "Order already cancelled", upstream: 400 }];
          return { ok: true, status: "new" };
        },
      }),
    );
    const copied: string[] = [];
    vi.stubGlobal("isSecureContext", true);
    Object.defineProperty(navigator, "clipboard", { value: { writeText: async (t: string) => void copied.push(t) }, configurable: true });
    page();
    await settle();
    const row = [...document.querySelectorAll(".omf-pushed tbody tr.row")].find((r) => r.querySelector(".id")!.textContent!.startsWith("LM-2000001"))!;
    await click(row.querySelector(".id"));
    const det = document.querySelector("#omf-pdet-omf-LM-2000001") as HTMLElement;
    expect(det.textContent).toMatch(/Their refOMF1/);
    expect(det.textContent).toMatch(/AWB44121/);
    expect(det.textContent).toMatch(/Collect25 AED on delivery/);
    // read-only: no Edit on a pushed order
    expect(det.querySelector('[aria-label^="Edit the"]')).toBeNull();
    await click(byText(det, "button", "Copy tracking message"));
    expect(copied[0]).toContain("44121");
    await click(byText(det, "button", "Take off Empower"));
    expect(dialog().textContent).toMatch(/Take LM-2000001 off Empower\?/);
    await click(byText(dialog(), "button", "Take off Empower"));
    expect(dialog().textContent).toMatch(/remove the Empower mark here anyway\?/);
    await click(byText(dialog(), "button", "Remove the mark"));
    expect(sent(calls, "POST /empower/take-off").map((c) => c.body)).toEqual([{ id: "LM-2000001" }, { id: "LM-2000001", markOnly: true }]);
    expect(n).toBe(2);
    expect(toastText()).toBe("Empower mark removed from LM-2000001");
  });

  it("a delivered parcel has nothing to take off; one with no waybill has no tracking message", async () => {
    stubFetch(routes({ "GET /orders/LM-2000004": () => ORDER("LM-2000004", { status: "done" }) }));
    page();
    await settle();
    const row = [...document.querySelectorAll(".omf-pushed tbody tr.row")].find((r) => r.querySelector(".id")!.textContent!.startsWith("LM-2000004"))!;
    await click(row.querySelector(".id"));
    const det = document.querySelector("#omf-pdet-omf-LM-2000004") as HTMLElement;
    expect(det.textContent).toMatch(/Delivered\. Nothing to cancel\./);
    expect(byText(det, "button", "Copy tracking message")).toBeNull();
  });

  it("Check statuses reads Omniful and says what changed", async () => {
    const { calls } = stubFetch(routes({ "POST /empower/sync": () => ({ ok: true, tracked: 5, updated: 2, moved: 1, errors: [] }) }));
    const m = page();
    await settle();
    await click(byText(m.root, "button", "Check statuses"));
    expect(sent(calls, "POST /empower/sync")).toHaveLength(1);
    expect(toastText()).toBe("Omniful: 5 checked · 2 changed · 1 order moved");
  });
});

describe("routes and SKU codes", () => {
  it("one route per market, a radio; saved at once", async () => {
    const { calls } = stubFetch(routes({ "PUT /empower/routes/AE": () => ({ ok: true, code: "AE", courier: "manual" }) }));
    const m = page();
    await settle();
    expect(m.text()).toMatch(/2 of 3 markets go to Omniful/);
    const group = document.querySelector('[aria-label="Who carries UAE"]') as HTMLElement;
    expect(group.textContent).toMatch(/default/);
    const radios = group.querySelectorAll<HTMLInputElement>("input[type=radio]");
    expect(radios[0]!.checked).toBe(true);
    await click(radios[1]!);
    expect(sent(calls, "PUT /empower/routes/AE")[0]!.body).toEqual({ courier: "manual" });
    expect(toastText()).toBe("AE now goes by hand");
  });

  it("Match from Omniful fills the boxes and marks a name typed for a code; Save sends the map", async () => {
    const { calls } = stubFetch(
      routes({
        "POST /empower/skus/match": () => ({ ok: true, known: 4, matches: { "oud-large": { sku: "LM3001", problem: null }, burner: { sku: null, problem: null }, bundle: { sku: "KIT1", problem: null } } }),
        "GET /empower/catalog": () => ({ ok: true, skus: [{ sku_code: "LM3001", name: "oud-large" }, { sku_code: "KIT1", name: "Bundle kit" }] }),
        "PUT /empower/skus": (c) => ({ ok: true, skus: Object.fromEntries(Object.entries((c.body as { skus: Record<string, string> }).skus).filter(([, v]) => v)) }),
      }),
    );
    const m = page();
    await settle();
    expect(m.text()).toMatch(/1 of 2 set/);
    await click(byText(m.root, "button", "Match from Omniful"));
    expect(toastText()).toBe("1 filled in from Omniful's 4 SKUs. Check, then Save.");
    expect((document.querySelector('input[aria-label="Omniful SKU for Set (bundle)"]') as HTMLInputElement).value).toBe("KIT1");
    await click(byText(m.root, "button", "Save SKU codes"));
    expect(sent(calls, "PUT /empower/skus")[0]!.body).toEqual({ skus: { "oud-large": "LM3001", bundle: "KIT1" } });
    expect(toastText()).toBe("SKU codes saved");
  });

  it("a code Omniful does not know is marked", async () => {
    stubFetch(routes({ "POST /empower/skus/match": () => ({ ok: true, known: 4, matches: { "oud-large": { sku: null, problem: "Omniful has no SKU with this code" } } }), "GET /empower/catalog": () => ({ ok: true, skus: [] }) }));
    const m = page();
    await settle();
    await click(byText(m.root, "button", "Match from Omniful"));
    const box = document.querySelector('input[aria-label="Omniful SKU for Oud · Large"]') as HTMLInputElement;
    expect(box.getAttribute("aria-invalid")).toBe("true");
    expect(m.text()).toMatch(/Omniful has no SKU with this code/);
  });
});
