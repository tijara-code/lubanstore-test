/**
 * THE TILL — what both checkouts (cash: /api/order, card: /api/pay/session) do before an
 * order is written: price the basket from the live catalogue, then check the shelf for the
 * boxes the shop capped at it.
 *
 * A REFUSAL IS NOT A FAULT. The browser treats a 4xx as final (the shopper is told, nothing
 * is queued) and anything else as "keep it and send again". So only the catalogue's own
 * refusals are 400 (with the item, which the page names); a catalogue the database did not
 * give us, or a bug, is 503 pricing_unavailable — never the deploy's file priced in its
 * place when the database is there but did not answer.
 */
import { errorText } from "../core/log";
import type { Catalogue } from "../../shared/catalogue/types";
import { isRefusal, priceOrder, type Quote } from "../../shared/pricing/price";
import type { Deps } from "../core/deps";
import { fail, HttpError } from "../core/http";
import { CatalogueError, loadCatalogue } from "./catalogue";
import type { Intake } from "./intake";
import { enforceStock, readShelfForGate, type GateShelf } from "./stock";

export async function priceBasket(deps: Deps, intake: Intake, pay: "cod" | "card"): Promise<{ cfg: Catalogue; quote: Quote }> {
  let cfg: Catalogue;
  try {
    cfg = await loadCatalogue(deps, { live: true });
    return { cfg, quote: priceOrder(cfg, { countryCode: intake.countryCode, items: intake.items, pay }, deps.now()) };
  } catch (e) {
    if (isRefusal(e)) {
      const r = e as { code: string; item?: string | null };
      throw fail(r.code, 400, { item: r.item || null });
    }
    await deps.log.error("till-pricing", "pricing failed: " + errorText(e));
    throw fail(e instanceof CatalogueError && e.code === "no_catalogue" ? "no_catalogue" : "pricing_unavailable", 503);
  }
}

/**
 * The shelf, for the capped boxes: more than is left (less what other open orders hold) is
 * refused before anything is written — 409 stock_short { item, left }. Uncapped boxes are
 * never refused on the shelf's account, and a stock check that FAILS refuses nothing (it
 * is logged). The proposed id counts as this order's own only with its dedupe id (v314).
 * Call it with the deps `inStockTx` hands over so the read and the insert are one step.
 */
/**
 * Read the shelf for the gate BEFORE the till's transaction opens (it may ask Omniful), so the
 * lock is never held across a network call. null when the reading failed: the gate then
 * refuses nothing, as before.
 */
export async function readGate(deps: Deps, cfg: Catalogue, quote: Quote): Promise<GateShelf | null> {
  try {
    return await readShelfForGate(deps, cfg, quote.country.code, quote.items);
  } catch (e) {
    await deps.log.error("till-stock", "the shelf could not be read: " + errorText(e));
    return null;
  }
}

export async function gateStock(deps: Deps, cfg: Catalogue, quote: Quote, intake: Intake, pre?: GateShelf | null): Promise<void> {
  try {
    await enforceStock(
      deps,
      cfg,
      quote.country.code,
      quote.items,
      // a posted id is this order's own only with this submission's dedupe id (v314/A5): both
      // must be there and equal the row's (stock.ts isOwn) — an id alone excuses nothing
      intake.proposedId && intake.dedupeId ? { id: intake.proposedId, dedupeId: intake.dedupeId } : null,
      deps.db,
      pre,
    );
  } catch (e) {
    if (e instanceof HttpError && e.code === "stock_short") throw e;
    const s = e as { code?: string; item?: unknown; left?: unknown };
    if (s && s.code === "stock_short") throw fail("stock_short", 409, { item: s.item, left: s.left });
    await deps.log.error("till-stock", "the stock check failed: " + errorText(e));
  }
}
