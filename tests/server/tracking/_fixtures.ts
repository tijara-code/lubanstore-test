/** Fixtures for the tracking suites: orders and events written straight into the database. */
import { eq } from "drizzle-orm";
import { events, orders, type NewOrderRow, type OrderRow } from "../../../src/server/db/schema";
import type { Harness } from "../../helpers/harness";

export async function addOrder(h: Harness, o: Partial<NewOrderRow> & { id: string }): Promise<OrderRow> {
  const row: NewOrderRow = {
    createdAt: new Date(h.clock.t),
    status: "new",
    paymentStatus: "cod",
    pay: "cod",
    countryCode: "OM",
    items: [{ itemId: "oud-large", scent: "عود", size: "كبير", price: 20, qty: 1 }],
    cur: "OMR",
    sub: 20,
    total: 20,
    omrRate: 1,
    omr: 20,
    invoiceKey: "k".repeat(32),
    ...o,
  };
  await h.db.insert(orders).values(row);
  return (await h.db.select().from(orders).where(eq(orders.id, o.id)))[0]!;
}

export interface Ev {
  name: string;
  sid?: string | null;
  item?: string | null;
  country?: string | null;
  city?: string | null;
  lat?: number | null;
  lng?: number | null;
  at: number;
}

export async function addEvents(h: Harness, list: Ev[]): Promise<void> {
  if (!list.length) return;
  for (let i = 0; i < list.length; i += 500) {
    await h.db.insert(events).values(list.slice(i, i + 500).map((e) => ({
      name: e.name, sid: e.sid ?? null, item: e.item ?? null, country: e.country ?? null,
      city: e.city ?? null, lat: e.lat ?? null, lng: e.lng ?? null, at: new Date(e.at),
    })));
  }
}

export const GULF = 4 * 3600e3;
export const DAY = 86400e3;
export const gulfDay = (t: number) => new Date(t + GULF).toISOString().slice(0, 10);
export const muscatMidnight = (t: number) => Math.floor((t + GULF) / DAY) * DAY - GULF;
