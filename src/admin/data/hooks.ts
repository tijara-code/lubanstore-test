/**
 * Reads more than one screen uses, each under one cache key so they are fetched once:
 *
 *   useOverview()          GET /overview — the KPIs, the warnings, the health (sidebar card too)
 *   useCatalogue()         GET /catalogue — the markets (names, dial codes, currencies, routes,
 *                          cash on delivery) for the order screens; the Catalogue tab owns edits
 *   useItemOptions(cc)     GET /orders/options?country= — what a market's basket line can carry
 *   useNewOrders()         how many orders are New (the Orders badge in the sidebar)
 *
 * After a write to orders call `afterOrderWrite()`: every order read on screen is read again.
 */
import type { Country } from "../../shared/catalogue/types";
import { getCatalogue, getOverview, itemOptions, listOrders } from "./endpoints";
import { invalidate, useQuery } from "./query";

export const KEYS = {
  overview: "overview",
  catalogue: "catalogue",
  options: (cc: string) => "options:" + cc,
  newOrders: "orders-badge",
  /** every orders read starts with this */
  orders: "orders",
  order: (id: string) => "orders:one:" + id,
};

export const useOverview = () => useQuery(KEYS.overview, () => getOverview());
export const useCatalogue = () => useQuery(KEYS.catalogue, () => getCatalogue());
export const useItemOptions = (country: string | null) => useQuery(country ? KEYS.options(country) : null, () => itemOptions(country!));

export function useNewOrders(): number | null {
  const q = useQuery(KEYS.newOrders, async () => {
    const a = await listOrders({ status: "new", limit: 1 });
    return "total" in a ? a.total : 0;
  });
  return q.data ?? null;
}

/** The orders reads (lists, one order, the badge) and the Overview, again. */
export function afterOrderWrite(): Promise<void> {
  return Promise.all([
    invalidate((k) => k.startsWith(KEYS.orders) || k === KEYS.newOrders || k === KEYS.overview || k.startsWith("overview:")),
  ]).then(() => undefined);
}

/** A market from the catalogue, by code. */
export function marketOf(countries: readonly Country[] | undefined, code: string | null | undefined): Country | undefined {
  return (countries || []).find((c) => c.code === String(code || "").toUpperCase());
}
