/**
 * The Orders tab, the order editors, the bulk bar, the typed-in (WhatsApp) order, the export,
 * and the customers (CRM). The rules are domain/order-admin.ts's; this file validates, calls,
 * audits.
 */
import { createHash } from "node:crypto";
import type { Hono } from "hono";
import {
  BulkBody, CrmBody, CustomerBody, CustomersQuery, FlagBody, ItemsBody, ManualOrderBody, ManualQuoteBody, NoteBody,
  OptionsQuery, OrderDetailQuery, OrdersQuery, ORDER_ID_RE, PaymentBody, StatusBody, TrackingBody,
} from "../../../shared/admin/api";
import type { AppEnv, Deps } from "../../core/deps";
import { fail } from "../../core/http";
import { orderItemOptions } from "../../domain/admin/options";
import { ordersSummary } from "../../domain/admin/panel";
import { empowerRecords } from "../../domain/empower/admin";
import {
  bulkSetStatus, createManualOrder, exportOrders, listCrm, listCustomers, listOrders, orderDetail, purgeOrders,
  quoteManualOrder, requoteItems, saveCrm, setFlag, setNote, setPayment, setStatus, setTracking, setTrashed, toCsv,
  updateCustomer, type ListFilters,
} from "../../domain/order-admin";
import { getOrder } from "../../domain/orders";
import { actor, audit, body, download, query, type Ctx } from "./kit";

function orderIdParam(c: Ctx): string {
  const id = c.req.param("id") || "";
  if (!ORDER_ID_RE.test(id)) throw fail("no_id", 400);
  return id;
}

function filtersOf(q: ReturnType<typeof OrdersQuery.parse>): ListFilters & { limit?: number; offset?: number } {
  return {
    status: q.status && q.status.length ? q.status : undefined,
    pay: q.pay,
    paymentStatus: q.payment,
    country: q.country,
    origin: q.origin,
    flagged: q.flagged === true ? true : undefined,
    trashed: q.trash === "1" ? true : q.trash === "all" ? "all" : false,
    q: q.q,
    from: q.from,
    to: q.to,
    limit: q.limit,
    offset: q.offset,
  };
}

const tagOf = (v: unknown) => createHash("sha1").update(JSON.stringify(v)).digest("base64url").slice(0, 20);

const lineWords = (items: Array<{ itemId: string; qty: number }>) => items.map((i) => i.itemId + "×" + i.qty);

/** A customer key in the trail: never the phone itself. */
const crmTarget = (key: string) => "crm:" + createHash("sha256").update("lm-crm:" + key).digest("hex").slice(0, 12);

async function unsureOf(deps: Deps, ids: string[]): Promise<string[]> {
  try {
    return (await empowerRecords(deps, ids)).unsure;
  } catch {
    return [];
  }
}

export function registerOrderRoutes(r: Hono<AppEnv>): void {
  /* ---------------- the list ---------------- */

  r.get("/orders", async (c) => {
    const deps = c.get("deps");
    const q = query(c, OrdersQuery);
    const out = await listOrders(deps, filtersOf(q));
    // NOTHING NEW, NOTHING SENT (v204): the timed refresh sends back the last tag
    const tag = tagOf([out.orders, out.total, out.offset, out.limit]);
    if (q.since && q.since === tag) return c.json({ ok: true, unchanged: true, tag });
    const empowerUnsure = await unsureOf(deps, out.orders.map((o) => String(o.id)));
    return c.json({ ...out, tag, empowerUnsure });
  });

  r.get("/orders/summary", async (c) => c.json({ ok: true, ...(await ordersSummary(c.get("deps"))) }));

  r.get("/orders/options", async (c) => c.json(await orderItemOptions(c.get("deps"), query(c, OptionsQuery).country)));

  r.get("/orders/export.csv", async (c) => {
    const deps = c.get("deps");
    const q = query(c, OrdersQuery);
    const f = filtersOf(q);
    delete f.limit;
    delete f.offset;
    const out = await exportOrders(deps, f);
    // customer data leaving the shop: on the trail too
    await audit(c, "orders.export", { target: null, summary: { rows: out.rows.length, filters: Object.keys(q).filter((k) => (q as Record<string, unknown>)[k] !== undefined).join(",") } });
    return download(c, "orders-" + out.day + ".csv", "text/csv; charset=utf-8", toCsv(out.columns, out.rows));
  });

  /* ---------------- the typed-in order ---------------- */

  r.post("/orders/manual/quote", async (c) => {
    const b = await body(c, ManualQuoteBody);
    const { quote: _q, ...rest } = await quoteManualOrder(c.get("deps"), b);
    void _q;
    return c.json(rest);
  });

  r.post("/orders/manual", async (c) => {
    const b = await body(c, ManualOrderBody);
    const out = await createManualOrder(c.get("deps"), b, { actor: actor(c) });
    if (!out.already) {
      await audit(c, "orders.create", {
        target: out.id,
        summary: { country: b.countryCode, pay: b.pay || "cod", lines: lineWords(b.items), codAmount: out.codAmount ?? null, total: out.total },
      });
    }
    return c.json(out);
  });

  /* ---------------- the bulk bar ---------------- */

  r.post("/orders/bulk", async (c) => {
    const deps = c.get("deps");
    const b = await body(c, BulkBody);
    const who = { actor: actor(c) };
    let out: Record<string, unknown>;
    switch (b.op) {
      case "status":
        out = await bulkSetStatus(deps, b.ids, b.to, { ...who, force: b.force, tracking: b.tracking, carrier: b.carrier });
        break;
      case "flag":
        out = await setFlag(deps, b.ids, b.on, who);
        break;
      case "note":
        out = await setNote(deps, b.ids, b.note, who);
        break;
      case "payment":
        out = await setPayment(deps, b.ids, b.to, who);
        break;
      case "trash":
      case "restore":
        out = await setTrashed(deps, b.ids, b.op === "trash", who);
        break;
      case "purge":
        out = await purgeOrders(deps, b.ids);
        break;
    }
    await audit(c, "orders.bulk." + b.op, { body: b, answer: out });
    return c.json({ ...out, op: b.op });
  });

  /* ---------------- one order ---------------- */

  r.get("/orders/:id", async (c) => {
    const id = orderIdParam(c);
    const q = query(c, OrderDetailQuery);
    const d = await orderDetail(c.get("deps"), id);
    const { gateway, client, ...order } = d.order;
    void client;
    return c.json({ ...d, order: { ...order, hasGateway: gateway != null, ...(q.gateway ? { gateway } : {}) } });
  });

  r.get("/orders/:id/gateway", async (c) => {
    const id = orderIdParam(c);
    const o = await getOrder(c.get("deps").db, id);
    if (!o) throw fail("no_such_order", 404, { id });
    return c.json({ ok: true, id, gateway: o.gateway || null });
  });

  r.patch("/orders/:id/customer", async (c) => {
    const id = orderIdParam(c);
    const b = await body(c, CustomerBody);
    const out = await updateCustomer(c.get("deps"), id, b, { actor: actor(c) });
    await audit(c, "orders.customer", { target: id, summary: { fields: Object.keys(out.patch) } });
    return c.json(out);
  });

  r.put("/orders/:id/items", async (c) => {
    const id = orderIdParam(c);
    const b = await body(c, ItemsBody);
    const out = await requoteItems(c.get("deps"), id, b, { actor: actor(c) });
    await audit(c, "orders.items", { target: id, summary: { lines: lineWords(b.items), manual: b.manual === true, codAmount: out.codAmount, was: out.was, total: out.total } });
    return c.json(out);
  });

  r.post("/orders/:id/status", async (c) => {
    const id = orderIdParam(c);
    const b = await body(c, StatusBody);
    const out = await setStatus(c.get("deps"), id, b.to, { ...b, actor: actor(c) });
    await audit(c, "orders.status", { target: id, body: b, answer: out });
    return c.json(out);
  });

  r.put("/orders/:id/tracking", async (c) => {
    const id = orderIdParam(c);
    const b = await body(c, TrackingBody);
    const out = await setTracking(c.get("deps"), id, b, { actor: actor(c) });
    await audit(c, "orders.tracking", { target: id, body: b });
    return c.json(out);
  });

  r.post("/orders/:id/payment", async (c) => {
    const id = orderIdParam(c);
    const b = await body(c, PaymentBody);
    const out = await setPayment(c.get("deps"), id, b.to, { actor: actor(c) });
    await audit(c, "orders.payment", { target: id, body: b, answer: out });
    return c.json(out);
  });

  r.put("/orders/:id/flag", async (c) => {
    const id = orderIdParam(c);
    const b = await body(c, FlagBody);
    const out = await setFlag(c.get("deps"), id, b.on, { actor: actor(c) });
    if (!out.updated) throw fail("no_such_order", 404, { id });
    await audit(c, "orders.flag", { target: id, body: b });
    return c.json(out);
  });

  r.put("/orders/:id/note", async (c) => {
    const id = orderIdParam(c);
    const b = await body(c, NoteBody);
    const out = await setNote(c.get("deps"), id, b.note, { actor: actor(c) });
    if (!out.updated) throw fail("no_such_order", 404, { id });
    await audit(c, "orders.note", { target: id, summary: { note: b.note ? "(changed)" : "(cleared)" } });
    return c.json(out);
  });

  /* ---------------- customers ---------------- */

  r.get("/customers", async (c) => {
    const q = query(c, CustomersQuery);
    return c.json(await listCustomers(c.get("deps"), q));
  });

  r.get("/crm", async (c) => c.json(await listCrm(c.get("deps"))));

  r.put("/customers/:key", async (c) => {
    const key = c.req.param("key") || "";
    const b = await body(c, CrmBody);
    const out = await saveCrm(c.get("deps"), key, b);
    await audit(c, "customers.note", { target: crmTarget(out.phoneKey), summary: { note: out.note ? "(changed)" : "(cleared)", tags: out.tags.length } });
    return c.json(out);
  });
}
