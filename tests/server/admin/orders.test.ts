import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { orders } from "../../../src/server/db/schema";
import { createHarness, type Harness } from "../../helpers/harness";
import { seedOrders, seedShipment } from "../orders/fixtures";
import { adminClient, trail, type AdminClient } from "./_helpers";

let h: Harness;
let a: AdminClient;

beforeAll(async () => {
  h = await createHarness();
});
beforeEach(async () => {
  await h.reset();
  a = await adminClient(h);
});

const auditOnly = async () => (await trail(h)).filter((r) => r.action !== "session.login");

describe("the list", () => {
  it("filters, pages and leaves the raw payloads out", async () => {
    await seedOrders(h, [
      { id: "LM-1000000001", countryCode: "OM", cur: "OMR", status: "new", gateway: { mode: "uat", payment: { id: "x" } }, client: { ip: "1.2.3.4" } },
      { id: "LM-1000000002", status: "prep", flagged: true },
      { id: "LM-1000000003", status: "done", trashed: true, total: 999 },
      { id: "LM-1000000004", status: "void", pay: "card", paymentStatus: "cancelled" },
    ]);
    let r = await a.get("/orders");
    expect(r.status).toBe(200);
    // from test-admin-boot.js: a binned order is not in the working list
    expect(r.body.orders.map((o: { id: string }) => o.id).sort()).toEqual(["LM-1000000001", "LM-1000000002", "LM-1000000004"]);
    expect(r.body.total).toBe(3);
    const first = r.body.orders.find((o: { id: string }) => o.id === "LM-1000000001");
    expect(first.hasGateway).toBe(true);
    expect(first.gateway).toBeUndefined();
    expect(first.client).toBeUndefined();
    // from test-v408.js: the list carries the flag; the Flagged filter matches any status
    r = await a.get("/orders?flagged=1");
    expect(r.body.orders.map((o: { id: string }) => o.id)).toEqual(["LM-1000000002"]);
    expect(r.body.orders[0].flagged).toBe(true);
    expect((await a.get("/orders?trash=1")).body.orders.map((o: { id: string }) => o.id)).toEqual(["LM-1000000003"]);
    expect((await a.get("/orders?trash=all")).body.total).toBe(4);
    expect((await a.get("/orders?status=new,prep")).body.total).toBe(2);
    expect((await a.get("/orders?country=om")).body.total).toBe(1);
    expect((await a.get("/orders?pay=card&payment=cancelled")).body.total).toBe(1);
    expect((await a.get("/orders?q=1000000002")).body.total).toBe(1);
    const page = await a.get("/orders?limit=2&offset=2");
    expect(page.body.orders.length).toBe(1);
    expect(page.body).toMatchObject({ limit: 2, offset: 2, total: 3 });
    expect((await a.get("/orders?status=flying")).status).toBe(400);
  });

  // from test-v204 (orders.list since): nothing new, nothing sent
  it("answers `unchanged` to the timed refresh when nothing moved", async () => {
    await seedOrders(h, [{ id: "LM-1000000001" }]);
    const first = await a.get("/orders");
    const tag = first.body.tag;
    expect(tag).toMatch(/^[A-Za-z0-9_-]{20}$/);
    const again = await a.get("/orders?since=" + tag);
    expect(again.body).toEqual({ ok: true, unchanged: true, tag });
    await a.put("/orders/LM-1000000001/flag", { on: true });
    const moved = await a.get("/orders?since=" + tag);
    expect(moved.body.unchanged).toBeUndefined();
    expect(moved.body.orders[0].flagged).toBe(true);
  });

  it("carries each order's newest Empower send", async () => {
    await seedOrders(h, [{ id: "LM-1000000001", status: "prep" }]);
    await seedShipment(h, { orderId: "LM-1000000001", awb: "44123", status: "picked_up", courierName: "Aramex" });
    const r = await a.get("/orders");
    expect(r.body.orders[0].shipment).toMatchObject({ awb: "44123", courier: "Aramex", status: "picked_up" });
    expect(r.body.empowerUnsure).toEqual([]);
  });
});

describe("one order", () => {
  it("reads in full; the gateway payload only when asked", async () => {
    await seedOrders(h, [{ id: "LM-1000000001", gateway: { mode: "uat", payment: { id: "pay_1" } }, client: { ip: "1.2.3.4" } }]);
    let r = await a.get("/orders/LM-1000000001");
    expect(r.status).toBe(200);
    expect(r.body.order.id).toBe("LM-1000000001");
    expect(r.body.order.hasGateway).toBe(true);
    expect(r.body.order.gateway).toBeUndefined();
    expect(r.body.order.client).toBeUndefined();
    expect(Array.isArray(r.body.events)).toBe(true);
    r = await a.get("/orders/LM-1000000001?gateway=1");
    expect(r.body.order.gateway).toEqual({ mode: "uat", payment: { id: "pay_1" } });
    r = await a.get("/orders/LM-1000000001/gateway");
    expect(r.body).toEqual({ ok: true, id: "LM-1000000001", gateway: { mode: "uat", payment: { id: "pay_1" } } });
    expect((await a.get("/orders/LM-9999999999")).status).toBe(404);
    expect((await a.get("/orders/nope")).body.error).toBe("no_id");
  });

  // from test-v329.js: the audit trail — who, what, which order, what was asked
  it("audits every write that succeeded, never a read or a refusal, never a customer's details", async () => {
    await seedOrders(h, [{ id: "LM-1000000001", name: "Sara Al Hinai", city: "Sohar" }, { id: "LM-1000000005", status: "done" }]);
    await a.get("/orders");
    await a.get("/orders/LM-1000000001");
    let r = await a.post("/orders/LM-1000000001/status", { to: "prep" });
    expect(r.body).toMatchObject({ ok: true, id: "LM-1000000001", from: "new", to: "prep", changed: true });
    r = await a.put("/orders/LM-1000000001/note", { note: "call first" });
    expect(r.body.updated).toBe(1);
    // from test-v334.js: a customer correction names the fields, never their values
    r = await a.patch("/orders/LM-1000000001/customer", { city: "Muscat", phone: "+968 9123 4567" });
    expect(r.status).toBe(200);
    // refused writes are not recorded
    expect((await a.post("/orders/LM-9999999999/status", { to: "prep" })).status).toBe(404);
    expect((await a.post("/orders/LM-1000000005/status", { to: "new" })).body.error).toBe("moving_back");
    const t = await auditOnly();
    expect(t.map((x) => x.action)).toEqual(["orders.status", "orders.note", "orders.customer"]);
    expect(t.every((x) => x.actor === "shopkeeper")).toBe(true);
    expect(t[0]).toMatchObject({ target: "LM-1000000001", summary: { to: "prep" } });
    expect(t[2]!.summary).toEqual({ fields: ["phone", "city"] });
    const all = JSON.stringify(t);
    for (const secret of ["Sara", "Sohar", "Muscat", "9123", "call first"]) expect(all).not.toContain(secret);
    // audit.list reads it back
    const list = await a.get("/audit?days=30");
    expect(list.body.days).toBe(30);
    expect(list.body.rows.map((x: { action: string }) => x.action)).toEqual(["orders.customer", "orders.note", "orders.status", "session.login"]);
  });

  it("moves to Shipped by hand with a tracking number and carrier", async () => {
    await seedOrders(h, [{ id: "LM-1000000001", status: "prep" }]);
    const r = await a.put("/orders/LM-1000000001/tracking", { tracking: "TRK123", carrier: "DHL", ship: true });
    expect(r.body).toMatchObject({ ok: true, to: "ship" });
    const [o] = await h.db.select().from(orders).where(eq(orders.id, "LM-1000000001"));
    expect(o).toMatchObject({ status: "ship", tracking: "TRK123", carrier: "DHL" });
    expect(o!.shippedAt).toBeTruthy();
  });

  it("re-quotes the items with the till's pricing", async () => {
    await seedOrders(h, [{ id: "LM-1000000001" }]);
    const r = await a.put("/orders/LM-1000000001/items", { items: [{ itemId: "oud-large", qty: 2 }] });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, cur: "AED", was: 260 });
    expect(r.body.items[0]).toMatchObject({ itemId: "oud-large", qty: 2, price: 250 });
    // no price from the request: an unknown item is the till's refusal
    const bad = await a.put("/orders/LM-1000000001/items", { items: [{ itemId: "teapot", qty: 1 }] });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toBe("unknown_item");
    const t = await auditOnly();
    expect(t.map((x) => x.action)).toEqual(["orders.items"]);
    expect(t[0]!.summary).toMatchObject({ lines: ["oud-large×2"], manual: false });
  });

  it("marks a cash order collected", async () => {
    await seedOrders(h, [{ id: "LM-1000000001", status: "done" }, { id: "LM-1000000002", pay: "card", paymentStatus: "paid" }]);
    expect((await a.post("/orders/LM-1000000001/payment", { to: "paid" })).body).toMatchObject({ ok: true, updated: 1 });
    expect((await a.post("/orders/LM-1000000002/payment", { to: "cod" })).body.error).toBe("card_payment_is_the_gateways");
  });
});

describe("the bulk bar", () => {
  // from test-trash.js
  it("bins, restores and purges — never a paid order, never one not binned", async () => {
    await seedOrders(h, [
      { id: "LM-1000000001", paymentStatus: "cod" },
      { id: "LM-1000000002", pay: "card", paymentStatus: "paid", paymentId: "pay_abc123" },
    ]);
    let r = await a.post("/orders/bulk", { op: "trash", ids: ["LM-1000000001"] });
    expect(r.body).toMatchObject({ ok: true, op: "trash", updated: 1, trashed: true });
    let [o] = await h.db.select().from(orders).where(eq(orders.id, "LM-1000000001"));
    expect(o!.trashed).toBe(true);
    expect(o!.trashedAt).toBeTruthy();
    r = await a.post("/orders/bulk", { op: "restore", ids: ["LM-1000000001"] });
    [o] = await h.db.select().from(orders).where(eq(orders.id, "LM-1000000001"));
    expect(o!.trashed).toBe(false);
    expect(o!.trashedAt).toBeNull();
    // a paid order can be binned
    expect((await a.post("/orders/bulk", { op: "trash", ids: ["LM-1000000002"] })).body.updated).toBe(1);
    expect((await a.post("/orders/bulk", { op: "purge", ids: ["LM-1000000002"] })).body.error).toBe("paid_orders_cannot_be_deleted");
    expect((await a.post("/orders/bulk", { op: "purge", ids: ["LM-1000000001"] })).body.error).toBe("must_be_trashed_first");
    await a.post("/orders/bulk", { op: "trash", ids: ["LM-1000000001"] });
    // mixed batch: refused whole
    r = await a.post("/orders/bulk", { op: "purge", ids: ["LM-1000000001", "LM-1000000002"] });
    expect(r.status).toBe(409);
    expect((await h.db.select().from(orders)).length).toBe(2);
    r = await a.post("/orders/bulk", { op: "purge", ids: ["LM-1000000001"] });
    expect(r.body).toMatchObject({ ok: true, deleted: 1 });
    // empty ids → 400
    expect((await a.post("/orders/bulk", { op: "trash", ids: [] })).status).toBe(400);
    const t = await auditOnly();
    expect(t.map((x) => x.action)).toEqual(["orders.bulk.trash", "orders.bulk.restore", "orders.bulk.trash", "orders.bulk.trash", "orders.bulk.purge"]);
    expect(t[4]!.target).toBe("LM-1000000001");
  });

  // from test-v408.js: the flag
  it("flags in bulk; status in bulk follows the rules for the whole selection", async () => {
    await seedOrders(h, [
      { id: "LM-1000000001", flagged: true },
      { id: "LM-1000000002", flagged: true },
      { id: "LM-1000000003", status: "pending", pay: "card", paymentStatus: "unpaid" },
    ]);
    let r = await a.post("/orders/bulk", { op: "flag", ids: ["LM-1000000001", "LM-1000000002"], on: false });
    expect(r.body).toMatchObject({ ok: true, updated: 2, flagged: false });
    const rows = await h.db.select().from(orders);
    expect(rows.filter((x) => x.id !== "LM-1000000003").every((x) => x.flagged === false && x.flaggedAt === null)).toBe(true);
    r = await a.post("/orders/bulk", { op: "status", ids: ["LM-1000000001", "LM-1000000003"], to: "ship" });
    expect(r.status).toBe(409);
    expect(r.body).toMatchObject({ error: "awaiting_payment", ids: ["LM-1000000003"] });
    r = await a.post("/orders/bulk", { op: "status", ids: ["LM-1000000001", "LM-1000000002"], to: "prep" });
    expect(r.body).toMatchObject({ ok: true, updated: 2, stale: [] });
  });
});

describe("the typed-in order, the export, the options", () => {
  it("creates a WhatsApp order, priced by the till; the same form twice is one order", async () => {
    const form = { name: "Khalid Test", phone: "91234567", countryCode: "om", city: "مسقط", items: [{ itemId: "oud-large", qty: 1 }], pay: "cod" as const, dedupeId: "form-abc-123" };
    const q = await a.post("/orders/manual/quote", { countryCode: "OM", items: form.items });
    expect(q.body).toMatchObject({ ok: true, cur: "OMR" });
    expect(q.body.quote).toBeUndefined();
    const r = await a.post("/orders/manual", form);
    expect(r.body).toMatchObject({ ok: true, already: false, cur: "OMR" });
    expect(r.body.id).toMatch(/^LM-\d{10}$/);
    const again = await a.post("/orders/manual", form);
    expect(again.body).toMatchObject({ already: true, id: r.body.id });
    const [o] = await h.db.select().from(orders);
    expect(o).toMatchObject({ origin: "whatsapp_order", phone: "+968 91234567", status: "new", paymentStatus: "cod" });
    const t = await auditOnly();
    expect(t.map((x) => x.action)).toEqual(["orders.create"]);
    expect(JSON.stringify(t)).not.toContain("Khalid");
    expect(JSON.stringify(t)).not.toContain("91234567");
  });

  it("exports the list as CSV (formula cells defused) and records it", async () => {
    await seedOrders(h, [{ id: "LM-1000000001", name: "=HYPERLINK(1)" }]);
    const res = await h.request("/api/admin/orders/export.csv?country=AE", { headers: { cookie: a.cookie } });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
    expect(res.headers.get("content-disposition")).toMatch(/attachment; filename="orders-\d{4}-\d{2}-\d{2}\.csv"/);
    const text = await res.text();
    expect(text.split("\r\n")[0]).toMatch(/^Order,Placed \(Muscat\),Status/);
    expect(text).toContain("LM-1000000001");
    expect(text).toContain("'=HYPERLINK(1)");
    const t = await auditOnly();
    expect(t[0]).toMatchObject({ action: "orders.export", summary: { rows: 1, filters: "country" } });
  });

  // from test-extras.js (panel): the editor gets the market's add-ons; sold out marked, not hidden
  it("offers the editors every item of a market, sold out marked", async () => {
    const r = await a.get("/orders/options?country=OM");
    expect(r.body).toMatchObject({ ok: true, country: "OM", cur: "OMR", dec: 3 });
    const ids = r.body.items.map((i: { itemId: string }) => i.itemId);
    expect(ids).toEqual(expect.arrayContaining(["oud-large", "bundle", "burner", "samples"]));
    const burner = r.body.items.find((i: { itemId: string }) => i.itemId === "burner");
    expect(burner).toMatchObject({ kind: "extra", price: 6, soldOut: false });
    expect(r.body.items.every((i: { soldOut: unknown; active: unknown }) => typeof i.soldOut === "boolean" && typeof i.active === "boolean")).toBe(true);
    expect((await a.get("/orders/options?country=XX")).body.error).toBe("unknown_country");
  });
});

describe("customers", () => {
  it("lists customers and keeps notes and tags — the phone never on the trail", async () => {
    await seedOrders(h, [{ id: "LM-1000000001" }, { id: "LM-1000000002" }]);
    const list = await a.get("/customers");
    expect(list.body.customers).toHaveLength(1);
    expect(list.body.customers[0]).toMatchObject({ phoneKey: "971501234567", orders: 2 });
    const r = await a.put("/customers/971501234567", { note: "prefers evening calls", tags: ["VIP"] });
    expect(r.body).toMatchObject({ ok: true, note: "prefers evening calls", tags: ["vip"] });
    expect((await a.get("/crm")).body.crm["971501234567"]).toEqual({ note: "prefers evening calls", tags: ["vip"] });
    const t = await auditOnly();
    expect(t[0]!.action).toBe("customers.note");
    expect(t[0]!.target).toMatch(/^crm:[0-9a-f]{12}$/);
    expect(JSON.stringify(t)).not.toContain("971501234567");
    expect(JSON.stringify(t)).not.toContain("evening");
  });
});
