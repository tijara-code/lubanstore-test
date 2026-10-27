/**
 * `npm run seed` — an invented shop in the local PGlite database (DATA_DIR, default
 * .data/pglite), for local development and the admin's screenshots:
 *
 *   ~120 orders over 60 days across the six markets — cash and card, every status, some
 *   flagged and some binned, Empower parcels (Aramex waybills) for the Empower markets and a
 *   typed tracking number for the market shipped by hand (Kuwait), refunds, an abandoned card
 *   attempt or two; repeat customers with CRM notes; the order history (order_events);
 *   analytics events (sessions, the funnel, sources, countries with city and a rounded
 *   point, a few visitors live now); server and browser errors; a catalogue publish history
 *   and an audit trail.
 *
 * Every name and phone number is invented. Deterministic (a seeded random), so screenshots
 * are stable. Refuses DATABASE_URL (never a real database); refuses a database that already
 * has orders unless `--reset` (which empties every table first).
 *
 *   npm run seed            npm run seed -- --reset            npm run seed -- --now=2026-10-27T09:00:00Z
 */
import { sql } from "drizzle-orm";
import { connectPglite, type Db } from "../src/server/db/client";
import {
  adminAudit, catalogueChanges, crm, events, logs, orderEvents, orders, settings, shipments, type NewOrderRow,
} from "../src/server/db/schema";
import { bundledCatalogue } from "../src/server/domain/catalogue";
import { phoneKey } from "../src/shared/orders/phone";
import { priceOrder, type Quote } from "../src/shared/pricing/price";
import { stripCodeOwned } from "../src/shared/catalogue/merge";
import type { Catalogue } from "../src/shared/catalogue/types";
import type { Attribution, OrderLine } from "../src/shared/orders/types";

/* ---------------- a seeded random ---------------- */

let state = 0x4c4d5345; // "LMSE"
function rand(): number {
  state = (state + 0x6d2b79f5) | 0;
  let t = Math.imul(state ^ (state >>> 15), 1 | state);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const pick = <T>(list: readonly T[]): T => list[Math.floor(rand() * list.length)]!;
const chance = (p: number) => rand() < p;
const int = (a: number, b: number) => a + Math.floor(rand() * (b - a + 1));
const digits = (n: number) => Array.from({ length: n }, () => int(0, 9)).join("");

/* ---------------- the invented world ---------------- */

interface Market {
  code: string;
  weight: number;
  mobile: () => string;
  cities: Array<[string, string, number, number]>;
}

const MARKETS: Market[] = [
  { code: "OM", weight: 30, mobile: () => "9" + digits(7), cities: [["مسقط", "Muscat", 23.6, 58.4], ["صلالة", "Salalah", 17.0, 54.1], ["صحار", "Sohar", 24.3, 56.7]] },
  { code: "AE", weight: 25, mobile: () => "5" + pick(["0", "2", "5", "6"]) + digits(7), cities: [["دبي", "Dubai", 25.2, 55.3], ["أبوظبي", "Abu Dhabi", 24.5, 54.4], ["الشارقة", "Sharjah", 25.3, 55.4]] },
  { code: "SA", weight: 20, mobile: () => "5" + digits(8), cities: [["الرياض", "Riyadh", 24.7, 46.7], ["جدة", "Jeddah", 21.5, 39.2], ["الدمام", "Dammam", 26.4, 50.1]] },
  { code: "QA", weight: 10, mobile: () => pick(["3", "5", "6", "7"]) + digits(7), cities: [["الدوحة", "Doha", 25.3, 51.5], ["الوكرة", "Al Wakrah", 25.2, 51.6]] },
  { code: "KW", weight: 8, mobile: () => pick(["5", "6", "9"]) + digits(7), cities: [["مدينة الكويت", "Kuwait City", 29.4, 48.0], ["حولي", "Hawalli", 29.3, 48.0]] },
  { code: "BH", weight: 7, mobile: () => "3" + digits(7), cities: [["المنامة", "Manama", 26.2, 50.6], ["المحرق", "Muharraq", 26.3, 50.6]] },
];

const FIRST = ["سالم", "مريم", "خالد", "فاطمة", "عبدالله", "نورة", "يوسف", "هند", "أحمد", "ريم", "حمد", "لطيفة", "سعيد", "عائشة", "ماجد", "شيخة", "Omar", "Layla", "Hassan", "Sara"];
const LAST = ["البلوشي", "الحارثي", "الكعبي", "المري", "العتيبي", "الشمري", "الهاشمي", "السعدي", "الزدجالي", "الرميثي", "Al Amri", "Al Farsi", "Haddad", "Nasser"];
const AREAS = ["الحي الشمالي، شارع 12", "قرب المسجد الكبير", "مجمع الواحة، فيلا 7", "الشارع التجاري، بناية 3", "Block 4, Street 21", "Al Noor tower, flat 1203"];
const SOURCES: Array<{ attribution: Attribution; origin: string; weight: number }> = [
  { attribution: { source: "instagram", medium: "paid_social", campaign: "launch_test", how: "utm" }, origin: "instagram", weight: 30 },
  { attribution: { source: "snapchat", medium: "paid_social", campaign: "gulf_autumn", how: "utm" }, origin: "snapchat", weight: 18 },
  { attribution: { source: "facebook", medium: "paid_social", campaign: "launch_test", how: "click_id" }, origin: "facebook", weight: 10 },
  { attribution: { source: "google", medium: "cpc", campaign: "brand", how: "utm" }, origin: "google", weight: 8 },
  { attribution: { source: "instagram", medium: "social", how: "referrer" }, origin: "instagram", weight: 10 },
  { attribution: { source: "whatsapp", medium: "chat", how: "referrer" }, origin: "whatsapp", weight: 6 },
  { attribution: { source: "(direct)", medium: "(none)", how: "direct" }, origin: "direct", weight: 18 },
];

function weighted<T extends { weight: number }>(list: readonly T[]): T {
  const total = list.reduce((s, x) => s + x.weight, 0);
  let r = rand() * total;
  for (const x of list) if ((r -= x.weight) < 0) return x;
  return list[list.length - 1]!;
}

const BASKETS: Array<Array<{ itemId: string; qty: number }>> = [
  [{ itemId: "bundle", qty: 1 }],
  [{ itemId: "bundle", qty: 1 }, { itemId: "burner", qty: 1 }],
  [{ itemId: "oud-large", qty: 1 }],
  [{ itemId: "amber-large", qty: 2 }],
  [{ itemId: "lemon-large", qty: 1 }, { itemId: "samples", qty: 1 }],
  [{ itemId: "oud-large", qty: 1 }, { itemId: "amber-large", qty: 1 }],
  [{ itemId: "bundle", qty: 2 }],
  [{ itemId: "duo:oud.amber", qty: 1 }],
  [{ itemId: "trio:oud.lemon.amber", qty: 1 }],
];

/* ---------------- the run ---------------- */

function args() {
  const a = process.argv.slice(2);
  const nowArg = a.find((x) => x.startsWith("--now="));
  const now = nowArg ? Date.parse(nowArg.slice(6)) : Date.now();
  if (!Number.isFinite(now)) throw new Error("--now= is not a date");
  return { reset: a.includes("--reset"), now };
}

async function wipe(db: Db): Promise<void> {
  const res = await db.execute(sql`select tablename from pg_tables where schemaname = 'store'`);
  const names = (res as unknown as { rows: Array<{ tablename: string }> }).rows.map((r) => `"store"."${r.tablename}"`);
  if (names.length) await db.execute(sql.raw(`truncate ${names.join(", ")} restart identity cascade`));
}

function quote(cfg: Catalogue, code: string, pay: "cod" | "card", now: number): Quote {
  for (let i = 0; i < 20; i++) {
    try {
      return priceOrder(cfg, { countryCode: code, items: pick(BASKETS), pay, manual: true }, now);
    } catch {
      /* not sold there: another basket */
    }
  }
  return priceOrder(cfg, { countryCode: code, items: [{ itemId: "oud-large", qty: 1 }], pay, manual: true }, now);
}

async function main(): Promise<void> {
  if (process.env.DATABASE_URL) throw new Error("DATABASE_URL is set: the seed only fills the local PGlite database.");
  const { reset, now } = args();
  const dir = process.env.DATA_DIR || ".data/pglite";
  const db = await connectPglite(dir);
  const [{ n }] = (await db.execute(sql`select count(*)::int as n from ${orders}`) as unknown as { rows: Array<{ n: number }> }).rows;
  if (n > 0 && !reset) {
    console.error(`seed: ${dir} already has ${n} orders — run with --reset to empty it first.`);
    process.exit(1);
  }
  if (reset) await wipe(db);

  /* the catalogue: published four times, Kuwait shipped by hand */
  const cfg = bundledCatalogue();
  for (const c of cfg.countries) c.courier = c.code === "KW" ? "manual" : "omniful";
  const day = 86400e3;
  await db.insert(settings).values({ id: 1, data: stripCodeOwned(cfg), version: 4, updatedAt: new Date(now - 6 * day), updatedBy: "shopkeeper" });
  await db.insert(catalogueChanges).values([
    { at: new Date(now - 58 * day), actor: "shopkeeper", what: "catalogue published for the first time", detail: { lines: ["catalogue published for the first time"] } },
    { at: new Date(now - 41 * day), actor: "shopkeeper", what: "all markets: bundle window 72h; OM small 14→12 OMR", detail: { lines: ["all markets: bundle window 72h", "OM small 14→12 OMR"] } },
    { at: new Date(now - 20 * day), actor: "shopkeeper", what: "lemon small sold out; AE free-delivery offer on over 200 for 5 days", detail: { lines: ["lemon small sold out", "AE free-delivery offer on over 200 for 5 days"] } },
    { at: new Date(now - 6 * day), actor: "shopkeeper", what: "lemon small back in stock; burner on", detail: { lines: ["lemon small back in stock", "burner on"] } },
  ]);

  /* the customers: ~85 people, some coming back */
  const people = Array.from({ length: 85 }, () => {
    const m = weighted(MARKETS.map((x) => ({ ...x })));
    const city = pick(m.cities);
    const local = m.mobile();
    const country = cfg.countries.find((c) => c.code === m.code)!;
    const phone = "+" + country.dial + " " + local;
    return { m, city, name: pick(FIRST) + " " + pick(LAST), phone, key: phoneKey(phone, m.code) || null, country };
  });

  const rows: NewOrderRow[] = [];
  const evRows: Array<typeof orderEvents.$inferInsert> = [];
  const shipRows: Array<typeof shipments.$inferInsert> = [];
  let seq = 0;
  for (let i = 0; i < 122; i++) {
    const who = i < 85 ? people[i]! : pick(people.slice(0, 30)); // the first 30 are the regulars
    const ageDays = Math.pow(rand(), 1.3) * 60;
    const at = now - ageDays * day - int(0, 3600e3);
    const pay = chance(0.45) ? "card" : "cod";
    const q = quote(cfg, who.m.code, pay, at);
    const src = weighted(SOURCES);
    const id = "LM-" + String(Math.floor(at)).slice(-7) + String(100 + (seq++ % 900));
    // every status, older orders further along
    let status: NewOrderRow["status"];
    if (ageDays > 12) status = chance(0.78) ? "done" : chance(0.5) ? "void" : "ship";
    else if (ageDays > 4) status = pick(["prep", "ship", "ship", "done", "done", "void"] as const);
    else status = pick(["new", "new", "prep", "ship", "pending"] as const);
    if (pay === "cod" && status === "pending") status = "new";
    let paymentStatus: NewOrderRow["paymentStatus"] = pay === "cod" ? (status === "done" ? "paid" : "cod") : "paid";
    if (pay === "card" && status === "pending") paymentStatus = "unpaid";
    if (pay === "card" && status === "void" && chance(0.6)) paymentStatus = "cancelled";
    const refunded = pay === "card" && paymentStatus === "paid" && status === "void";
    if (refunded) paymentStatus = "refunded";
    const created = new Date(at);
    const isCard = pay === "card";
    const paid = isCard && (paymentStatus === "paid" || paymentStatus === "refunded");
    const amountBaisa = isCard ? Math.round(q.omr * 1000) : null;
    const fee = paid ? Math.round(q.omr * 0.0265 * 1000) / 1000 + 0.1 : null;
    const manual = who.m.code === "KW";
    const shippedAt = status === "ship" || status === "done" ? new Date(at + int(1, 3) * day) : null;
    const deliveredAt = status === "done" ? new Date(at + int(3, 6) * day) : null;
    rows.push({
      id,
      createdAt: created,
      updatedAt: new Date(Math.min(now, at + 5 * day)),
      status,
      paymentStatus,
      pay,
      lang: chance(0.8) ? "ar" : "en",
      origin: src.origin,
      name: who.name,
      phone: who.phone,
      phoneKey: who.key,
      email: chance(0.3) ? "customer" + i + "@example.com" : null,
      country: who.country.name,
      countryCode: who.m.code,
      city: who.city[0],
      region: pick(AREAS),
      note: chance(0.15) ? pick(["الرجاء الاتصال قبل التوصيل", "التوصيل بعد العصر", "هدية — بدون فاتورة داخل الصندوق"]) : "",
      items: q.items as OrderLine[],
      cur: q.cur,
      sub: q.sub,
      ship: q.ship,
      codFee: q.codFee,
      total: q.total,
      omrRate: q.omrRate,
      omr: isCard ? amountBaisa! / 1000 : q.omr,
      amountBaisa,
      invoiceKey: digits(32).replace(/\d/g, (d) => "0123456789abcdef"[(Number(d) * 7) % 16]!),
      attribution: src.attribution,
      client: { ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)" },
      invoiceNo: isCard ? "2026" + digits(10) : null,
      sessionId: isCard ? "checkout_" + digits(12) : null,
      expireAt: isCard ? new Date(at + 3600e3) : null,
      paidAt: paid ? new Date(at + 120e3) : status === "done" && !isCard ? deliveredAt : null,
      paymentId: paid ? "pay_" + digits(14) : null,
      maskedCard: paid ? "4" + digits(5) + "******" + digits(4) : null,
      cardType: paid ? pick(["Visa", "Mastercard"]) : null,
      refunded,
      gatewayFee: fee,
      netAmount: fee != null ? Math.round((amountBaisa! / 1000 - fee) * 1000) / 1000 : null,
      gateway: paid ? { mode: "uat", payment: { status: "successful", amount: amountBaisa } } : null,
      tracking: manual && shippedAt ? "KW" + digits(9) : null,
      carrier: manual && shippedAt ? pick(["DHL", "Aramex Kuwait"]) : null,
      shippedAt,
      deliveredAt,
      adminNote: chance(0.08) ? "اتصلت بالعميل — يريد التوصيل يوم الخميس" : null,
      flagged: chance(0.07),
      flaggedAt: null,
      trashed: chance(0.04),
      trashedAt: null,
    });
    const r = rows[rows.length - 1]!;
    if (r.flagged) r.flaggedAt = new Date(at + day);
    if (r.trashed) r.trashedAt = new Date(at + 2 * day);
    evRows.push({ orderId: id, at: created, kind: "created", from: null, to: status === "pending" ? "pending" : "new", by: "shopper", detail: { origin: src.origin } });
    if (paid) evRows.push({ orderId: id, at: new Date(at + 120e3), kind: "payment", from: "unpaid", to: "paid", by: "webhook", detail: null });
    const path: string[] = { pending: [], new: [], prep: ["prep"], ship: ["prep", "ship"], done: ["prep", "ship", "done"], void: ["void"] }[status!] || [];
    let prev = "new";
    path.forEach((to, k) => {
      evRows.push({ orderId: id, at: new Date(at + (k + 1) * 0.9 * day), kind: "status", from: prev, to, by: manual ? "admin" : to === "prep" ? "push" : "job:empower-poll", detail: null });
      prev = to;
    });
    if (refunded) evRows.push({ orderId: id, at: new Date(at + 2 * day), kind: "refund", from: "paid", to: "refunded", by: "admin", detail: { actor: "shopkeeper" } });
    // Empower parcels for the Empower markets
    if (!manual && (status === "prep" || status === "ship" || status === "done")) {
      const awb = who.m.code === "OM" ? null : "44" + digits(9);
      shipRows.push({
        id: "omf-" + id,
        orderId: id,
        carrier: "empower",
        sentId: id,
        reference: "OMF" + digits(8),
        awb: status === "prep" ? null : awb,
        courierName: who.m.code === "OM" ? "Empower Oman" : "Aramex",
        status: status === "prep" ? "created" : status === "ship" ? "picked_up" : "delivered",
        cod: pay === "cod" ? q.total : 0,
        createdAt: new Date(at + 0.9 * day),
        updatedAt: new Date(Math.min(now, at + 4 * day)),
        pickedUpAt: shippedAt,
        deliveredAt,
        syncedAt: new Date(now - 1800e3),
      });
    }
  }
  await db.insert(orders).values(rows);
  for (let k = 0; k < evRows.length; k += 500) await db.insert(orderEvents).values(evRows.slice(k, k + 500));
  if (shipRows.length) await db.insert(shipments).values(shipRows);

  /* CRM notes on a few regulars */
  const regulars = people.slice(0, 30).filter((p) => p.key);
  await db.insert(crm).values(
    regulars.slice(0, 8).map((p, k) => ({
      phoneKey: p.key!,
      note: pick(["يفضّل العنبر", "يطلب دائماً للهدايا", "اتصل مساءً فقط", "عميل جملة محتمل"]),
      tags: k % 3 === 0 ? ["vip"] : k % 3 === 1 ? ["gift"] : ["wholesale", "vip"],
      updatedAt: new Date(now - k * day),
    })),
  ).onConflictDoNothing();

  /* analytics: sessions with a funnel, a few live now */
  const evs: Array<typeof events.$inferInsert> = [];
  for (let d = 0; d < 60; d++) {
    const sessions = int(25, 70);
    for (let s = 0; s < sessions; s++) {
      const m = weighted(MARKETS.map((x) => ({ ...x })));
      const city = pick(m.cities);
      const src = weighted(SOURCES).attribution;
      const sid = "s" + d + "x" + s + digits(6);
      let t = now - d * day - int(0, day - 3600e3);
      const geo = { country: m.code, city: city[1] as string, lat: city[2] as number, lng: city[3] as number };
      const push = (name: string, item: string | null = null) => {
        evs.push({ at: new Date(t), name, item, sid, ...geo });
        t += int(5, 90) * 1000;
      };
      push("session_start", [src.source, src.medium, src.campaign || ""].join("|"));
      push("page_view", "home");
      if (chance(0.55)) push("size_open", pick(["large", "small"]));
      if (chance(0.3)) push(pick(["add_cart", "offer_add", "add_cart"]), pick(["oud-large", "bundle", "amber-large"]));
      else continue;
      if (chance(0.15)) push("extra_add", "burner");
      if (chance(0.7)) push("cart_open");
      if (chance(0.6)) push("checkout_view", "checkout");
      else continue;
      if (chance(0.5)) push("pay_method", pick(["cod", "card"]));
      if (chance(0.45)) push("order_placed");
    }
  }
  for (let v = 0; v < 9; v++) {
    const m = pick(MARKETS);
    const city = pick(m.cities);
    const t = now - int(1, 50) * 60e3;
    const sid = "live" + v + digits(6);
    const geo = { country: m.code, city: city[1] as string, lat: city[2] as number, lng: city[3] as number };
    evs.push({ at: new Date(t), name: "page_view", item: "home", sid, ...geo });
    if (v % 2) evs.push({ at: new Date(t + 30e3), name: "add_cart", item: "bundle", sid, ...geo });
    if (v % 3 === 0) evs.push({ at: new Date(t + 60e3), name: "checkout_view", item: "checkout", sid, ...geo });
  }
  for (let k = 0; k < evs.length; k += 1000) await db.insert(events).values(evs.slice(k, k + 1000));

  /* errors */
  await db.insert(logs).values([
    { at: new Date(now - 2 * day), level: "error", side: "server", source: "http", message: "Omniful answered 503 while pushing", path: "/api/admin/empower/push" },
    { at: new Date(now - 3600e3), level: "error", side: "browser", source: "error", message: "TypeError: Cannot read properties of null (reading 'value')", path: "checkout", detail: { stack: "at /assets/checkout-x.js:1:900", ua: "Mozilla/5.0 (iPhone) Instagram 310.0", sid: "live1" } },
    { at: new Date(now - 5 * 3600e3), level: "error", side: "browser", source: "rejection", message: "Failed to fetch", path: "home", detail: { ua: "Mozilla/5.0 (Linux; Android 14) Chrome/130", sid: "s0x1" } },
    { at: new Date(now - 9 * day), level: "warn", side: "job", source: "job:empower-poll", message: "Omniful status read timed out" },
  ]);

  /* the trail */
  await db.insert(adminAudit).values([
    { at: new Date(now - 6 * day), actor: "shopkeeper", action: "catalogue.publish", target: "v4", summary: { from: 3, version: 4 } },
    { at: new Date(now - 2 * day), actor: "shopkeeper", action: "orders.bulk.status", target: rows[0]!.id, summary: { op: "status", to: "prep", "→updated": 1 } },
    { at: new Date(now - 3600e3), actor: "shopkeeper", action: "session.login", target: null, summary: null },
  ]);

  console.log(`seed: ${rows.length} orders, ${shipRows.length} parcels, ${evs.length} events, ${regulars.slice(0, 8).length} CRM notes → ${dir}`);
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error("seed: " + ((e as Error)?.stack || e));
    process.exit(1);
  },
);
