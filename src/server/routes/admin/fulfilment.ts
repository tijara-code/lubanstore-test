/**
 * The Payments tab (domain/payments) and the Empower tab + Stock Tracker (domain/empower,
 * domain/stock): validated, called, audited.
 */
import type { Hono } from "hono";
import {
  AutoBody, MarkPaidBody, ORDER_ID_RE, PaymentsQuery, PushBody, PushedQuery, PushManyBody, RefundBody, RouteBody,
  SkuMatchBody, SkusBody, StockQuery, TakeOffBody,
} from "../../../shared/admin/api";
import { dayStart } from "../../../shared/time";
import type { AppEnv } from "../../core/deps";
import { fail } from "../../core/http";
import { loadCatalogue } from "../../domain/catalogue";
import {
  autoSwitch, catalogSkus, empowerStatus, matchSkus, pushedList, pushMany, pushOne, saveSkus, setRoute, syncNow,
  takeOff, waitingList,
} from "../../domain/empower/admin";
import { skuByItem } from "../../domain/empower/shelf";
import { readSkus } from "../../domain/empower/store";
import { SWEEP_MAX } from "../../domain/empower/push";
import { askThawani, listPayments, markPaidByHand } from "../../domain/payments/admin";
import { refundPayment } from "../../domain/payments/refunds";
import { stockStatus } from "../../domain/stock";
import { actor, audit, body, query } from "./kit";

/** a Muscat day → its first ms (from) or the first ms after it (to); ms pass through */
function msOf(v: number | string | undefined, end: boolean): number | undefined {
  if (v === undefined) return undefined;
  if (typeof v === "number") return v;
  const t = dayStart(v);
  return Number.isFinite(t) ? t + (end ? 86400e3 : 0) : undefined;
}

export function registerFulfilmentRoutes(r: Hono<AppEnv>): void {
  /* ---------------- payments ---------------- */

  r.get("/payments", async (c) => {
    const q = query(c, PaymentsQuery);
    const args: Parameters<typeof listPayments>[1] = { limit: q.limit, skip: q.skip, from: msOf(q.from, false), to: msOf(q.to, true) };
    if (q.lookups !== undefined) args.lookups = q.lookups;
    return c.json(await listPayments(c.get("deps"), args));
  });

  r.get("/payments/ask/:id", async (c) => {
    const id = c.req.param("id") || "";
    if (!ORDER_ID_RE.test(id)) throw fail("no_id", 400);
    return c.json(await askThawani(c.get("deps"), id));
  });

  r.post("/payments/refund", async (c) => {
    const b = await body(c, RefundBody);
    const out = await refundPayment(c.get("deps"), b, actor(c));
    await audit(c, "payments.refund", { body: b, answer: out, summary: { paymentId: b.paymentId, reason: "(given)" } });
    return c.json(out);
  });

  r.post("/payments/mark-paid", async (c) => {
    const b = await body(c, MarkPaidBody);
    const out = await markPaidByHand(c.get("deps"), b, actor(c));
    await audit(c, "payments.mark_paid", { body: b, answer: out });
    return c.json(out);
  });

  /* ---------------- Empower ---------------- */

  r.get("/empower", async (c) => c.json(await empowerStatus(c.get("deps"))));
  r.get("/empower/waiting", async (c) => c.json(await waitingList(c.get("deps"))));
  r.get("/empower/pushed", async (c) => c.json(await pushedList(c.get("deps"), { limit: query(c, PushedQuery).limit })));

  r.post("/empower/push", async (c) => {
    const deps = c.get("deps");
    const b = await body(c, PushBody);
    const out = await pushOne(deps, { ...b, deadline: deps.now() + 9000 }, actor(c));
    await audit(c, "empower.push", { body: b, answer: out });
    return c.json(out);
  });

  /* Push all: SWEEP_MAX a call; everything not tried comes back in `left` for the next call. */
  r.post("/empower/push-many", async (c) => {
    const deps = c.get("deps");
    const b = await body(c, PushManyBody);
    const now = b.ids.slice(0, SWEEP_MAX);
    const later = b.ids.slice(SWEEP_MAX);
    const out = await pushMany(deps, { ids: now, deadline: deps.now() + 9000 }, actor(c));
    const left = [...((out as { left?: string[] }).left || []), ...later];
    await audit(c, "empower.push_many", { target: now.join(","), summary: { asked: b.ids.length, pushed: (out as { pushed?: number }).pushed ?? 0, left: left.length } });
    return c.json({ ...out, left });
  });

  r.get("/empower/auto", async (c) => c.json(await autoSwitch(c.get("deps"), {}, actor(c))));
  r.put("/empower/auto", async (c) => {
    const b = await body(c, AutoBody);
    const out = await autoSwitch(c.get("deps"), b, actor(c));
    await audit(c, "empower.auto", { body: b, target: null });
    return c.json(out);
  });

  r.post("/empower/sync", async (c) => {
    const deps = c.get("deps");
    const out = await syncNow(deps, { deadline: deps.now() + 7000 });
    await audit(c, "empower.sync", { target: null, summary: {} });
    return c.json(out);
  });

  r.post("/empower/take-off", async (c) => {
    const b = await body(c, TakeOffBody);
    const out = await takeOff(c.get("deps"), b, actor(c));
    await audit(c, "empower.take_off", { body: b, answer: out });
    return c.json(out);
  });

  r.get("/empower/skus", async (c) => c.json({ ok: true, skus: await readSkus(c.get("deps")) }));
  r.put("/empower/skus", async (c) => {
    const b = await body(c, SkusBody);
    const out = await saveSkus(c.get("deps"), b.skus);
    await audit(c, "empower.skus", { target: null, summary: { codes: Object.keys(out.skus).length } });
    return c.json(out);
  });

  r.get("/empower/catalog", async (c) => c.json(await catalogSkus(c.get("deps"))));

  /* MATCH FROM OMNIFUL: every box of ours against their catalogue (nothing saved). */
  r.post("/empower/skus/match", async (c) => {
    const deps = c.get("deps");
    const b = await body(c, SkuMatchBody);
    const current = b.skus || (await readSkus(deps));
    const [{ skus: catalog }, cfg] = await Promise.all([catalogSkus(deps), loadCatalogue(deps, { fresh: true })]);
    const codes = [...Object.keys(skuByItem(cfg, current)), "bundle"];
    for (const x of cfg.extras || []) if (x && x.id && codes.indexOf(x.id) < 0) codes.push(x.id);
    return c.json({ ok: true, matches: matchSkus(catalog, codes, current), known: catalog.length });
  });

  r.put("/empower/routes/:code", async (c) => {
    const code = String(c.req.param("code") || "");
    const b = await body(c, RouteBody);
    const out = await setRoute(c.get("deps"), code, b.courier, actor(c));
    await audit(c, "empower.route", { target: out.code, body: b });
    return c.json(out);
  });

  /* the Stock Tracker; fresh=1 is "read the shelf now" */
  r.get("/stock", async (c) => c.json(await stockStatus(c.get("deps"), { fresh: query(c, StockQuery).fresh === true })));
}
