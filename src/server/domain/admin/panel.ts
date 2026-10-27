/**
 * THE PANEL ITSELF — its settings (pages hidden, Overview warnings dismissed), shared by every
 * admin and every browser and kept server-side in `ops` (`admin_ui`), and the Overview: the
 * all-time order figures (shared/kpi over every order not binned) and the warnings.
 *
 * Settings (v211, v411): only what a save carries changes; the rest stays. Overview can never
 * be hidden; unknown page names are dropped; the original panel's names (stats, pay, …) are
 * read as the new pages. Dismissed codes are kept only when well formed ("warn:…",
 * "stale:…"), at most 200. A dismissed warning never comes back; a new one shows on its own.
 * A missing key (…_missing) cannot be dismissed: it is not a notice, something is broken.
 */
import { asc, eq } from "drizzle-orm";
import { ADMIN_PAGES, PAGE_ALIASES, WARNING_CODE_RE, type AdminPage, type OrdersSummary, type Warning } from "../../../shared/admin/api";
import * as KPI from "../../../shared/kpi";
import type { Deps } from "../../core/deps";
import { getOpData, updateOp } from "../../core/ops";
import { orders } from "../../db/schema";
import { healthStatus } from "../health";
import { trackingHealth } from "../pixels/health";

export const UI_KEY = "admin_ui";

interface UiRow {
  hidden?: unknown;
  dismissed?: unknown;
}

export function hiddenOf(v: unknown): AdminPage[] {
  const want = (Array.isArray(v) ? v : []).map((x) => {
    const s = String(x).trim().toLowerCase();
    return PAGE_ALIASES[s] || s;
  });
  return ADMIN_PAGES.filter((p) => want.indexOf(p) > -1);
}

export function dismissedOf(v: unknown): string[] {
  const out: string[] = [];
  for (const x of Array.isArray(v) ? v : []) {
    const c = String(x);
    if (WARNING_CODE_RE.test(c) && out.indexOf(c) < 0) out.push(c);
    if (out.length >= 200) break;
  }
  return out;
}

export async function getUi(deps: Deps) {
  const row = await getOpData<UiRow>(deps.db, UI_KEY, {});
  const ui = row && typeof row === "object" ? row : {};
  return { ok: true as const, ui: { hidden: hiddenOf(ui.hidden) }, dismissed: dismissedOf(ui.dismissed) };
}

export async function saveUi(deps: Deps, body: { hidden?: string[]; dismissed?: string[] }) {
  const next = await updateOp<UiRow>(
    deps.db,
    UI_KEY,
    {},
    (was) => ({
      hidden: body.hidden !== undefined ? hiddenOf(body.hidden) : hiddenOf(was && was.hidden),
      dismissed: body.dismissed !== undefined ? dismissedOf(body.dismissed) : dismissedOf(was && was.dismissed),
    }),
    new Date(deps.now()),
  );
  return { ok: true as const, ui: { hidden: hiddenOf(next.hidden) }, dismissed: dismissedOf(next.dismissed) };
}

/* ---------------- the Overview ---------------- */

/** All time, the last seven Muscat days, the seven before, the delta, 30 days by day (v332). */
export async function ordersSummary(deps: Deps): Promise<OrdersSummary> {
  const rows = await deps.db
    .select({
      id: orders.id,
      createdAt: orders.createdAt,
      status: orders.status,
      pay: orders.pay,
      paymentStatus: orders.paymentStatus,
      refunded: orders.refunded,
      trashed: orders.trashed,
      omr: orders.omr,
      gatewayFee: orders.gatewayFee,
      phone: orders.phone,
      phoneKey: orders.phoneKey,
      countryCode: orders.countryCode,
      origin: orders.origin,
    })
    .from(orders)
    .where(eq(orders.trashed, false))
    .orderBy(asc(orders.createdAt))
    .limit(100_000);
  // the CRM key is the international digits: prefer it over the typed phone
  const list = rows.map((r) => ({ ...r, phone: r.phoneKey || r.phone }));
  const o = KPI.overview(list, deps.now());
  return { n: rows.length, ...o };
}

const UNDISMISSABLE = /_missing$|^fake_services_in_production$|^thawani_uat_in_production$/;

/** Every current warning, coded: warn:<w> for a setting, stale:<job> for a late job. */
export async function currentWarnings(deps: Deps): Promise<{ warnings: Warning[]; health: Awaited<ReturnType<typeof healthStatus>> }> {
  const h = await healthStatus(deps);
  let px: string[] = [];
  try {
    px = (await trackingHealth(deps)).warnings;
  } catch {
    px = [];
  }
  const warnings: Warning[] = [];
  for (const w of [...h.warnings, ...px]) {
    warnings.push({ code: "warn:" + w, kind: "warn", what: w, dismissible: !UNDISMISSABLE.test(w) });
  }
  for (const j of h.staleJobs) warnings.push({ code: "stale:" + j, kind: "stale", what: j, dismissible: true });
  return { warnings, health: h };
}

export async function overview(deps: Deps) {
  const [summary, current, ui] = await Promise.all([ordersSummary(deps), currentWarnings(deps), getUi(deps)]);
  const gone = new Set(ui.dismissed);
  const shown = current.warnings.filter((w) => !(w.dismissible && gone.has(w.code)));
  const h = current.health;
  return {
    ok: true as const,
    orders: summary,
    warnings: shown,
    dismissedN: current.warnings.length - shown.length,
    health: { ok: h.ok, db: { ok: h.db.ok, ms: h.db.ms }, staleJobs: h.staleJobs, release: h.release },
  };
}
