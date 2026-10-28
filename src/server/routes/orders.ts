/**
 * POST /api/order   { order }   →   { ok: true, id, omr, ga4 }
 *
 * THE CASH TILL. Card orders go through /api/pay/session; anything posted here is collected
 * by the courier (pay "cod", payment_status "cod", status "new").
 *
 * THE STATUS IS THE CONTRACT with checkout.js and store.js: 2xx is accepted; a 4xx with an
 * error is a refusal the shopper is shown; anything else is kept in the browser and sent
 * again. So: refusals 400 (incomplete, bad_qty, too_many, unknown_item, the catalogue's own
 * codes with `item`), 409 stock_short { item, left }, 403/415 for a post that is not this
 * site's JSON, 429 rate_limited with Retry-After (ten orders in ten minutes from one
 * address is a flood, not a shopper), and our own faults 5xx (503 pricing_unavailable,
 * 502 upstream — never the database's words in the body; the detail goes to `logs`).
 */
import { errorText } from "../core/log";
import type { Hono } from "hono";
import type { AppEnv } from "../core/deps";
import { clientIp, fail, HttpError, readJson, sameSiteJson } from "../core/http";
import { allow } from "../core/ratelimit";
import type { NewOrderRow, OrderRow } from "../db/schema";
import { parseIntake } from "../domain/intake";
import { anyCap, baseOrderRow, inStockTx, newInvoiceKey, orderIdFrom, writeOrder } from "../domain/orders";
import { reportPurchase } from "../domain/purchase";
import { gateStock, priceBasket, readGate } from "../domain/till";

/** The database's own words for a failed write — never the query or its parameters (core/log.ts errorText). */
export const dbErrorText = errorText;

export function registerOrderRoutes(app: Hono<AppEnv>): void {
  app.post("/api/order", async (c) => {
    const deps = c.get("deps");
    sameSiteJson(c);
    const body = await readJson(c);
    const parsed = parseIntake(body.order && typeof body.order === "object" ? body.order : body);
    if ("refusal" in parsed) return c.json({ ok: false, ...parsed.refusal }, 400);
    const inn = parsed.intake;

    const ip = clientIp(c);
    const rl = await allow(deps.db, "order", ip, deps.now());
    if (!rl.ok) throw fail("rate_limited", 429, {}, { "Retry-After": String(rl.retryAfter || 60) });

    const { cfg, quote } = await priceBasket(deps, inn, "cod");
    const ua = String(c.req.header("user-agent") || "");

    const shelf = anyCap(cfg) ? await readGate(deps, cfg, quote) : null;

    let wrote: { id: string; fresh: boolean; order: OrderRow };
    try {
      wrote = await inStockTx(deps, anyCap(cfg), async (tx) => {
        await gateStock(tx, cfg, quote, inn, shelf);
        const row: NewOrderRow = {
          ...baseOrderRow(tx, orderIdFrom(inn.proposedId, deps.now()), inn, quote, { ip, ua }),
          pay: "cod",
          status: "new",
          paymentStatus: "cod",
          invoiceKey: newInvoiceKey(),
        };
        return writeOrder(tx, row);
      });
    } catch (e) {
      if (e instanceof HttpError) throw e;
      await deps.log.error("order", "the order could not be written: " + dbErrorText(e), { path: "/api/order" });
      return c.json({ ok: false, error: "upstream" }, 502);
    }
    const order = wrote.order;
    // The same submission again: already recorded, and already reported to the ad platforms.
    if (!wrote.fresh) return c.json({ ok: true, id: order.id, already: true, omr: order.omr });

    // PURCHASE, server-side: the event id is the order id (the pixel sends the same, so the
    // pair collapses into one conversion); the value is the catalogue quote, never the browser's.
    let ga4: "server" | "page" = deps.env.GA4_MEASUREMENT_ID && deps.env.GA4_API_SECRET ? "server" : "page";
    try {
      ga4 = (await reportPurchase(deps, order, { ip, ua, url: inn.pageUrl || undefined })).ga4;
    } catch (e) {
      await deps.log.error("order-purchase", "the Purchase report failed: " + errorText(e), { orderId: order.id });
    }
    return c.json({ ok: true, id: order.id, omr: order.omr, ga4 });
  });

  app.all("/api/order", (c) => c.json({ ok: false, error: "method" }, 405));
}
