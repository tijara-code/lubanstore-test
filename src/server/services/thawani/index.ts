/**
 * THE THAWANI CLIENT — card payments (Oman). The same client runs in every mode; in fake mode
 * its network is the in-process emulator (./fake.ts) and its pay URL points at the dev page
 * (/__fake/thawani/pay/<session>) so a card checkout can be clicked through locally.
 *
 *   THAWANI_MODE             uat | live (default uat)
 *   THAWANI_SECRET_KEY       server-side, sent as the `thawani-api-key` header
 *   THAWANI_PUBLISHABLE_KEY  goes in the hosted page's URL; public by design
 *
 * Two things about this API that are easy to get wrong:
 *   1. every amount is in BAISA (1 OMR = 1000), an integer. 32.9 instead of 32900 charges 3 baisa.
 *   2. a session has only `products` — no shipping or fee field (domain/payments/session.ts
 *      adds delivery as a line and balances the lines to the total).
 *
 * And one the spec does not say: `GET /payments` is not a list. Every query must name a
 * checkout invoice or a payment intent ("Missing required parameter …"), which is why the
 * admin's Payments page is built from our own card orders and only the gaps are looked up.
 */
import { baisaToOmr } from "../../../shared/money";
import { call, OutboundError, type FetchLike } from "../../core/outbound";
import type { ServiceContext } from "../context";

export const HOSTS = {
  uat: { api: "https://uatcheckout.thawani.om/api/v1", pay: "https://uatcheckout.thawani.om/pay" },
  live: { api: "https://checkout.thawani.om/api/v1", pay: "https://checkout.thawani.om/pay" },
} as const;

/** Seven seconds: the checkout and the reminder link wait on this with a shopper watching. */
export const TH_TIMEOUT = 7000;

/** Thawani's words for a charge that worked (one list for settlement and the panel). */
export const PAID_WORDS = ["successful", "succeeded", "success", "paid", "captured"] as const;
/** Still being processed — Thawani's own spelling ("inProccess") included. Not a failure. */
export const IN_PROGRESS_WORDS = ["inproccess", "inprocess", "in_process", "pending", "processing"] as const;

export function isPaidStatus(status: unknown): boolean {
  return (PAID_WORDS as readonly string[]).indexOf(String(status || "").toLowerCase()) > -1;
}
export function isInProgressStatus(status: unknown): boolean {
  return (IN_PROGRESS_WORDS as readonly string[]).indexOf(String(status || "").toLowerCase()) > -1;
}

export interface ThawaniProduct {
  name: string;
  quantity: number;
  unit_amount: number;
}

export interface SessionBody {
  client_reference_id: string;
  mode: "payment";
  products: ThawaniProduct[];
  success_url: string;
  cancel_url: string;
  expire_in_minutes?: number;
  metadata?: Record<string, unknown>;
}

/** A checkout session as Thawani returns it (the fields this shop reads; the rest is kept raw). */
export interface ThawaniSession {
  session_id: string;
  client_reference_id?: string;
  invoice?: string | null;
  payment_status?: string;
  total_amount?: number;
  expire_at?: string | null;
  created_at?: string | null;
  metadata?: Record<string, unknown> | null;
  products?: ThawaniProduct[];
  success_url?: string;
  cancel_url?: string;
  [k: string]: unknown;
}

/** One charge, as GET /payments returns it. */
export interface ThawaniPayment {
  payment_id?: string;
  id?: string;
  checkout_invoice?: string | null;
  payment_intent?: string | null;
  status?: string;
  amount?: number;
  fee?: number;
  masked_card?: string | null;
  card_type?: string | null;
  refunded?: boolean;
  refunds?: Array<{ refund_id?: string; id?: string; amount?: number; status?: string; reason?: string; created_at?: string }>;
  reason?: string | null;
  created_at?: string | null;
  [k: string]: unknown;
}

/** The envelope every answer comes in. */
export interface ThawaniAnswer<T> {
  success?: boolean;
  code?: number;
  description?: string;
  data: T;
  [k: string]: unknown;
}

/** What the order keeps from the payment (card details, fee), OMR. */
export interface PaymentFields {
  payment_id: string | null;
  masked_card: string | null;
  card_type: string | null;
  status: string | null;
  fee_omr: number | null;
  amount_omr: number | null;
  refunded: boolean;
  reason: string | null;
}

export interface Enriched {
  raw: ThawaniAnswer<ThawaniPayment[]>;
  payment: ThawaniPayment;
  fields: PaymentFields;
}

/** A refusal or failure from the gateway. `unreachable`: nothing was answered (timeout, network). */
export class ThawaniError extends Error {
  constructor(
    message: string,
    readonly code: string | number | null,
    readonly status: number,
    readonly detail: unknown = null,
    readonly unreachable = false,
  ) {
    super(message);
    this.name = "ThawaniError";
  }
}

export interface ThawaniClient {
  /** both keys present */
  configured(): boolean;
  mode(): "uat" | "live";
  /** the hosted page for a session; in fake mode the dev page on `origin` */
  payUrl(sessionId: string, origin?: string): string;
  createSession(body: SessionBody): Promise<ThawaniAnswer<ThawaniSession>>;
  /** GET /checkout/reference/<order id>: the latest session for the order */
  sessionByReference(ref: string): Promise<{ raw: ThawaniAnswer<unknown>; session: ThawaniSession | null }>;
  /** GET /checkout/session/<id> */
  sessionById(sessionId: string): Promise<ThawaniAnswer<ThawaniSession>>;
  /** the charges on one checkout invoice, the successful one picked; null on any failure (enrichment only) */
  paymentsForInvoice(invoice: string | null | undefined): Promise<Enriched | null>;
  /** one page of charges, scoped to an invoice or a payment intent (Thawani refuses an unscoped list) */
  listPayments(q: { invoice?: string; intent?: string; limit?: number; skip?: number }): Promise<ThawaniPayment[]>;
  /** GET /payments/<id>; null when Thawani says there is none */
  paymentById(paymentId: string): Promise<ThawaniPayment | null>;
  /** POST /refunds (full refund only: Thawani's refund takes no amount here) */
  refund(body: { payment_id: string; reason: string; metadata?: Record<string, unknown> }): Promise<ThawaniAnswer<Record<string, unknown>>>;
}

declare module "../../core/deps" {
  interface Services {
    thawani: ThawaniClient;
  }
}

/** The charge to keep from a list: a successful one (a checkout can carry declines first), else the first. */
export function pickPayment(list: ThawaniPayment[]): ThawaniPayment | null {
  return list.filter((p) => isPaidStatus(p && p.status))[0] || list[0] || null;
}

export function fieldsOf(p: ThawaniPayment): PaymentFields {
  return {
    payment_id: p.payment_id ? String(p.payment_id) : null,
    masked_card: p.masked_card ? String(p.masked_card) : null,
    card_type: p.card_type ? String(p.card_type) : null,
    status: p.status ? String(p.status) : null,
    fee_omr: p.fee != null && Number.isFinite(Number(p.fee)) ? baisaToOmr(p.fee) : null,
    amount_omr: p.amount != null && Number.isFinite(Number(p.amount)) ? baisaToOmr(p.amount) : null,
    refunded: !!p.refunded,
    reason: p.reason ? String(p.reason) : null,
  };
}

function asList<T>(v: unknown): T[] {
  if (Array.isArray(v)) return v as T[];
  return v ? [v as T] : [];
}

export function createThawaniClient(ctx: ServiceContext): ThawaniClient {
  const env = ctx.env;
  const fetchImpl: FetchLike = ctx.fetch;
  const mode = (): "uat" | "live" => (String(env.THAWANI_MODE || "uat").toLowerCase() === "live" ? "live" : "uat");
  const host = () => HOSTS[mode()];
  const secret = () => String(env.THAWANI_SECRET_KEY || "");
  const publishable = () => String(env.THAWANI_PUBLISHABLE_KEY || "");

  async function api<T>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<ThawaniAnswer<T>> {
    let res;
    try {
      res = await call<ThawaniAnswer<T>>(fetchImpl, host().api + path, {
        method: opts.method || "GET",
        headers: { "thawani-api-key": secret(), "content-type": "application/json", accept: "application/json" },
        body: opts.body,
        timeoutMs: TH_TIMEOUT,
      });
    } catch (e) {
      const timeout = e instanceof OutboundError && e.code === "timeout";
      throw new ThawaniError(
        timeout ? "the payment gateway did not answer in time" : "could not reach the payment gateway",
        "gateway_unreachable", 504, String((e as Error)?.message || e), true,
      );
    }
    const data = res.data as ThawaniAnswer<T> | string | null;
    const obj = data && typeof data === "object" ? data : null;
    if (!res.ok || !obj || obj.success === false) {
      throw new ThawaniError(
        String((obj && (obj.description || (obj as { message?: string }).message)) || "thawani " + res.status),
        obj && obj.code != null ? obj.code : null, res.status, data,
      );
    }
    return obj;
  }

  return {
    configured: () => !!(secret() && publishable()),
    mode,
    payUrl(sessionId, origin) {
      const q = "?key=" + encodeURIComponent(publishable());
      if (env.servicesMode === "fake" && origin) return origin.replace(/\/+$/, "") + "/__fake/thawani/pay/" + encodeURIComponent(sessionId) + q;
      return host().pay + "/" + encodeURIComponent(sessionId) + q;
    },
    createSession: (body) => api<ThawaniSession>("/checkout/session", { method: "POST", body }),
    async sessionByReference(ref) {
      const raw = await api<unknown>("/checkout/reference/" + encodeURIComponent(ref));
      const d = raw.data;
      const session = (Array.isArray(d) ? d[0] : d) as ThawaniSession | undefined;
      return { raw, session: session && typeof session === "object" ? session : null };
    },
    sessionById: (sessionId) => api<ThawaniSession>("/checkout/session/" + encodeURIComponent(sessionId)),
    async paymentsForInvoice(invoice) {
      if (!invoice) return null;
      try {
        const raw = await api<ThawaniPayment[]>("/payments?limit=5&skip=0&checkout_invoice=" + encodeURIComponent(String(invoice)));
        const list = asList<ThawaniPayment>(raw.data);
        const hit = pickPayment(list);
        if (!hit) return null;
        return { raw: { ...raw, data: list }, payment: hit, fields: fieldsOf(hit) };
      } catch {
        return null;
      }
    },
    async listPayments(q) {
      if (!q.invoice && !q.intent) throw new ThawaniError("an invoice or a payment intent is required", "bad_query", 400);
      const p = new URLSearchParams();
      p.set("limit", String(Math.max(1, Math.min(100, q.limit || 10))));
      p.set("skip", String(Math.max(0, q.skip || 0)));
      if (q.invoice) p.set("checkout_invoice", q.invoice);
      if (q.intent) p.set("payment_intent", q.intent);
      const raw = await api<ThawaniPayment[]>("/payments?" + p.toString());
      return asList<ThawaniPayment>(raw.data);
    },
    async paymentById(paymentId) {
      try {
        const raw = await api<ThawaniPayment | ThawaniPayment[]>("/payments/" + encodeURIComponent(paymentId));
        return asList<ThawaniPayment>(raw.data)[0] || null;
      } catch (e) {
        if (e instanceof ThawaniError && e.status === 404) return null;
        throw e;
      }
    },
    refund: (body) => api<Record<string, unknown>>("/refunds", { method: "POST", body }),
  };
}

/** Augments Services with `thawani`. */
export function createThawani(ctx: ServiceContext): { thawani: ThawaniClient } {
  return { thawani: createThawaniClient(ctx) };
}
