/**
 * OPENING A PAYMENT PAGE — the card till (/api/pay/session) and the reminder link (/resume)
 * build a Thawani session the same way: the order's lines in baisa at the order's own rate,
 * delivery (and a cash fee, when an order carries one) as lines of their own, balanced so they
 * sum EXACTLY to the amount recorded on the order, back to the checkout in the shopper's
 * language either way.
 */
import { errorText } from "../../core/log";
import { toBaisa } from "../../../shared/money";
import type { Deps } from "../../core/deps";
import { fail } from "../../core/http";
import { ThawaniError, type ThawaniAnswer, type ThawaniProduct, type ThawaniSession } from "../../services/thawani";

/** Thawani's minimum charge, baisa. */
export const MIN_BAISA = 100;

/** Thawani caps product names at 40 characters. */
export function name40(s: unknown): string {
  const t = String(s == null ? "" : s).replace(/\s+/g, " ").trim();
  return t.length > 40 ? t.slice(0, 39) + "…" : t || "منتج";
}

const sumOf = (list: ThawaniProduct[]) => list.reduce((t, p) => t + p.unit_amount * p.quantity, 0);

/**
 * Make the lines sum to exactly `totalBaisa`. Per-line rounding drifts by a baisa or two;
 * the difference goes on the last line — on ONE unit split off when that line has several
 * (a negative correction line would be dropped and the shopper charged the higher sum, which
 * then fails the amount check: found on Bahraini baskets). A zero or negative line is
 * refused by Thawani, so it is dropped; if the lines still do not add up, one line that does.
 */
export function balance(products: ThawaniProduct[], totalBaisa: number): ThawaniProduct[] {
  let out = products.map((p) => ({ ...p }));
  const diff = totalBaisa - sumOf(out);
  if (diff !== 0 && out.length) {
    const last = out[out.length - 1]!;
    if (last.quantity === 1) last.unit_amount += diff;
    else {
      last.quantity -= 1;
      out.push({ name: last.name, quantity: 1, unit_amount: last.unit_amount + diff });
    }
  }
  out = out.filter((p) => p.unit_amount >= 1 && p.quantity >= 1);
  if (sumOf(out) !== totalBaisa) return [{ name: name40("طلب لبان ومسك"), quantity: 1, unit_amount: totalBaisa }];
  return out;
}

export interface LineLike {
  scent?: unknown;
  size?: unknown;
  qty?: unknown;
  price?: unknown;
}

/**
 * The session's lines: `lines` in the order's currency at `rate`, then delivery and the cash
 * fee when present, balanced to `totalBaisa`. The size is appended only when it is a real
 * size label (≤ 14 characters), not a set's long subtitle.
 */
export function productsFor(lines: LineLike[] | null | undefined, ship: unknown, codFee: unknown, rate: number, totalBaisa: number): ThawaniProduct[] {
  const products: ThawaniProduct[] = (lines || [])
    .map((i) => ({
      name: name40(i.size && String(i.size).length <= 14 ? String(i.scent ?? "") + " " + String(i.size) : i.scent),
      quantity: Math.max(1, parseInt(String(i.qty), 10) || 1),
      unit_amount: toBaisa((Number(i.price) || 0) * rate),
    }))
    .filter((p) => p.unit_amount > 0);
  if (Number(ship) > 0) products.push({ name: name40("التوصيل"), quantity: 1, unit_amount: toBaisa(Number(ship) * rate) });
  if (Number(codFee) > 0) products.push({ name: name40("رسوم الدفع عند الاستلام"), quantity: 1, unit_amount: toBaisa(Number(codFee) * rate) });
  return balance(products, totalBaisa);
}

/** Where Thawani sends the shopper back: the checkout in their language. */
export function returnUrls(origin: string, id: string, lang: "ar" | "en"): { success_url: string; cancel_url: string } {
  const page = lang === "en" ? "/en/checkout.html" : "/checkout.html";
  const base = origin.replace(/\/+$/, "");
  return {
    success_url: base + page + "?paid=" + encodeURIComponent(id),
    cancel_url: base + page + "?cancelled=" + encodeURIComponent(id),
  };
}

export interface OpenedSession {
  answer: ThawaniAnswer<ThawaniSession>;
  sessionId: string;
  invoice: string | null;
  expireAt: string | null;
}

/**
 * Open a session for order `id`. A gateway refusal or silence → 502 gateway_error (with
 * Thawani's code); an answer without a session id → 502 no_session.
 */
export async function openSession(
  deps: Deps,
  o: { id: string; products: ThawaniProduct[]; origin: string; lang: "ar" | "en"; metadata?: Record<string, unknown>; expireMinutes?: number },
): Promise<OpenedSession> {
  let answer: ThawaniAnswer<ThawaniSession>;
  try {
    answer = await deps.services.thawani.createSession({
      client_reference_id: o.id,
      mode: "payment",
      products: o.products,
      ...returnUrls(o.origin, o.id, o.lang),
      expire_in_minutes: o.expireMinutes || 60,
      metadata: { order_id: o.id, ...(o.metadata || {}) },
    });
  } catch (e) {
    await deps.log.error("pay-session", "Thawani refused the session for " + o.id + ": " + errorText(e), {
      orderId: o.id,
      detail: { code: e instanceof ThawaniError ? e.code : null, status: e instanceof ThawaniError ? e.status : null },
    });
    throw fail("gateway_error", 502, { code: e instanceof ThawaniError ? e.code : null });
  }
  const d = (answer && answer.data) || ({} as ThawaniSession);
  if (!d.session_id) {
    await deps.log.error("pay-session", "Thawani answered with no session id for " + o.id, { orderId: o.id });
    throw fail("no_session", 502);
  }
  return { answer, sessionId: d.session_id, invoice: d.invoice ? String(d.invoice) : null, expireAt: d.expire_at ? String(d.expire_at) : null };
}
