/**
 * THE ORDERS TAB'S FILTERS, kept in the address (#orders?q=…&status=new,flagged&page=2) so a
 * reload or a link keeps them, and turned into the API's query (GET /orders).
 *
 *   q        search: order number, name, phone (any digits), email, city, area, tracking
 *   status   our statuses, comma separated, plus "flagged" (the last tick, v408)
 *   payment  the payment state (paid, unpaid, cod, cancelled, refunded)
 *   country  a market code
 *   range    a preset ("7", "30", "today" …) or from/to (Muscat days)
 *   trash    "1": the bin instead of the working list
 *   page     1-based; any other change goes back to page 1
 */
import type { OrdersFilter } from "../../data/endpoints";
import { resolveRange, type Range } from "../../kit/pickers";

export const PER_PAGE = 20;

export interface Filters {
  q: string;
  status: string[];
  payment: string;
  country: string;
  range: Range;
  trash: boolean;
  page: number;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export function filtersOf(p: Record<string, string>): Filters {
  const pre = p.range || "";
  const from = DAY.test(p.from || "") ? p.from! : "";
  const to = DAY.test(p.to || "") ? p.to! : "";
  return {
    q: p.q || "",
    status: (p.status || "").split(",").map((s) => s.trim()).filter(Boolean),
    payment: p.payment || "",
    country: /^[A-Z]{2}$/.test(p.country || "") ? p.country! : "",
    range: pre ? { pre, from: "", to: "" } : from || to ? { pre: "", from, to } : { pre: "all", from: "", to: "" },
    trash: p.trash === "1",
    page: Math.max(1, parseInt(p.page || "1", 10) || 1),
  };
}

export function paramsOf(f: Filters): Record<string, string | undefined> {
  return {
    q: f.q || undefined,
    status: f.status.length ? f.status.join(",") : undefined,
    payment: f.payment || undefined,
    country: f.country || undefined,
    range: f.range.pre && f.range.pre !== "all" ? f.range.pre : undefined,
    from: !f.range.pre && f.range.from ? f.range.from : undefined,
    to: !f.range.pre && f.range.to ? f.range.to : undefined,
    trash: f.trash ? "1" : undefined,
    page: f.page > 1 ? String(f.page) : undefined,
  };
}

/** The API's query for these filters (the list's page included unless `all`). */
export function queryOf(f: Filters, now: number, all = false): OrdersFilter {
  const r = resolveRange(f.range, now);
  const statuses = f.status.filter((s) => s !== "flagged");
  const q: OrdersFilter = {
    q: f.q.trim() || undefined,
    status: statuses.length ? statuses.join(",") : undefined,
    flagged: f.status.indexOf("flagged") > -1 ? "1" : undefined,
    payment: (f.payment || undefined) as OrdersFilter["payment"],
    country: f.country || undefined,
    from: r.from || undefined,
    to: r.to || undefined,
    trash: f.trash ? "1" : undefined,
  };
  if (!all) {
    q.limit = PER_PAGE;
    q.offset = (f.page - 1) * PER_PAGE;
  }
  return q;
}

/** A stable key for a query (the cache key, and "is this still the same list"). */
export function keyOf(q: OrdersFilter): string {
  const keys = Object.keys(q).sort();
  return "orders:list?" + keys.filter((k) => (q as Record<string, unknown>)[k] !== undefined).map((k) => k + "=" + String((q as Record<string, unknown>)[k])).join("&");
}

export function filtered(f: Filters): boolean {
  return !!(f.q || f.status.length || f.payment || f.country || (f.range.pre && f.range.pre !== "all") || f.range.from || f.range.to);
}
