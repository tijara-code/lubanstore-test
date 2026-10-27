/**
 * (STUB — owned by the Empower area.) The shelf: Omniful's available quantities, the
 * shop's per-box caps and hide-at-0 switches, and the till's stock gate.
 */
import type { Catalogue } from "../../shared/catalogue/types";
import type { QuoteLine } from "../../shared/pricing/price";
import type { Deps } from "../core/deps";

/**
 * Refuse a basket that asks for more of a capped box than is left (less what other open
 * orders hold). Throws HttpError("stock_short", 409, { item, left }). An unreadable shelf
 * refuses nothing. `except`: this same submission arriving again (same id AND dedupe id).
 */
export async function enforceStock(
  deps: Deps,
  cfg: Catalogue,
  countryCode: string,
  lines: QuoteLine[],
  except?: { id: string; dedupeId: string | null } | null,
): Promise<void> {
  void deps; void cfg; void countryCode; void lines; void except;
}
