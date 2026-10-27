/** Rows for the orders suites: an order as the till would have written it, with overrides. */
import { orders, shipments, type NewOrderRow, type OrderRow } from "../../../src/server/db/schema";
import type { Harness } from "../../helpers/harness";

export const KEY = "abcdef0123456789abcdef0123456789";

export function orderRow(h: Harness, o: Partial<NewOrderRow> = {}): NewOrderRow {
  return {
    id: "LM-100001",
    createdAt: new Date(h.clock.t),
    updatedAt: new Date(h.clock.t),
    name: "Ahmed Al Balushi",
    phone: "+971 50 123 4567",
    phoneKey: "971501234567",
    email: null,
    country: "الإمارات",
    countryCode: "AE",
    city: "Dubai",
    region: "Al Barsha, Street 12",
    note: "",
    cur: "AED",
    sub: 250,
    ship: 0,
    codFee: 10,
    total: 260,
    omrRate: 0.1047,
    omr: 27.222,
    pay: "cod",
    paymentStatus: "cod",
    status: "new",
    trashed: false,
    refunded: false,
    invoiceKey: KEY,
    items: [{ itemId: "oud-large", scent: "عود الافندر", size: "كبير 300 جم", qty: 1, price: 250, was: 320 }],
    ...o,
  };
}

export async function seedOrders(h: Harness, rows: Array<Partial<NewOrderRow>>): Promise<OrderRow[]> {
  return h.db.insert(orders).values(rows.map((r) => orderRow(h, r))).returning();
}

export async function seedShipment(h: Harness, s: Partial<typeof shipments.$inferInsert> & { orderId: string }) {
  return h.db
    .insert(shipments)
    .values({ id: "omf-" + (s.sentId || s.orderId), sentId: s.sentId || s.orderId, createdAt: new Date(h.clock.t), updatedAt: new Date(h.clock.t), ...s })
    .returning();
}
