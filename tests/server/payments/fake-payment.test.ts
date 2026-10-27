/**
 * from scripts/fake-payment.js (and docs/PAYMENT-WALKTHROUGH.md): one complete card payment
 * against the emulator — create, return, refresh — and the walkthrough's 16 invariants.
 */
import { describe, expect, it } from "vitest";
import { payHarness } from "./_helpers";

describe("a complete card payment, end to end", () => {
  it("holds the 16 invariants", async () => {
    const h = await payHarness();
    const ORDER = {
      id: "LM-482913", name: "يحيى الحارثي", phone: "+968 76655565", country: "عمان", countryCode: "OM", city: "مسقط", region: "الخوير",
      note: "تغليف هدية", pay: "card",
      items: [{ scent: "عود الافندر", size: "كبير", price: 12, qty: 2, itemId: "oud-large" }, { scent: "x", size: "y", price: 29, qty: 1, itemId: "bundle" }],
      cur: "ر.ع", ship: 0, codFee: 0, total: 79, omr: 79, omrRate: 1, dedupeId: "9f2c7a10-4d3e-4c8b-9a11-5e7b3c2f1d40",
    };
    const step1 = await h.post("/api/pay/session", { order: ORDER });
    const j1 = (await step1.json()) as Record<string, any>;
    const afterCreate = await h.row(j1.id);
    const sent = h.world.calls.find((c) => /\/checkout\/session$/.test(c.path))!.body as { products: Array<{ name: string; quantity: number; unit_amount: number }> };

    h.th().payByReference(j1.id);
    const step2 = await h.get("/api/pay/verify?ref=" + j1.id);
    const afterVerify = await h.row(j1.id);
    const step3 = await h.get("/api/pay/verify?ref=" + j1.id);
    const j3 = (await step3.json()) as Record<string, any>;

    const lineSum = sent.products.reduce((t, p) => t + p.unit_amount * p.quantity, 0);
    // the walkthrough's basket in today's catalogue (the small box is sold only inside the set):
    // 2 × 25 + 29 = 79 OMR, delivery free over 30
    expect(j1.amount_baisa).toBe(79000);
    expect(step1.status).toBe(200); //                                  create returned 200
    expect(step2.status).toBe(200); //                                  verify returned 200
    expect(j3.already).toBe(true); //                                   replay is idempotent
    expect(sent.products.every((p) => Number.isInteger(p.unit_amount))).toBe(true); // all unit_amount integers
    expect(sent.products.every((p) => p.name.length <= 40)).toBe(true); // all names within 40 chars
    expect(lineSum).toBe(afterCreate.amountBaisa); //                    line items sum to the total
    expect(afterCreate.amountBaisa).toBe(Math.round(afterCreate.omr * 1000)); // baisa = OMR x 1000
    expect(!!afterCreate.sessionId && afterCreate.status === "pending").toBe(true); // order existed before redirect
    expect(typeof afterVerify.invoiceNo).toBe("string"); //             invoice kept as text
    expect(afterVerify.paymentStatus === "paid" && afterVerify.status === "new").toBe(true); // marked paid on verify
    expect(Math.abs(afterVerify.omr - afterVerify.gatewayFee! - afterVerify.netAmount!)).toBeLessThan(0.0011); // net = gross - fee
    expect(!!afterVerify.gateway!.session).toBe(true); //               create payload preserved
    expect(!!afterVerify.gateway!.paid_session).toBe(true); //          verify payload stored
    expect(!!afterVerify.gateway!.payment).toBe(true); //               charge payload stored
    const stored = JSON.stringify(afterVerify);
    expect(/\b\d{15,19}\b/.test(stored)).toBe(false); //                 no PAN beyond the mask
    expect(stored.includes("fake-thawani-secret")).toBe(false); //       no secret key in the row
    // the walkthrough's lines: the size appended only when it is a real size label
    expect(sent.products[0]).toEqual({ name: "عود الافندر كبير 300 جم", quantity: 2, unit_amount: 25000 });
    expect(sent.products.length).toBe(2);
  });
});
