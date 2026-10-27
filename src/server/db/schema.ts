/**
 * The database, in one place. PostgreSQL (Supabase in production, PGlite in tests and
 * local development). Migrations are generated from this file by drizzle-kit into
 * db/migrations and applied by hand (`npm run db:migrate`) — never by a deploy.
 *
 * Money columns are numeric read as JS numbers (amounts are 3-decimal; baisa are integers).
 */
import { sql } from "drizzle-orm";
import {
  bigserial,
  boolean,
  check,
  doublePrecision,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import type { Catalogue } from "../../shared/catalogue/types";
import type { OrderLine, Attribution, ClientSignals, GatewayRecord } from "../../shared/orders/types";

const money = (name: string) => numeric(name, { mode: "number" });
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const ORDER_STATUSES = ["pending", "new", "prep", "ship", "done", "void"] as const;
export const PAYMENT_STATUSES = ["unpaid", "paid", "cod", "refunded", "cancelled"] as const;
export const PAY_METHODS = ["cod", "card", "transfer"] as const;

/** The published catalogue: one row. `version` makes every publish conditional. */
export const settings = pgTable(
  "settings",
  {
    id: integer("id").primaryKey().default(1),
    data: jsonb("data").$type<Catalogue>().notNull(),
    version: integer("version").notNull().default(1),
    updatedAt: ts("updated_at").notNull().defaultNow(),
    updatedBy: text("updated_by"),
  },
  (t) => [check("settings_single_row", sql`${t.id} = 1`)],
);

export const orders = pgTable(
  "orders",
  {
    id: text("id").primaryKey(), // LM-1234567890
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
    status: text("status", { enum: ORDER_STATUSES }).notNull().default("new"),
    paymentStatus: text("payment_status", { enum: PAYMENT_STATUSES }).notNull().default("unpaid"),
    pay: text("pay", { enum: PAY_METHODS }).notNull(),
    lang: text("lang").notNull().default("ar"),
    /** storefront | whatsapp_order (typed in the admin) | … */
    origin: text("origin"),

    // customer (nullable so the retention purge can clear them)
    name: text("name"),
    phone: text("phone"),
    /** the phone in international digits (e.g. 96876655565): CRM key, hashed for pixels */
    phoneKey: text("phone_key"),
    email: text("email"),
    country: text("country"),
    countryCode: text("country_code").notNull(),
    city: text("city"),
    region: text("region"),
    note: text("note"),

    // money, as priced by the till (display currency + OMR)
    items: jsonb("items").$type<OrderLine[]>().notNull(),
    cur: text("cur").notNull(),
    sub: money("sub").notNull(),
    ship: money("ship").notNull().default(0),
    codFee: money("cod_fee").notNull().default(0),
    total: money("total").notNull(),
    omrRate: doublePrecision("omr_rate").notNull(),
    omr: money("omr").notNull(),
    /** what the card is charged, in baisa (card orders) */
    amountBaisa: integer("amount_baisa"),

    /** the browser's idempotency key: the same submission twice is one order */
    dedupeId: text("dedupe_id").unique(),
    /** the secret in /invoice and /resume links */
    invoiceKey: text("invoice_key").notNull(),

    attribution: jsonb("attribution").$type<Attribution>(),
    /** what the server-side Purchase needs: ip, ua, page url, fbp/fbc, scid, GA ids, visitor id */
    client: jsonb("client").$type<ClientSignals>(),

    // card payment (Thawani)
    sessionId: text("session_id"),
    invoiceNo: text("invoice_no"),
    expireAt: ts("expire_at"),
    paidAt: ts("paid_at"),
    paymentId: text("payment_id"),
    maskedCard: text("masked_card"),
    cardType: text("card_type"),
    refunded: boolean("refunded").notNull().default(false),
    gatewayFee: money("gateway_fee"),
    netAmount: money("net_amount"),
    gateway: jsonb("gateway").$type<GatewayRecord>(),
    lastPaymentError: text("last_payment_error"),

    // fulfilment (manual tracking, or Empower via `shipments`)
    tracking: text("tracking"),
    carrier: text("carrier"),
    shippedAt: ts("shipped_at"),
    deliveredAt: ts("delivered_at"),

    // the shop's own marks
    adminNote: text("admin_note"),
    flagged: boolean("flagged").notNull().default(false),
    flaggedAt: ts("flagged_at"),
    trashed: boolean("trashed").notNull().default(false),
    trashedAt: ts("trashed_at"),
    piiClearedAt: ts("pii_cleared_at"),
  },
  (t) => [
    check("orders_status_check", sql`${t.status} in ('pending','new','prep','ship','done','void')`),
    check("orders_payment_status_check", sql`${t.paymentStatus} in ('unpaid','paid','cod','refunded','cancelled')`),
    check("orders_pay_check", sql`${t.pay} in ('cod','card','transfer')`),
    index("orders_created_idx").on(t.createdAt.desc()),
    index("orders_status_country_idx").on(t.status, t.countryCode, t.createdAt.desc()),
    index("orders_invoice_no_idx").on(t.invoiceNo),
    index("orders_phone_key_idx").on(t.phoneKey),
  ],
);

/** Every change to an order: the status flow, payments, edits — who, when, from → to. */
export const orderEvents = pgTable(
  "order_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    orderId: text("order_id").notNull().references(() => orders.id, { onDelete: "cascade" }),
    at: ts("at").notNull().defaultNow(),
    /** status | payment | edit | note | tracking | empower | refund | created | … */
    kind: text("kind").notNull(),
    from: text("from"),
    to: text("to"),
    /** admin | system | webhook | shopper | job:<name> */
    by: text("by").notNull(),
    detail: jsonb("detail").$type<Record<string, unknown>>(),
  },
  (t) => [index("order_events_order_idx").on(t.orderId, t.at)],
);

/** Parcels sent to Empower (Omniful). One row per send; a re-send after take-off is a new row. */
export const shipments = pgTable(
  "shipments",
  {
    id: text("id").primaryKey(), // omf-<sentId>
    orderId: text("order_id").references(() => orders.id, { onDelete: "set null" }),
    carrier: text("carrier").notNull().default("empower"),
    /** the order id as Omniful knows it: LM-…, or LM-…-2 after a take-off */
    sentId: text("sent_id").notNull(),
    /** Omniful's own order id */
    reference: text("reference"),
    /** the courier's waybill (e.g. Aramex) */
    awb: text("awb"),
    courierName: text("courier_name"),
    /** Omniful's status words, verbatim */
    status: text("status"),
    cod: money("cod"),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
    pickedUpAt: ts("picked_up_at"),
    deliveredAt: ts("delivered_at"),
    syncedAt: ts("synced_at"),
    lastError: text("last_error"),
  },
  (t) => [index("shipments_order_idx").on(t.orderId), index("shipments_updated_idx").on(t.updatedAt.desc())],
);

/** Small key → JSON records: job runs, caches, switches, the SKU map. */
export const ops = pgTable("ops", {
  key: text("key").primaryKey(),
  data: jsonb("data").$type<unknown>().notNull().default({}),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

/** Once-only claims (e.g. "purchase-LM-…", "ga4-LM-…"): unique by key, purged after 60 days. */
export const claims = pgTable("claims", {
  key: text("key").primaryKey(),
  at: ts("at").notNull().defaultNow(),
  state: text("state").notNull().default("taken"),
});

/** First-party analytics (allow-listed event names; sid is a per-tab random token). */
export const events = pgTable(
  "events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    at: ts("at").notNull().defaultNow(),
    name: text("name").notNull(),
    item: text("item"),
    sid: text("sid"),
    country: text("country"),
    city: text("city"),
    lat: real("lat"),
    lng: real("lng"),
  },
  (t) => [index("events_at_idx").on(t.at), index("events_sid_at_idx").on(t.sid, t.at)],
);

/** What the 90-day purge removed, added up per hour/session/country/name/item, kept for good. */
export const eventHours = pgTable(
  "event_hours",
  {
    hour: ts("hour").notNull(),
    sid: text("sid").notNull().default(""),
    country: text("country").notNull().default(""),
    name: text("name").notNull(),
    item: text("item").notNull().default(""),
    n: integer("n").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.hour, t.sid, t.country, t.name, t.item] })],
);

/** Server errors, job failures and browser errors. */
export const logs = pgTable(
  "logs",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    at: ts("at").notNull().defaultNow(),
    level: text("level").notNull().default("error"),
    /** server | job | browser */
    side: text("side").notNull().default("server"),
    source: text("source"),
    message: text("message").notNull(),
    orderId: text("order_id"),
    path: text("path"),
    detail: jsonb("detail").$type<Record<string, unknown>>(),
  },
  (t) => [index("logs_at_idx").on(t.at)],
);

/** Every webhook delivery (Thawani, Omniful): a record, and replay dedupe by body hash. */
export const webhookEvents = pgTable(
  "webhook_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    receivedAt: ts("received_at").notNull().defaultNow(),
    provider: text("provider").notNull(),
    eventType: text("event_type"),
    orderId: text("order_id"),
    invoice: text("invoice"),
    verified: boolean("verified").notNull().default(false),
    /** paid | duplicate | enriched | failed | mismatch | ignored | unhandled | unknown_order | rejected | … */
    applied: text("applied"),
    dedupeKey: text("dedupe_key").unique(),
    payload: jsonb("payload").$type<unknown>().notNull(),
  },
  (t) => [index("webhook_events_received_idx").on(t.receivedAt)],
);

/** Fixed-window counters: login lockout, order floods, the open collectors. */
export const rateLimits = pgTable("rate_limits", {
  key: text("key").primaryKey(),
  count: integer("count").notNull().default(0),
  resetAt: ts("reset_at").notNull(),
});

/** The shop's notes and tags per customer (by phone key). */
export const crm = pgTable("crm", {
  phoneKey: text("phone_key").primaryKey(),
  note: text("note"),
  tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

/** Every admin write: who, what, when. */
export const adminAudit = pgTable(
  "admin_audit",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    at: ts("at").notNull().defaultNow(),
    actor: text("actor").notNull(),
    action: text("action").notNull(),
    target: text("target"),
    summary: jsonb("summary").$type<Record<string, unknown>>(),
  },
  (t) => [index("admin_audit_at_idx").on(t.at)],
);

/** What changed on the storefront (catalogue publishes), in words, for the Analytics tab. */
export const catalogueChanges = pgTable(
  "catalogue_changes",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    at: ts("at").notNull().defaultNow(),
    actor: text("actor").notNull(),
    what: text("what").notNull(),
    detail: jsonb("detail").$type<Record<string, unknown>>(),
  },
  (t) => [index("catalogue_changes_at_idx").on(t.at)],
);

export type OrderRow = typeof orders.$inferSelect;
export type NewOrderRow = typeof orders.$inferInsert;
export type ShipmentRow = typeof shipments.$inferSelect;
export type OrderStatus = (typeof ORDER_STATUSES)[number];
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];
export type PayMethod = (typeof PAY_METHODS)[number];
