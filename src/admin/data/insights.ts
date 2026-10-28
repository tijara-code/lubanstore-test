/**
 * THE INSIGHT TABS' ENDPOINTS — Payments, Customers and Analytics, typed. One function per route
 * in the style of ./endpoints.ts. The answers are declared here as the SPA receives them (the
 * server's domain modules cannot be imported by the panel): domain/payments/admin.ts
 * `listPayments`/`askThawani`/`markPaidByHand`, domain/payments/refunds.ts `refundPayment`,
 * domain/order-admin.ts `listCustomers`/`saveCrm`, domain/analytics/* and domain/health.ts.
 */
import type { CustomersAnswer } from "../../shared/admin/api";
import { ApiError, get, send, urlOf, type Query } from "./api";

/* ---------------- payments ---------------- */

export interface PaymentRow {
  orderId?: string;
  customer?: string;
  country?: string;
  orderTotal?: number | null;
  orderCur?: string;
  paymentId: string;
  invoice: string;
  session?: string;
  intent: string;
  /** Thawani's word: successful | inProccess (in progress, their spelling) | cancelled | unpaid | … */
  status: string;
  paid: boolean;
  refunded: boolean;
  /** OMR */
  amount: number;
  fee: number;
  net: number;
  card: string;
  cardType: string;
  at: string | null;
  reason: string;
  refunds: Array<{ id: string; amount: number; status: string; reason: string; at: string | null }>;
  /** an invoice we never heard back about (abandoned, declined): Thawani knows more */
  stale?: boolean;
  invoiceKey?: string;
  pay?: "card" | "cod";
  source?: string;
}

export interface PaymentsAnswer {
  ok: true;
  rows: PaymentRow[];
  limit: number;
  skip: number;
  more: boolean;
  total: number;
  gateway: boolean;
  lookedUp: number;
  /** gaps on this page not asked about */
  pending: number;
  mode: string;
}

export const listPayments = (q: { limit?: number; skip?: number; lookups?: number; from?: string; to?: string }) => get<PaymentsAnswer>("/payments", q as Query);
export const askThawani = (id: string) => get<{ ok: true; row: PaymentRow; payments: PaymentRow[] }>("/payments/ask/" + encodeURIComponent(id));
export const refundPayment = (paymentId: string, reason: string) =>
  send<{ ok: true; refundId: string; orderId: string | null; amount: number }>("POST", "/payments/refund", { paymentId, reason });
export const markPaidByHand = (id: string, paymentId: string, acceptAmount?: boolean) =>
  send<{ ok: true; id: string; paymentId: string; amount: number }>("POST", "/payments/mark-paid", acceptAmount ? { id, paymentId, acceptAmount: true } : { id, paymentId });

/* ---------------- customers ---------------- */

export const listCustomers = (q: { q?: string; country?: string; sort?: "last" | "spend" | "orders"; limit?: number; offset?: number }) => get<CustomersAnswer>("/customers", q as Query);
export const saveCustomer = (phoneKey: string, body: { note: string; tags: string[] }) =>
  send<{ ok: true; phoneKey: string; note: string; tags: string[]; removed?: boolean }>("PUT", "/customers/" + encodeURIComponent(phoneKey), body);

/* ---------------- analytics ---------------- */

export interface SmRow {
  key: string;
  source: string;
  medium: string;
  campaign?: string;
  sessions: number;
  /** orders (every one) and the live ones, and what the live ones came to (OMR) */
  n: number;
  live: number;
  omr: number;
  /** live orders per session, %; null without sessions */
  rate: number | null;
}

export interface BusyGrid {
  visits: number[][];
  orders: number[][];
  weekdays: number[];
}

export interface StatsFilter {
  country: string;
  platform: string;
  paid: "paid" | "unpaid" | "";
}

export interface StatsSummary {
  ok: true;
  days: number;
  all: boolean;
  custom: boolean;
  span: number;
  from: string | null;
  to: string | null;
  total: number;
  capped: boolean;
  coveredFrom: string | null;
  sessions: number;
  events: Record<string, number>;
  uniqueByEvent: Record<string, number>;
  addedToCart: number;
  funnel: Array<{ step: string; sessions: number }>;
  orders: {
    total: number | null;
    byDay: Record<string, number>;
    withVisits?: { from: string | null; total: number };
    capped?: boolean;
    origins?: Array<{ key: string; n: number; live: number; omr: number }>;
    error?: string;
  };
  items: Array<{ key: string; n: number }>;
  countries: Array<{ key: string; n: number }>;
  grain: "day" | "week";
  daily: Array<{ day: string; events: number; views: number; sessions: number; orders: number }>;
  sourceMedium: { rows: SmRow[]; campaigns: SmRow[]; sessionsFrom: string | null };
  filter: StatsFilter;
  busy: BusyGrid;
}

export interface SummaryAsk {
  range?: string;
  from?: string;
  to?: string;
  country?: string;
  platform?: string;
  paid?: string;
}
export const statsSummary = (q: SummaryAsk) => get<StatsSummary>("/analytics/summary", q as Query);

export interface LiveVisitor {
  k: string;
  step: number;
  stage: string;
  detail: string;
  country: string;
  city: string;
  /** [lng, lat] to a tenth of a degree, or null (pinned to the country) */
  ll: [number, number] | null;
  src: string;
  page: string;
  adds: number;
  first: string;
  last: string;
}
export interface LiveAnswer {
  ok: true;
  at: string;
  minutes: number;
  today?: boolean;
  geo: boolean;
  steps: number[];
  visitors: LiveVisitor[];
  capped: boolean;
}
export const liveVisitors = (minutes: number | "today") => get<LiveAnswer>("/analytics/live", { minutes });

export interface LogGroup {
  key: string;
  side: "server" | "browser";
  kind: string;
  message: string;
  n: number;
  first: string;
  last: string;
  orderIds: string[];
  browsers: string[];
  visitors: number;
}
export interface LogRow {
  id: number;
  at: string;
  side: "server" | "browser";
  kind: string;
  message: string;
  orderId: string | null;
  path: string | null;
  browser: string;
  detail: string;
}
export interface LogsAnswer {
  ok: true;
  days: number;
  cap: number;
  capped: boolean;
  rows: LogRow[];
  groups: LogGroup[];
}
export const logsList = (days: number, side: "" | "server" | "browser") => get<LogsAnswer>("/analytics/errors", { days, side });
export const logsCsvUrl = (days: number, side: "" | "server" | "browser") => urlOf("/analytics/errors.csv", { days, side });

export interface ChangeEntry {
  id: number;
  at: string;
  actor: string;
  what: string;
  lines: string[];
  before: number;
  after: number;
  counting: boolean;
  delta: number | null;
}
export const listChanges = (winDays: number) => get<{ ok: true; winDays: number; changes: ChangeEntry[] }>("/analytics/changes", { winDays, limit: 2000 });
export const deleteChange = (id: number) => send<{ ok: true; id: number }>("DELETE", "/analytics/changes/" + id);
export const clearChanges = () => send<{ ok: true; deleted: number }>("POST", "/analytics/changes/clear", { confirm: "changes" });
export const resetAnalytics = () => send<{ ok: true; deleted: number }>("POST", "/analytics/reset", { confirm: "events" });

export interface PxRecord {
  day?: string;
  sent?: number;
  failed?: number;
  failedToday: number;
  lastOkAt?: string;
  lastFailAt?: string;
  lastError?: string;
  lastEvent?: string;
  purchase?: { at: string; ok: boolean; fields: string[] } | null;
}
export interface HealthAnswer {
  ok: boolean;
  pixels?: {
    meta: { pixel: boolean; capi: boolean };
    snap: { pixel: boolean; capi: boolean };
    ga4: { id: boolean; mp: boolean };
  };
  tracking: { meta: PxRecord | null; snap: PxRecord | null; ga4: PxRecord | null; warnings: string[] } | null;
}
/**
 * GET /health. Its `ok` is the store's health (false while a job is late), not the request's,
 * so it is read without the client's `ok: true` rule: a 200 is the answer, anything else an error.
 */
export async function health(): Promise<HealthAnswer> {
  let res: Response;
  try {
    res = await fetch(urlOf("/health"), { headers: { Accept: "application/json" }, credentials: "same-origin", cache: "no-store" });
  } catch {
    throw new ApiError("network", 0);
  }
  if (res.status === 401) return get<HealthAnswer>("/health"); // the client's own 401 handling (back to the gate)
  if (!res.ok) throw new ApiError("http_" + res.status, res.status);
  return (await res.json()) as HealthAnswer;
}
