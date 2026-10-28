/**
 * (review-fixes, finding 3, after the reviewer's settle.race.test.ts) The payment writers
 * racing each other. On PGlite (one connection) these serialise; on the `pg` project
 * (`npm run test:pg`, real PostgreSQL) the requests really run at the same time — that is
 * where the cash switch used to record a card payment as cash with a fee never charged.
 */
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { orderEvents, orders } from "../../../src/server/db/schema";
import { completedEvent, paymentEvent } from "../../../src/server/services/thawani/fake";
import { payHarness, type PayHarness } from "../payments/_helpers";

let h: PayHarness;
beforeAll(async () => { h = await payHarness(); });
afterEach(async () => { await h.reset(); });

const state = (o: { pay: string; paymentStatus: string; status: string; codFee: number | null }) => o.pay + "/" + o.paymentStatus + "/" + o.status + "/fee" + Number(o.codFee || 0);

describe("races between the payment writers", () => {
  it("verify + webhook at the same instant: one settle, one Purchase per order", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 6; i++) {
      const r = await h.openCard();
      expect(r.status).toBe(200);
      ids.push(r.j.id);
      h.th().payByReference(r.j.id);
      const sess = h.th().state.sessions.find((s: any) => s.client_reference_id === r.j.id)!;
      const evt = completedEvent(sess);
      await Promise.all([h.verify({ ref: r.j.id }), h.deliver(evt), h.verify({ ref: r.j.id }), h.deliver(evt)]);
    }
    const pays = await h.db.select().from(orderEvents).where(eq(orderEvents.kind, "payment"));
    for (const id of ids) expect((await h.row(id)).paymentStatus).toBe("paid");
    expect(pays.length).toBe(ids.length);
    expect(h.purchases()).toBe(ids.length);
  });

  it("the cash switch from the reminder link racing the webhook for the old card page: always the card payment, at the charged figure, no cash fee", async () => {
    const out: string[] = [];
    for (let i = 0; i < 6; i++) {
      const r = await h.openCard();
      const id = r.j.id as string;
      const before = await h.row(id);
      h.th().payByReference(id);
      const sess = h.th().state.sessions.find((s: any) => s.client_reference_id === id)!;
      await Promise.all([
        h.request("/resume/" + id + "?k=" + before.invoiceKey + "&cod=1", { method: "POST" }),
        h.deliver(completedEvent(sess)),
      ]);
      const o = await h.row(id);
      out.push(state(o));
      // the books carry what the gateway took
      expect(Math.round(Number(o.omr) * 1000)).toBe(Number(before.amountBaisa));
    }
    expect(out).toEqual(Array(6).fill("card/paid/new/fee0"));
  });

  it("the shopper's return racing the cash switch: the money is recorded, never answered paid while the order says cash", async () => {
    for (let i = 0; i < 6; i++) {
      const r = await h.openCard();
      const id = r.j.id as string;
      const key = (await h.row(id)).invoiceKey;
      h.th().payByReference(id);
      const [v] = await Promise.all([
        h.verify({ ref: id, sid: r.j.session_id }),
        h.request("/resume/" + id + "?k=" + key + "&cod=1", { method: "POST" }),
      ]);
      const o = await h.row(id);
      expect(state(o)).toBe("card/paid/new/fee0");
      expect(v.j.paid).toBe(true);
    }
  });

  it("the same cash submission five times at once: one order, one Purchase", async () => {
    const order = h.basket({ dedupeId: "same-tap", id: "LM-1234567890" });
    const res = await Promise.all([0, 1, 2, 3, 4].map((i) => h.post("/api/order", { order }, { "x-nf-client-connection-ip": "10.9.9." + i })));
    expect(res.map((r) => r.status)).toEqual([200, 200, 200, 200, 200]);
    expect((await h.db.select().from(orders)).length).toBe(1);
    expect(h.purchases()).toBe(1);
  });

  it("the same card submission five times at once: one order, one session", async () => {
    const order = h.basket({ dedupeId: "same-card", id: "LM-1234567891" });
    await Promise.all([0, 1, 2, 3, 4].map((i) => h.post("/api/pay/session", { order }, { "x-nf-client-connection-ip": "10.8.9." + i })));
    expect((await h.db.select().from(orders)).length).toBe(1);
    expect(h.th().state.sessions.length).toBe(1);
  });

  it("three cash-switch posts at once: one switch, one Purchase", async () => {
    const r = await h.openCard();
    const id = r.j.id as string;
    const key = (await h.row(id)).invoiceKey;
    const before = h.purchases();
    await Promise.all([0, 1, 2].map(() => h.request("/resume/" + id + "?k=" + key + "&cod=1", { method: "POST" })));
    expect(h.purchases() - before).toBe(1);
    const switched = (await h.db.select().from(orderEvents).where(eq(orderEvents.orderId, id))).filter((e) => e.kind === "payment");
    expect(switched.length).toBe(1);
  });

  it("a late payment.succeeded never clears a refund committed meanwhile", async () => {
    for (let i = 0; i < 6; i++) {
      const id = "LM-80000" + (10 + i);
      await h.seed({ id, invoiceNo: "inv_r" + i, paymentStatus: "paid", status: "new", refunded: false, paymentId: "pay_r" + i });
      await Promise.all([
        h.deliver(paymentEvent({ payment_id: "pay_r" + i, checkout_invoice: "inv_r" + i, status: "successful", amount: 26175, fee: 650, refunded: false })),
        h.db.update(orders).set({ refunded: true, paymentStatus: "refunded", status: "void" }).where(eq(orders.id, id)),
      ]);
      const o = await h.row(id);
      expect([o.refunded, o.paymentStatus]).toEqual([true, "refunded"]);
    }
  });
});
