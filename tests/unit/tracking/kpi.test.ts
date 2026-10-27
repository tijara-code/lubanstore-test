import { describe, expect, it } from "vitest";
import * as KPI from "../../../src/shared/kpi";

// from test-v330.js: every figure defined once
const d = (day: string, h?: number) => day + "T" + String(h || 10).padStart(2, "0") + ":00:00+04:00";
const O = (id: string, extra: Record<string, unknown> = {}) => ({ id, created_at: d("2026-10-07"), phone: "+968 91234567", omr: 10, pay: "cod",
  payment_status: "cod", status: "new", trashed: false, refunded: false, gateway_fee: null, ...extra });
const FIX = [
  O("cod-new"),
  O("cod-collected", { payment_status: "paid", status: "done", phone: "+968 91234567" }),
  O("card-paid", { pay: "card", payment_status: "paid", gateway_fee: 0.25, phone: "+971 501234567", omr: 20 }),
  O("card-pending", { pay: "card", payment_status: "unpaid", status: "pending", phone: "+971 509999999" }),
  O("cancelled", { status: "void", phone: "+974 33333333" }),
  O("expired-card", { pay: "card", payment_status: "cancelled", status: "void", phone: "+974 44444444" }),
  O("refunded-flag", { pay: "card", payment_status: "paid", refunded: true, status: "ship", phone: "+965 55555555", omr: 30 }),
  O("refunded-status", { pay: "card", payment_status: "refunded", status: "void", phone: "+965 66666666", omr: 30 }),
  O("trashed", { trashed: true, phone: "+973 77777777" }),
  O("late-night", { created_at: "2026-10-07T22:30:00Z", phone: "+968 98888888", omr: 5 }),
];

describe("the definitions, on the fixture", () => {
  const all = KPI.compute(FIX, null);
  it("counts every figure as defined", () => {
    expect(all.orders).toBe(4);
    expect(all.gross).toBe(45);
    expect(all.settled).toBe(30);
    expect(all.expected).toBe(15);
    expect(all.net).toBe(29.75);
    expect(all.aov).toBe(11.25);
    expect(all.cancelled).toBe(3);
    expect(all.refunded).toBe(2);
    expect(all.refundRate).toBe(0.333);
    expect(all.delivered).toBe(1);
    expect(all.customers + " " + all.repeatRate).toBe("3 0.333");
    expect(all.total).toBe(9);
    // the Overview's "Cancelled or failed · N% of all orders"
    expect(all.cancelledPct).toBe(Math.round((3 / 9) * 100));
  });
  it("conversion and cpp need their halves", () => {
    expect(all.conversion + " " + KPI.compute(FIX, null, { sessions: 50 }).conversion).toBe("null 0.08");
    expect(all.cpp + " " + KPI.compute(FIX, null, { spend: 100 }).cpp).toBe("null 25");
  });
});

describe("the clock and the windows", () => {
  const now = Date.parse("2026-10-07T12:00:00Z");
  it("cuts days in Muscat", () => {
    expect(KPI.norm(FIX[9])!.day).toBe("2026-10-08");
    expect(KPI.compute(FIX, { from: "2026-10-07", to: "2026-10-07" }).orders).toBe(3);
    expect(KPI.compute(FIX, { from: "2026-10-08", to: "2026-10-08" }).orders).toBe(1);
    expect(KPI.byDay(FIX, { from: "2026-10-06", to: "2026-10-08" })).toEqual({ "2026-10-06": 0, "2026-10-07": 3, "2026-10-08": 1 });
  });
  it("windows: days, previous, month", () => {
    const w = KPI.window.days(7, now)!;
    expect(w.to).toBe(KPI.todayMuscat(now));
    expect(KPI.shiftDay(w.from, 6)).toBe(w.to);
    expect(KPI.window.previous({ from: "2026-10-05", to: "2026-10-07" })).toEqual({ from: "2026-10-02", to: "2026-10-04" });
    expect(KPI.window.month(now)).toEqual({ from: "2026-10-01", to: "2026-10-07" });
    expect(KPI.todayMuscat(Date.parse("2026-10-07T21:00:00Z"))).toBe("2026-10-08");
  });
  it("delta and delivery hours", () => {
    expect(KPI.delta(12, 10) + " " + KPI.delta(3, 0)).toBe("20 100");
    expect(KPI.deliveryHours([{ booked_at: d("2026-10-05"), delivered_at: d("2026-10-07") }, { booked_at: d("2026-10-06"), delivered_at: d("2026-10-07", 22) }, { booked_at: d("2026-10-06") }], null)).toBe(42);
    // the new shipments table's names
    expect(KPI.deliveryHours([{ createdAt: new Date(d("2026-10-05")), deliveredAt: new Date(d("2026-10-06")) }], null)).toBe(24);
  });
  it("the Overview's set", () => {
    const ov = KPI.overview(FIX, now);
    expect(ov.week.orders).toBe(3);
    expect(Object.keys(ov.byDay).length).toBe(30);
    expect(ov.delta).toBe(100);
  });
});

describe("one shape for every row kind", () => {
  it("a panel order, a database row (snake or camel case) and a ledger row read the same", () => {
    const panel = { id: "x", date: d("2026-10-07"), paymentStatus: "paid", status: "new", omr: 7, gatewayFee: 0.1, countryCode: "OM", trashed: false, refunded: false };
    const ledger = { id: "man:1", at: d("2026-10-07"), omr: 4, paid: false, cancelled: false };
    expect(KPI.isSettled(panel) + " " + KPI.norm(panel)!.fee).toBe("true 0.1");
    expect(KPI.isLive(ledger) + " " + KPI.isSettled(ledger) + " " + KPI.isLive({ ...ledger, cancelled: true })).toBe("true false false");
    expect(KPI.settledOf(panel) + " " + KPI.settledOf(FIX[0])).toBe("7 0");
    const row = { id: "LM-1", createdAt: new Date(d("2026-10-07")), paymentStatus: "paid", status: "done", omr: 9, gatewayFee: 0.2, phoneKey: "96891234567", trashed: false, refunded: false, pay: "card" };
    expect(KPI.norm(row)!.day).toBe("2026-10-07");
    expect(KPI.compute([row]).net).toBe(8.8);
  });
});
