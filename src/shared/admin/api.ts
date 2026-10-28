/**
 * THE ADMIN API, AS THE SPA SEES IT — paths, request schemas (./schemas), answer types and the
 * panel's constants. Imported by the server routes (which check their answers against these
 * types at compile time) and by the admin SPA (src/admin).
 *
 * Every answer is JSON `{ ok: true, … }` or `{ ok: false, error: <code>, …extra }`; refusals
 * keep the original panel's codes. Dates travel as ISO strings. Every non-GET request must
 * carry the header `X-LM-Admin: 1` and come from the site's own origin; the session is an
 * HttpOnly cookie (`lm_admin`), so the SPA sends `credentials: "same-origin"` and never sees it.
 */
import type { Catalogue } from "../catalogue/types";
import type { KpiResult } from "../kpi";
import type { Attribution, OrderLine } from "../orders/types";

export * from "./schemas";
/* the values the panel needs live apart from the schemas, so the SPA can import them without zod */
export * from "./constants";
import type { AdminPage } from "./constants";

/* ---------------- wire helpers ---------------- */

/** A server value as it arrives: Dates become ISO strings. */
export type Jsonify<T> = T extends Date
  ? string
  : T extends (infer U)[]
    ? Jsonify<U>[]
    : T extends readonly (infer U)[]
      ? readonly Jsonify<U>[]
      : T extends object
        ? { [K in keyof T]: Jsonify<T[K]> }
        : T;

export interface Refusal {
  ok: false;
  error: string;
  /** zod issues, for `bad_input` */
  issues?: Array<{ path: string; message: string }>;
  [k: string]: unknown;
}

/* ---------------- session ---------------- */

export interface SessionAnswer {
  ok: true;
  signedIn: boolean;
  /** the server has a user, a password (or hash) and a SESSION_SECRET */
  configured: boolean;
  user?: string;
  expiresAt?: string;
}

/* ---------------- orders ---------------- */

export interface ShipmentSummary {
  id: string;
  sentId: string;
  reference: string | null;
  awb: string | null;
  courier: string | null;
  status: string | null;
  at: string;
  deliveredAt: string | null;
}

/** One row of the Orders list (no raw gateway payload, no client signals). */
export interface OrderListRow {
  id: string;
  createdAt: string;
  updatedAt: string;
  status: (typeof import("./schemas").ORDER_STATUSES)[number];
  paymentStatus: (typeof import("./schemas").PAYMENT_STATES)[number];
  pay: (typeof import("./schemas").PAY_METHODS)[number];
  lang: string;
  origin: string | null;
  name: string | null;
  phone: string | null;
  phoneKey: string | null;
  email: string | null;
  country: string | null;
  countryCode: string;
  city: string | null;
  region: string | null;
  note: string | null;
  items: OrderLine[];
  cur: string;
  sub: number;
  ship: number;
  codFee: number;
  total: number;
  omrRate: number;
  omr: number;
  amountBaisa: number | null;
  attribution: Attribution | null;
  invoiceNo: string | null;
  paidAt: string | null;
  paymentId: string | null;
  maskedCard: string | null;
  refunded: boolean;
  gatewayFee: number | null;
  netAmount: number | null;
  lastPaymentError: string | null;
  tracking: string | null;
  carrier: string | null;
  shippedAt: string | null;
  deliveredAt: string | null;
  adminNote: string | null;
  flagged: boolean;
  flaggedAt: string | null;
  trashed: boolean;
  trashedAt: string | null;
  hasGateway: boolean;
  /** what a courier would need and the order lacks */
  check?: string[];
  /** its newest Empower send */
  shipment?: ShipmentSummary;
  [k: string]: unknown;
}

export interface OrdersAnswer {
  ok: true;
  unchanged?: false;
  orders: OrderListRow[];
  total: number;
  limit: number;
  offset: number;
  /** send back as `since` on the timed refresh */
  tag: string;
  /** orders whose push got no answer (being checked) */
  empowerUnsure: string[];
}
export interface OrdersUnchanged {
  ok: true;
  unchanged: true;
  tag: string;
}

export interface OrderEvent {
  id: number;
  orderId: string;
  at: string;
  kind: string;
  from: string | null;
  to: string | null;
  by: string;
  detail: Record<string, unknown> | null;
}

export interface OrderDetailAnswer {
  ok: true;
  order: OrderListRow & { check: string[]; gateway?: unknown };
  events: OrderEvent[];
  shipments: Array<Record<string, unknown>>;
}

export interface ItemOption {
  /** the id a basket line carries ("oud-large", "bundle", "burner", "duo") */
  itemId: string;
  kind: "box" | "set" | "extra" | "tier";
  name: string;
  name_en: string;
  /** the market's price, null when it has none (not sold here) */
  price: number | null;
  was: number | null;
  soldOut: boolean;
  /** offered on the storefront now (switched on, priced, not hidden) */
  active: boolean;
  scentId?: string;
  sizeId?: string;
}
export interface ItemOptionsAnswer {
  ok: true;
  country: string;
  cur: string;
  dec: number;
  items: ItemOption[];
}

export interface MoveAnswer {
  ok: true;
  id: string;
  from: string;
  to: string;
  changed: boolean;
}
export interface BulkAnswer {
  ok: true;
  op: string;
  updated?: number;
  deleted?: number;
  stale?: string[];
}

export interface ManualOrderAnswer {
  ok: true;
  id: string;
  already: boolean;
  cur: string;
  sub: number;
  ship: number;
  codFee: number;
  total: number;
  omr: number;
  catalogueTotal?: number;
  codAmount?: number;
}

/* ---------------- overview ---------------- */

export interface OrdersSummary {
  n: number;
  all: KpiResult;
  week: KpiResult;
  before: KpiResult;
  delta: number;
  byDay: Record<string, number>;
}

export interface Warning {
  /** warn:<w> | stale:<job> */
  code: string;
  kind: "warn" | "stale";
  /** the word after the prefix (thawani_uat_in_production, empower-poll, …) */
  what: string;
  /** a missing key cannot be dismissed: it is not a notice, it is broken */
  dismissible: boolean;
}

export interface OverviewAnswer {
  ok: true;
  orders: OrdersSummary;
  /** every current warning not dismissed */
  warnings: Warning[];
  /** how many current warnings are dismissed */
  dismissedN: number;
  health: { ok: boolean; db: { ok: boolean; ms: number | null }; staleJobs: string[]; release: string };
}

/* ---------------- customers ---------------- */

export interface CustomerRow {
  phoneKey: string;
  name: string | null;
  phone: string | null;
  orders: number;
  live: number;
  spend: number;
  first: string;
  last: string;
  countries: string[];
  note: string;
  tags: string[];
}
export interface CustomersAnswer {
  ok: true;
  customers: CustomerRow[];
  limit: number;
  offset: number;
}

/* ---------------- catalogue ---------------- */

export interface CatalogueAnswer {
  ok: true;
  /** what the storefront serves: the published catalogue with the code-owned fields overlaid */
  data: Catalogue;
  /** the row as stored (null: nothing published yet — `data` is then the deploy's file) */
  stored: Catalogue | null;
  /** the row's version: send it back with the publish (0 = nothing published) */
  version: number;
  /** a fingerprint of everything the Catalogue tab edits: send it back too */
  editTag: string;
  updatedAt: string | null;
  updatedBy: string | null;
  /** the fields the deploy owns (read-only in the panel) */
  codeOwned: Record<string, readonly string[]>;
  /** the deploy file's own catalogue version */
  deployVersion: number | null;
}

export interface PublishAnswer {
  ok: true;
  version: number;
  editTag: string;
  updatedAt: string;
  /** the change lines recorded ([] when nothing on the storefront changed) */
  change: string[];
  /** the stored catalogue, with the anchors and starts the server stamped */
  data: Catalogue;
}

/* ---------------- settings, audit ---------------- */

export interface UiAnswer {
  ok: true;
  ui: { hidden: AdminPage[] };
  dismissed: string[];
}

export interface AuditRow {
  id: number;
  at: string;
  actor: string;
  action: string;
  target: string | null;
  summary: Record<string, unknown> | null;
}
export interface AuditAnswer {
  ok: true;
  days: number;
  rows: AuditRow[];
}

/* ---------------- the endpoint table ---------------- */

/**
 * Every route, for the SPA's client and the docs. `body`/`query` name the schema in
 * ./schemas; `write` routes are audited.
 */
export const ENDPOINTS = [
  // session
  { method: "POST", path: "/login", body: "LoginBody", write: false },
  { method: "POST", path: "/logout", body: "LogoutBody", write: false },
  { method: "GET", path: "/session" },
  // overview, health
  { method: "GET", path: "/overview" },
  { method: "GET", path: "/health" },
  // orders
  { method: "GET", path: "/orders", query: "OrdersQuery" },
  { method: "GET", path: "/orders/export.csv", query: "OrdersQuery" },
  { method: "GET", path: "/orders/summary" },
  { method: "GET", path: "/orders/options", query: "OptionsQuery" },
  { method: "POST", path: "/orders/manual/quote", body: "ManualQuoteBody" },
  { method: "POST", path: "/orders/manual", body: "ManualOrderBody", write: true },
  { method: "POST", path: "/orders/bulk", body: "BulkBody", write: true },
  { method: "GET", path: "/orders/:id", query: "OrderDetailQuery" },
  { method: "GET", path: "/orders/:id/gateway" },
  { method: "PATCH", path: "/orders/:id/customer", body: "CustomerBody", write: true },
  { method: "PUT", path: "/orders/:id/items", body: "ItemsBody", write: true },
  { method: "POST", path: "/orders/:id/status", body: "StatusBody", write: true },
  { method: "PUT", path: "/orders/:id/tracking", body: "TrackingBody", write: true },
  { method: "POST", path: "/orders/:id/payment", body: "PaymentBody", write: true },
  { method: "PUT", path: "/orders/:id/flag", body: "FlagBody", write: true },
  { method: "PUT", path: "/orders/:id/note", body: "NoteBody", write: true },
  // customers
  { method: "GET", path: "/customers", query: "CustomersQuery" },
  { method: "GET", path: "/crm" },
  { method: "PUT", path: "/customers/:key", body: "CrmBody", write: true },
  // payments
  { method: "GET", path: "/payments", query: "PaymentsQuery" },
  { method: "GET", path: "/payments/ask/:id" },
  { method: "POST", path: "/payments/refund", body: "RefundBody", write: true },
  { method: "POST", path: "/payments/mark-paid", body: "MarkPaidBody", write: true },
  // Empower
  { method: "GET", path: "/empower" },
  { method: "GET", path: "/empower/waiting" },
  { method: "GET", path: "/empower/pushed", query: "PushedQuery" },
  { method: "POST", path: "/empower/push", body: "PushBody", write: true },
  { method: "POST", path: "/empower/push-many", body: "PushManyBody", write: true },
  { method: "GET", path: "/empower/auto" },
  { method: "PUT", path: "/empower/auto", body: "AutoBody", write: true },
  { method: "POST", path: "/empower/sync", write: true },
  { method: "POST", path: "/empower/take-off", body: "TakeOffBody", write: true },
  { method: "GET", path: "/empower/skus" },
  { method: "PUT", path: "/empower/skus", body: "SkusBody", write: true },
  { method: "GET", path: "/empower/catalog" },
  { method: "POST", path: "/empower/skus/match", body: "SkuMatchBody" },
  { method: "PUT", path: "/empower/routes/:code", body: "RouteBody", write: true },
  { method: "GET", path: "/stock", query: "StockQuery" },
  // catalogue
  { method: "GET", path: "/catalogue" },
  { method: "POST", path: "/catalogue/publish", body: "PublishBody", write: true },
  { method: "POST", path: "/catalogue/restore-defaults", body: "RestoreBody", write: true },
  { method: "PATCH", path: "/catalogue/stock", body: "StockSwitchesBody", write: true },
  { method: "GET", path: "/catalogue/export" },
  // analytics
  { method: "GET", path: "/analytics/summary", query: "SummaryQuery" },
  { method: "GET", path: "/analytics/live", query: "LiveQuery" },
  { method: "GET", path: "/analytics/busy", query: "BusyQuery" },
  { method: "GET", path: "/analytics/errors", query: "ErrorsQuery" },
  { method: "GET", path: "/analytics/errors.csv", query: "ErrorsQuery" },
  { method: "GET", path: "/analytics/tracking" },
  { method: "GET", path: "/analytics/links" },
  { method: "GET", path: "/analytics/changes", query: "ChangesQuery" },
  { method: "DELETE", path: "/analytics/changes/:id", write: true },
  { method: "POST", path: "/analytics/changes/clear", body: "ClearChangesBody", write: true },
  { method: "POST", path: "/analytics/reset", body: "ResetAnalyticsBody", write: true },
  // settings, audit, jobs
  { method: "GET", path: "/settings/ui" },
  { method: "PUT", path: "/settings/ui", body: "UiBody", write: true },
  { method: "GET", path: "/audit", query: "AuditQuery" },
  { method: "GET", path: "/jobs" },
  { method: "POST", path: "/jobs/:name/run", write: true },
] as const;
