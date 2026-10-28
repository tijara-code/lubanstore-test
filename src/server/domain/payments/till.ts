/**
 * POST /api/pay/session { order } → { ok, id, url, amount_baisa, amount_omr, session_id, invoice, expire_at }
 *
 * THE CARD TILL. The order is written as `pending` BEFORE the shopper leaves for Thawani: an
 * order that exists only in a redirect is an order you can lose. The charge is priced here
 * from the catalogue; the browser chooses items, quantities and country and supplies no
 * money at all.
 */
import { errorText } from "../../core/log";
import { eq } from "drizzle-orm";
import { baisaToOmr, toBaisa } from "../../../shared/money";
import type { Deps } from "../../core/deps";
import { HttpError } from "../../core/http";
import { allow } from "../../core/ratelimit";
import { orders, type NewOrderRow } from "../../db/schema";
import type { GatewayRecord } from "../../../shared/orders/types";
import { parseIntake } from "../intake";
import { anyCap, baseOrderRow, inStockTx, orderIdFrom, writeOrder } from "../orders";
import { gateStock, priceBasket, readGate } from "../till";
import { newInvoiceKey } from "./events";
import { MIN_BAISA, openSession, productsFor } from "./session";
import type { Answer } from "./verify";

export interface TillRequest {
  ip: string;
  ua: string;
  /** the site's origin for the return URLs (and, in fake mode, the dev pay page) */
  origin: string;
}

export async function cardTill(deps: Deps, body: Record<string, unknown>, req: TillRequest): Promise<Answer> {
  const th = deps.services.thawani;
  if (!th.configured()) return { status: 503, body: { ok: false, error: "gateway_not_configured" } };

  const o = body.order && typeof body.order === "object" && !Array.isArray(body.order) ? body.order : {};
  const parsed = parseIntake(o);
  if ("refusal" in parsed) return { status: 400, body: { ok: false, ...parsed.refusal } };
  const intake = parsed.intake;

  // each call opens a gateway session: ten in ten minutes from one address is enough
  const rl = await allow(deps.db, "paySession", req.ip, deps.now());
  if (!rl.ok) return { status: 429, body: { ok: false, error: "rate_limited" }, headers: { "Retry-After": String(rl.retryAfter || 60) } };

  // card pays no cash-handling fee; refusals are 4xx, faults 503 (the page retries)
  const { cfg, quote } = await priceBasket(deps, intake, "card");
  const totalBaisa = toBaisa(quote.omr);
  if (totalBaisa < MIN_BAISA) return { status: 400, body: { ok: false, error: "amount_too_small" } };
  const products = productsFor(quote.items, quote.ship, quote.codFee, quote.omrRate, totalBaisa);

  // --- record the attempt first: the shelf's gate and the insert as one step (the shelf is
  //     read before the lock: no Omniful call while it is held) ---
  const shelf = anyCap(cfg) ? await readGate(deps, cfg, quote) : null;
  let wrote;
  try {
    wrote = await inStockTx(deps, anyCap(cfg), async (tx) => {
      await gateStock(tx, cfg, quote, intake, shelf);
      const row: NewOrderRow = {
        // the shopper's IP, browser, page and click ids ride in `client` for the Purchase the
        // return or the webhook reports later, with no browser present
        ...baseOrderRow(tx, orderIdFrom(intake.proposedId, deps.now()), intake, quote, { ip: req.ip, ua: req.ua }),
        pay: "card",
        status: "pending",
        paymentStatus: "unpaid",
        invoiceKey: newInvoiceKey(),
        omr: baisaToOmr(totalBaisa),
        amountBaisa: totalBaisa,
      };
      return writeOrder(tx, row, { detail: { amountBaisa: totalBaisa } });
    });
  } catch (e) {
    if (e instanceof HttpError) throw e;
    await deps.log.error("pay-session", "the card order could not be written: " + errorText(e), { path: "/api/pay/session" });
    return { status: 502, body: { ok: false, error: "db_write_failed" } };
  }
  // the same submission twice: never a second session against a row this request did not write
  if (!wrote.fresh) return { status: 409, body: { ok: false, error: "duplicate_submit", id: wrote.id } };

  // --- the session, for the id the row really has; a failure leaves it pending, on record ---
  const opened = await openSession(deps, {
    id: wrote.id, products, origin: req.origin, lang: intake.lang,
    metadata: { customer: intake.name, phone: intake.phone, country: intake.countryCode, city: intake.city },
  });

  // the whole answer is kept: derived columns are lossy, the raw payload is what you reconcile against
  const expireAt = opened.expireAt && Number.isFinite(Date.parse(opened.expireAt)) ? new Date(opened.expireAt) : null;
  try {
    await deps.db
      .update(orders)
      .set({
        sessionId: opened.sessionId,
        invoiceNo: opened.invoice,
        expireAt,
        updatedAt: new Date(deps.now()),
        gateway: {
          ...((wrote.order.gateway || {}) as GatewayRecord),
          mode: th.mode(),
          created_at: new Date(deps.now()).toISOString(),
          session: opened.answer,
        },
      })
      .where(eq(orders.id, wrote.id));
  } catch (e) {
    // the reference lookup still finds it by order id — the webhook's invoice lookups cannot
    await deps.log.error("pay-session", "the session was opened but not recorded on " + wrote.id + ": " + errorText(e), { orderId: wrote.id });
  }

  return {
    status: 200,
    body: {
      ok: true,
      id: wrote.id,
      url: th.payUrl(opened.sessionId, req.origin),
      amount_baisa: totalBaisa,
      amount_omr: baisaToOmr(totalBaisa),
      session_id: opened.sessionId,
      invoice: opened.invoice,
      expire_at: opened.expireAt,
    },
  };
}
