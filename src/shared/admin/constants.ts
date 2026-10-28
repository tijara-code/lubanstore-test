/**
 * THE ADMIN API'S CONSTANTS — the values the panel needs in the browser (the API's prefix, the
 * CSRF header, the cookie's name, the pages Settings can hide), kept apart from the zod schemas
 * (./schemas) so the admin bundle does not carry zod. `./api` re-exports everything here, so the
 * server keeps importing from one place; the SPA imports values from this file and types from
 * `./api` (`import type`, erased at build).
 */

export const API = "/api/admin";
/** the header a cross-site form cannot send */
export const CSRF_HEADER = "X-LM-Admin";
export const SESSION_COOKIE = "lm_admin";
export const SESSION_HOURS = 12;

/* ---------------- the panel's pages ---------------- */

/** the pages that may be hidden in Settings (Overview never is) */
export const ADMIN_PAGES = ["orders", "payments", "catalogue", "empower", "customers", "analytics"] as const;
export type AdminPage = (typeof ADMIN_PAGES)[number];
/** the original panel's names for the same pages (a saved list in the old words still reads) */
export const PAGE_ALIASES: Record<string, AdminPage> = {
  pay: "payments", products: "catalogue", omniful: "empower", crm: "customers", stats: "analytics",
};
