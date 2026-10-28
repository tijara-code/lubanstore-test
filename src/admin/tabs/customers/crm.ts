/**
 * THE CUSTOMERS TAB'S RULES — pure functions over GET /customers (orders added up per person by
 * the phone key, server-side; notes and tags from the CRM table).
 *
 * The spend band is the original's (test-customers): on LIFETIME spend in OMR (three visits of
 * nine rials is a better customer than one of nine), High from 26, Medium from 10, Normal below.
 * Normal is the default and carries no pill (the brief): only a band that says something shows.
 */
import type { CustomerRow } from "../../../shared/admin/api";

export interface Band {
  id: "high" | "mid" | "low";
  from: number;
  label: string;
}
export const BANDS: Band[] = [
  { id: "high", from: 26, label: "High" },
  { id: "mid", from: 10, label: "Medium" },
  { id: "low", from: 0, label: "Normal" },
];

export function bandOf(spend: unknown): Band {
  const v = Number(spend) || 0;
  for (const b of BANDS) if (v >= b.from) return b;
  return BANDS[BANDS.length - 1]!;
}

export type CrmSort = "last" | "spend" | "orders" | "first" | "name";
export const SORTS: Array<{ value: CrmSort; label: string }> = [
  { value: "last", label: "Latest order" },
  { value: "spend", label: "Most spent" },
  { value: "orders", label: "Most orders" },
  { value: "first", label: "First order" },
  { value: "name", label: "Name" },
];

export interface CrmFilters {
  q: string;
  band: string;
  country: string;
  sort: CrmSort;
}

/** "+968 9123 4567" → "96891234567" (Arabic digits read too) */
export const digitsOf = (s: unknown) => String(s || "").replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x0660)).replace(/\D/g, "");

export function crmRows(all: readonly CustomerRow[], f: CrmFilters): CustomerRow[] {
  const q = f.q.trim().toLowerCase();
  const qd = digitsOf(q).replace(/^0+/, "");
  const out = all.filter((c) => {
    if (f.band && bandOf(c.spend).id !== f.band) return false;
    if (f.country && c.countries.indexOf(f.country) < 0) return false;
    if (!q) return true;
    if (qd.length >= 3 && (c.phoneKey.indexOf(qd) > -1 || digitsOf(c.phone).indexOf(qd) > -1)) return true;
    return [c.name, c.phone, c.note, c.tags.join(" ")].join(" ").toLowerCase().indexOf(q) > -1;
  });
  const by: Record<CrmSort, (a: CustomerRow, b: CustomerRow) => number> = {
    last: (a, b) => (a.last < b.last ? 1 : a.last > b.last ? -1 : 0),
    first: (a, b) => (a.first < b.first ? -1 : a.first > b.first ? 1 : 0),
    spend: (a, b) => b.spend - a.spend || b.live - a.live,
    orders: (a, b) => b.live - a.live || b.orders - a.orders || b.spend - a.spend,
    name: (a, b) => String(a.name || "").localeCompare(String(b.name || ""), "ar"),
  };
  return out.sort(by[f.sort] || by.last);
}

/** The countries the list holds (the filter's options come from the list, as the original). */
export function crmCountries(all: readonly CustomerRow[]): string[] {
  const seen = new Set<string>();
  for (const c of all) for (const k of c.countries) if (k) seen.add(k);
  return [...seen].sort();
}

/** Tags typed as "vip, wholesale" → ["vip", "wholesale"] (lower case, no repeats, 20 at most, 40 characters each). */
export function tagsOf(text: string): string[] {
  return [...new Set(text.split(/[,،\n]/).map((t) => t.trim().toLowerCase().slice(0, 40)).filter(Boolean))].slice(0, 20);
}

export const CRM_CSV_HEAD = ["Name", "Phone", "Country", "Orders", "Live orders", "Spend OMR", "Band", "First order", "Last order", "Note", "Tags"];
export function crmCsv(rows: readonly CustomerRow[]): Array<Array<string | number>> {
  return [CRM_CSV_HEAD, ...rows.map((c) => [c.name || "", c.phone || "", c.countries.join(" "), c.orders, c.live, c.spend, bandOf(c.spend).label, c.first, c.last, c.note, c.tags.join(", ")])];
}
