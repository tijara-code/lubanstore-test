/**
 * THE THAWANI EMULATOR — the gateway as the shop sees it, in the fake world. Shapes are the
 * ones Thawani's documentation and the original store's captured run use
 * (docs/PAYMENT-WALKTHROUGH.md in the original): the session envelope (code 2004 "Session
 * generated successfully"), the reference lookup, the charges on an invoice (with the fee,
 * the masked card, `refunds`), refunds, and Thawani's refusals (an unscoped GET /payments,
 * a bad line, a missing key).
 *
 * Besides the API it keeps the hosted pay page's state, and answers a few control routes
 * under /__fake/ (fake world only) so the dev pay page can "pay" a session as a shopper would.
 *
 *   const th = thawaniFake(world);
 *   th.payByReference("LM-1234567")        → { session, payment }  (the shopper paid)
 *   th.cancel(sessionId)                   the shopper pressed Cancel
 *   th.decline(sessionId, "Insufficient funds")
 *   signDelivery(completedEvent(session), secret)  → { body, headers } for POST /api/pay/webhook
 */
import { createHmac } from "node:crypto";
import { json, type Emulator, type World, type WorldCall } from "../fakes/world";
import type { ThawaniPayment, ThawaniProduct, ThawaniSession } from "./index";

export interface FakeSession extends ThawaniSession {
  /** what the hosted page shows: open, paid, cancelled */
  hosted: "open" | "paid" | "cancelled";
}

export interface FakeRefund {
  refund_id: string;
  payment_id: string;
  status: string;
  amount: number;
  reason: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface ThawaniState {
  sessions: FakeSession[];
  payments: ThawaniPayment[];
  refunds: FakeRefund[];
  n: number;
}

export interface PayOptions {
  /** the session's payment_status after paying (default "paid") */
  status?: string;
  /** the charge's status (default "successful") */
  payStatus?: string;
  /** what was charged, baisa (default the session's total) */
  amount?: number;
  /** Thawani's fee, baisa (default 2% + 100) */
  fee?: number;
  card?: string;
  cardType?: string;
}

export interface ThawaniFake extends Emulator {
  state: ThawaniState;
  sessionById(sessionId: string): FakeSession | null;
  /** the latest session opened for an order */
  sessionFor(ref: string): FakeSession | null;
  paySession(sessionId: string, opts?: PayOptions): { session: FakeSession; payment: ThawaniPayment };
  payByReference(ref: string, opts?: PayOptions): { session: FakeSession; payment: ThawaniPayment };
  cancel(sessionId: string): FakeSession;
  decline(sessionId: string, reason?: string): ThawaniPayment;
}

const OK = (data: unknown, code = 2000, description = "object retrieved successfully") => json(200, { success: true, code, description, data });
const NO = (status: number, code: number, description: string) => json(status, { success: false, code, description });

function iso(t: number): string {
  return new Date(t).toISOString();
}

function sign(body: string, timestamp: string, secret: string): string {
  return createHmac("sha256", Buffer.from(secret, "utf8")).update(Buffer.from(body + "-" + timestamp, "utf8")).digest("hex");
}

/** A webhook delivery signed as Thawani signs it: HMAC-SHA256(rawBody + "-" + timestamp). */
export function signDelivery(evt: unknown, secret: string, timestamp?: string | number): { body: string; headers: Record<string, string> } {
  const body = typeof evt === "string" ? evt : JSON.stringify(evt);
  const ts = String(timestamp ?? Math.floor(Date.now() / 1000));
  return {
    body,
    headers: { "content-type": "application/json", "thawani-timestamp": ts, "thawani-signature": sign(body, ts, secret) },
  };
}

/** checkout.completed for a session, as Thawani sends it once the money is in. */
export function completedEvent(s: Pick<ThawaniSession, "session_id" | "client_reference_id" | "invoice" | "total_amount" | "metadata" | "payment_status">, over: Record<string, unknown> = {}) {
  return {
    event_type: "checkout.completed",
    data: {
      session_id: s.session_id,
      client_reference_id: s.client_reference_id,
      invoice: s.invoice,
      payment_status: s.payment_status || "paid",
      total_amount: s.total_amount,
      metadata: s.metadata || {},
      ...over,
    },
  };
}

/** payment.succeeded / payment.failed for a charge. */
export function paymentEvent(p: ThawaniPayment, type: "payment.succeeded" | "payment.failed" = "payment.succeeded") {
  return {
    event_type: type,
    data: {
      payment_id: p.payment_id,
      invoice: p.checkout_invoice,
      checkout_invoice: p.checkout_invoice,
      status: p.status,
      amount: p.amount,
      fee: p.fee,
      masked_card: p.masked_card,
      card_type: p.card_type,
      refunded: !!p.refunded,
      reason: p.reason || null,
    },
  };
}

/** The installed emulator (installThawaniFake must have run on this world). */
export function thawaniFake(world: World): ThawaniFake {
  const e = world.emulators.thawani as ThawaniFake | undefined;
  if (!e) throw new Error("the Thawani emulator is not installed in this world");
  return e;
}

export function installThawaniFake(world: World): void {
  const state: ThawaniState = { sessions: [], payments: [], refunds: [], n: 0 };
  const rnd = (n: number, abc: string) => {
    let s = "";
    while (s.length < n) s += abc[Math.floor(world.random() * abc.length)];
    return s;
  };
  const ALNUM = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

  const sessionById = (sid: string) => state.sessions.filter((s) => s.session_id === sid)[0] || null;
  const sessionFor = (ref: string) => state.sessions.filter((s) => s.client_reference_id === ref).pop() || null;

  function paySession(sid: string, opts: PayOptions = {}) {
    const s = sessionById(sid);
    if (!s) throw new Error("no session " + sid);
    s.payment_status = opts.status || "paid";
    if (s.payment_status === "paid") s.hosted = "paid";
    const amount = opts.amount ?? Number(s.total_amount || 0);
    const payment: ThawaniPayment = {
      activity: "LUBAN & MUSK",
      payment_id: "pay_" + rnd(10, ALNUM),
      masked_card: opts.card || "XXXX XXXX XXXX 4242",
      card_type: opts.cardType || "debit",
      status: opts.payStatus || "successful",
      amount,
      fee: opts.fee ?? Math.round(amount * 0.02) + 100,
      refunded: false,
      refunds: [],
      payment_intent: null,
      checkout_invoice: s.invoice || null,
      created_at: iso(world.now()),
      reason: null,
      id: "cus_null",
      customer_client_id: null,
    };
    state.payments.push(payment);
    return { session: s, payment };
  }

  function cancel(sid: string) {
    const s = sessionById(sid);
    if (!s) throw new Error("no session " + sid);
    s.payment_status = "cancelled";
    s.hosted = "cancelled";
    return s;
  }

  function decline(sid: string, reason = "Card declined") {
    const s = sessionById(sid);
    if (!s) throw new Error("no session " + sid);
    const payment: ThawaniPayment = {
      payment_id: "pay_" + rnd(10, ALNUM), masked_card: "XXXX XXXX XXXX 0002", card_type: "credit", status: "failed",
      amount: Number(s.total_amount || 0), fee: 0, refunded: false, refunds: [], checkout_invoice: s.invoice || null,
      created_at: iso(world.now()), reason,
    };
    state.payments.push(payment);
    return payment;
  }

  function badSession(body: Record<string, unknown> | null): string | null {
    if (!body || typeof body !== "object") return "Improper data submitted";
    if (!body.client_reference_id) return "client_reference_id is required";
    if (body.mode !== "payment") return "mode must be payment";
    if (!body.success_url || !body.cancel_url) return "success_url and cancel_url are required";
    const products = body.products as ThawaniProduct[] | undefined;
    if (!Array.isArray(products) || !products.length) return "products are required";
    for (const p of products) {
      if (!p || typeof p.name !== "string" || !p.name) return "product name is required";
      if (p.name.length > 40) return "product name may not exceed 40 characters";
      if (!Number.isInteger(p.quantity) || p.quantity < 1) return "quantity must be a whole number of at least 1";
      if (!Number.isInteger(p.unit_amount) || p.unit_amount < 1) return "unit_amount must be a whole number of baisa";
    }
    const total = products.reduce((t, p) => t + p.unit_amount * p.quantity, 0);
    if (total < 100) return "the minimum amount is 100 baisa";
    return null;
  }

  function api(call: WorldCall, path: string): Response {
    if (!call.headers["thawani-api-key"]) return NO(401, 4001, "Unauthorized: thawani-api-key missing");
    const body = (call.body && typeof call.body === "object" ? call.body : null) as Record<string, unknown> | null;
    const url = new URL("https://x" + path);
    let m: RegExpExecArray | null;

    if (call.method === "POST" && url.pathname === "/checkout/session") {
      const bad = badSession(body);
      if (bad) return NO(400, 4000, bad);
      state.n++;
      const products = (body!.products as ThawaniProduct[]).map((p) => ({ ...p }));
      const t = world.now();
      const minutes = Number(body!.expire_in_minutes) > 0 ? Number(body!.expire_in_minutes) : 60;
      const s: FakeSession = {
        mode: "payment",
        session_id: "checkout_" + rnd(48, ALNUM),
        client_reference_id: String(body!.client_reference_id),
        customer_id: null,
        products,
        total_amount: products.reduce((x, p) => x + p.unit_amount * p.quantity, 0),
        currency: "OMR",
        success_url: String(body!.success_url),
        cancel_url: String(body!.cancel_url),
        return_url: null,
        payment_status: "unpaid",
        invoice: new Date(t).toISOString().slice(0, 10).replace(/-/g, "") + rnd(6, "0123456789"),
        save_card_on_success: false,
        metadata: (body!.metadata as Record<string, unknown>) || {},
        is_cvv_required: false,
        created_at: iso(t),
        expire_at: iso(t + minutes * 60e3),
        hosted: "open",
      };
      state.sessions.push(s);
      return OK(publicSession(s), 2004, "Session generated successfully");
    }
    if (call.method === "GET" && (m = /^\/checkout\/reference\/(.+)$/.exec(url.pathname))) {
      const s = sessionFor(decodeURIComponent(m[1]!));
      return s ? OK(publicSession(s)) : NO(404, 4004, "Session not found");
    }
    if (call.method === "GET" && (m = /^\/checkout\/session\/(.+)$/.exec(url.pathname))) {
      const s = sessionById(decodeURIComponent(m[1]!));
      return s ? OK(publicSession(s)) : NO(404, 4004, "Session not found");
    }
    if (call.method === "GET" && url.pathname === "/payments") {
      const inv = url.searchParams.get("checkout_invoice");
      const intent = url.searchParams.get("payment_intent");
      if (!inv && !intent) return NO(400, 4000, "Missing required parameter. Please include either a valid Checkout invoice or Payment intent.");
      const limit = Math.max(1, parseInt(url.searchParams.get("limit") || "10", 10) || 10);
      const skip = Math.max(0, parseInt(url.searchParams.get("skip") || "0", 10) || 0);
      const list = state.payments.filter((p) => (inv ? p.checkout_invoice === inv : p.payment_intent === intent));
      return OK(list.slice(skip, skip + limit).map((p) => clone(p)));
    }
    if (call.method === "GET" && (m = /^\/payments\/(.+)$/.exec(url.pathname))) {
      const p = state.payments.filter((x) => x.payment_id === decodeURIComponent(m![1]!))[0];
      return p ? OK(clone(p)) : NO(404, 4004, "Payment not found");
    }
    if (call.method === "POST" && url.pathname === "/refunds") {
      const pid = String((body && body.payment_id) || "");
      const reason = String((body && body.reason) || "").trim();
      if (!pid || !reason) return NO(400, 4000, "payment_id and reason are required");
      const p = state.payments.filter((x) => x.payment_id === pid)[0];
      if (!p) return NO(404, 4004, "Payment not found");
      if (String(p.status).toLowerCase() !== "successful") return NO(400, 4000, "Only a successful payment can be refunded");
      if (p.refunded) return NO(400, 4000, "Payment already refunded");
      const r: FakeRefund = {
        refund_id: "ref_" + (state.refunds.length + 1), payment_id: pid, status: "successful", amount: Number(p.amount || 0),
        reason, metadata: ((body && body.metadata) as Record<string, unknown>) || {}, created_at: iso(world.now()),
      };
      p.refunded = true;
      p.refunds = [...(p.refunds || []), { refund_id: r.refund_id, amount: r.amount, status: r.status, reason, created_at: r.created_at }];
      state.refunds.push(r);
      return OK(r, 2004, "Refund created successfully");
    }
    return NO(404, 4004, "no such route " + call.method + " " + path);
  }

  /** the dev pay page's controls (fake world only) */
  function control(call: WorldCall, path: string): Response {
    const m = /^\/__fake\/sessions\/([^/]+)(?:\/(pay|cancel))?$/.exec(path.split("?")[0]!);
    if (!m) return NO(404, 4004, "no such control route");
    const s = sessionById(decodeURIComponent(m[1]!));
    if (!s) return NO(404, 4004, "Session not found");
    if (call.method === "GET" && !m[2]) return json(200, { session: publicSession(s), hosted: s.hosted, expired: Date.parse(String(s.expire_at)) < world.now() });
    if (call.method === "POST" && m[2] === "pay") {
      if (s.hosted !== "open") return NO(409, 4009, "This session is " + s.hosted);
      const opts = (call.body && typeof call.body === "object" ? call.body : {}) as PayOptions;
      const r = paySession(s.session_id, opts);
      return json(200, { session: publicSession(r.session), payment: clone(r.payment) });
    }
    if (call.method === "POST" && m[2] === "cancel") return json(200, { session: publicSession(cancel(s.session_id)) });
    return NO(405, 4005, "method");
  }

  const emulator: ThawaniFake = {
    state,
    matches: (host) => /(^|\.)thawani\.om$/.test(host),
    handle(call) {
      const path = call.path;
      if (path.startsWith("/__fake/")) return control(call, path);
      if (path.startsWith("/api/v1/")) return api(call, path.slice("/api/v1".length));
      return NO(404, 4004, "no such route " + path);
    },
    sessionById,
    sessionFor,
    paySession,
    payByReference(ref, opts) {
      const s = sessionFor(ref);
      if (!s) throw new Error("no session for " + ref);
      return paySession(s.session_id, opts);
    },
    cancel,
    decline,
  };
  world.use("thawani", emulator);
}

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

function publicSession(s: FakeSession): ThawaniSession {
  const { hosted: _hosted, ...rest } = s;
  void _hosted;
  return clone(rest);
}
