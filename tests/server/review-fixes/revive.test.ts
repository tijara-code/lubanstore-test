/**
 * (review-fixes, finding 5, after the reviewer's revive.test.ts) The customer's reminder link
 * may bring back only an order the PAYMENT path voided — a card attempt lapsed by the expiry
 * job, or cancelled at the gateway — never one the shop cancelled in the panel. The key the
 * link needs is in every invoice link.
 */
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { setStatus } from "../../../src/server/domain/order-admin";
import { expireUnpaid } from "../../../src/server/domain/payments/expire";
import { KEY, payHarness, type PayHarness } from "../payments/_helpers";

let h: PayHarness;
beforeAll(async () => { h = await payHarness(); });
afterEach(async () => { await h.reset(); });

const ID = "LM-7000001";
const post = (q: string) => h.request("/resume/" + ID + "?k=" + KEY + q, { method: "POST" });
const stand = async () => {
  const o = await h.row(ID);
  return o.status + "/" + o.paymentStatus + "/" + o.pay;
};

describe("a cancelled order and the customer's link", () => {
  it("a cash order the SHOP cancelled stays cancelled (cash link and card link): no action, nothing written", async () => {
    await h.seed({ id: ID, pay: "cod", paymentStatus: "cod", status: "new", amountBaisa: null, codFee: 10, total: 260 });
    expect((await setStatus(h.deps, ID, "void", { actor: "shopkeeper" })).changed).toBe(true);
    for (const q of ["&cod=1", ""]) {
      const r = await post(q);
      expect(r.status).toBe(200);
      expect(await r.text()).toMatch(/لا حاجة لأي إجراء/);
      expect(await stand()).toBe("void/cod/cod");
    }
    expect(h.purchases()).toBe(0);
  });

  it("a card attempt the shop cancelled stays cancelled", async () => {
    await h.seed({ id: ID });
    expect((await setStatus(h.deps, ID, "void", { actor: "shopkeeper" })).changed).toBe(true);
    expect(await (await post("&cod=1")).text()).toMatch(/لا حاجة لأي إجراء/);
    expect(await (await post("")).text()).toMatch(/لا حاجة لأي إجراء/);
    expect(await stand()).toBe("void/unpaid/card");
    expect(h.th().state.sessions.length).toBe(0);
  });

  it("a card attempt switched to cash and then cancelled by the shop stays cancelled", async () => {
    await h.seed({ id: ID });
    expect((await post("&cod=1")).status).toBe(200);
    expect(await stand()).toBe("new/cod/cod");
    await setStatus(h.deps, ID, "void", { actor: "shopkeeper" });
    expect(await (await post("")).text()).toMatch(/لا حاجة لأي إجراء/);
    expect(await stand()).toBe("void/cod/cod");
  });

  it("a cash order cancelled with nothing on record (an imported row, no card attempt) is not revived", async () => {
    await h.seed({ id: ID, pay: "cod", paymentStatus: "cod", status: "void", amountBaisa: null, sessionId: null });
    expect(await (await post("&cod=1")).text()).toMatch(/لا حاجة لأي إجراء/);
    expect(await stand()).toBe("void/cod/cod");
  });

  // the original's win-back, kept
  it("a card attempt the expiry job lapsed comes back: as cash (new) or by card (pending)", async () => {
    await h.seed({ id: ID, createdAt: new Date(h.clock.t - 80 * 3600e3) });
    expect((await expireUnpaid(h.deps)).ids).toEqual([ID]);
    expect(await stand()).toBe("void/cancelled/card");
    const g = await h.get("/resume/" + ID + "?k=" + KEY);
    expect(g.status).toBe(200);
    expect((await post("")).status).toBe(302);
    expect(await stand()).toBe("pending/unpaid/card");
    // lapsed again, then confirmed as cash
    h.clock.advance(80 * 3600e3);
    expect((await expireUnpaid(h.deps)).ids).toEqual([ID]);
    expect((await post("&cod=1")).status).toBe(200);
    expect(await stand()).toBe("new/cod/cod");
  });

  it("a card attempt the shopper cancelled at the gateway comes back", async () => {
    const r = await h.openCard({ id: ID });
    expect(r.status).toBe(200);
    h.th().cancel(h.th().sessionFor(ID)!.session_id);
    expect((await h.verify({ ref: ID })).j.status).toBe("cancelled");
    const o = await h.row(ID);
    expect(o.status + "/" + o.paymentStatus).toBe("void/cancelled");
    const back = await h.request("/resume/" + ID + "?k=" + o.invoiceKey + "&cod=1", { method: "POST" });
    expect(back.status).toBe(200);
    expect(await stand()).toBe("new/cod/cod");
  });
});
