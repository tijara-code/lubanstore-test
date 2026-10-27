/**
 * HEALTH — is the shop's machinery answering, in one read (port of the original health.js).
 *
 * Two readers. The public /api/health says only what a status page needs: up or down, the
 * build, which jobs are late, and HOW MANY warnings — not which ones (a code like
 * thawani_uat_in_production is a hint to an attacker), not the database's error text. The
 * admin's health view (`fullHealth`) adds the codes and which integrations are wired up —
 * booleans, never a value or a prefix.
 *
 * A job's record is the ops row runJob writes on every run (`job:<name>`); "stale" means more
 * than two of its periods have passed since (or it never ran). A job that skipped because
 * its service is not configured is not stale.
 */
import { sql } from "drizzle-orm";
import { RELEASE } from "../app";
import type { Deps } from "../core/deps";
import { ops } from "../db/schema";
import { JOBS } from "../jobs";
import { inArray } from "drizzle-orm";

export interface JobHealth {
  at: string | null;
  agoMin: number | null;
  everyMin: number;
  stale: boolean;
  ok: boolean;
  skipped: string | null;
}

export interface HealthStatus {
  ok: boolean;
  release: string;
  at: string;
  db: { ok: boolean; ms: number | null; error: string | null };
  jobs: Record<string, JobHealth>;
  staleJobs: string[];
  warnings: string[];
}

const has = (v: unknown) => !!String(v ?? "").trim();

export function thawaniConfigured(env: Deps["env"]): boolean {
  return has(env.THAWANI_SECRET_KEY) && has(env.THAWANI_PUBLISHABLE_KEY);
}

/** the warnings, by code — the panel translates them */
export function warnings(env: Deps["env"]): string[] {
  const out: string[] = [];
  const th = thawaniConfigured(env);
  if (env.production && th && env.THAWANI_MODE !== "live") out.push("thawani_uat_in_production");
  if (!has(env.OMNIFUL_HOOK_SECRET)) out.push("omniful_hook_unsigned");
  if (th && !has(env.THAWANI_WEBHOOK_SECRET)) out.push("thawani_webhook_secret_missing");
  if (!has(env.ADMIN_PASSWORD) && !has(env.ADMIN_PASSWORD_HASH)) out.push("admin_password_missing");
  if (!has(env.ADMIN_USER)) out.push("admin_user_missing");
  if (String(env.SESSION_SECRET || "").length < 32) out.push("session_secret_missing");
  if (env.production && !env.siteUrl) out.push("site_url_missing");
  if (env.production && env.servicesMode !== "live") out.push("fake_services_in_production");
  return out;
}

export async function jobsHealth(deps: Pick<Deps, "db" | "now">): Promise<Record<string, JobHealth>> {
  const names = Object.keys(JOBS).sort();
  const out: Record<string, JobHealth> = {};
  if (!names.length) return out;
  const rows = await deps.db.select().from(ops).where(inArray(ops.key, names.map((n) => "job:" + n)));
  const byKey = new Map(rows.map((r) => [r.key, r]));
  const now = deps.now();
  for (const name of names) {
    const r = byKey.get("job:" + name);
    const d = (r && r.data && typeof r.data === "object" ? r.data : null) as Record<string, unknown> | null;
    const t = d && typeof d.at === "string" ? Date.parse(d.at) : r ? r.updatedAt.getTime() : NaN;
    const ago = Number.isFinite(t) ? Math.round((now - t) / 60e3) : null;
    const everyMin = JOBS[name]!.everyMin;
    const skipped = d && d.skipped ? String(d.skipped) : null;
    out[name] = {
      at: Number.isFinite(t) ? new Date(t).toISOString() : null,
      agoMin: ago,
      everyMin,
      stale: skipped && /not_configured/.test(skipped) ? false : ago == null || ago > 2 * everyMin,
      ok: !!(d && !d.error),
      skipped,
    };
  }
  return out;
}

/** The whole picture (the admin's base). */
export async function healthStatus(deps: Pick<Deps, "db" | "now" | "env">): Promise<HealthStatus> {
  const began = deps.now();
  const t0 = performance.now();
  let dbOk = false;
  let dbMs: number | null = null;
  let dbError: string | null = null;
  try {
    await deps.db.execute(sql`select 1`);
    dbOk = true;
  } catch (e) {
    dbError = String((e as Error)?.message || e).slice(0, 200);
  }
  dbMs = Math.round(performance.now() - t0);
  let jobs: Record<string, JobHealth> = {};
  if (dbOk) {
    try {
      jobs = await jobsHealth(deps);
    } catch {
      jobs = {};
    }
  }
  const staleJobs = Object.keys(jobs).filter((k) => jobs[k]!.stale);
  return {
    ok: dbOk && !staleJobs.length,
    release: RELEASE,
    at: new Date(began).toISOString(),
    db: { ok: dbOk, ms: dbMs, error: dbError },
    jobs,
    staleJobs,
    warnings: warnings(deps.env),
  };
}

/** The admin's picture: the status plus which integrations are wired up (booleans only). */
export async function fullHealth(deps: Pick<Deps, "db" | "now" | "env">) {
  const s = await healthStatus(deps);
  const e = deps.env;
  return {
    ...s,
    gateway: { configured: thawaniConfigured(e), mode: e.THAWANI_MODE || "uat", webhook: has(e.THAWANI_WEBHOOK_SECRET) },
    fulfilment: {
      configured: has(e.OMNIFUL_API_TOKEN) || (has(e.OMNIFUL_CLIENT_ID) && has(e.OMNIFUL_CLIENT_SECRET)),
      hub: has(e.OMNIFUL_HUB_CODE),
      hook: has(e.OMNIFUL_HOOK_SECRET),
    },
    pixels: {
      meta: { pixel: has(e.META_PIXEL_ID), capi: has(e.META_PIXEL_ID) && has(e.META_CAPI_TOKEN), testCode: has(e.META_TEST_EVENT_CODE) },
      snap: { pixel: has(e.SNAP_PIXEL_ID), capi: has(e.SNAP_PIXEL_ID) && has(e.SNAP_CAPI_TOKEN) },
      ga4: { id: has(e.GA4_MEASUREMENT_ID), mp: has(e.GA4_MEASUREMENT_ID) && has(e.GA4_API_SECRET) },
    },
    admin: { user: has(e.ADMIN_USER), password: has(e.ADMIN_PASSWORD) || has(e.ADMIN_PASSWORD_HASH), session: String(e.SESSION_SECRET || "").length >= 32 },
    deploy: { context: e.CONTEXT || "unknown", services: e.servicesMode, production: e.production },
  };
}

/** WHAT A STRANGER MAY SEE: up or down, the build, which jobs are late, how many warnings. */
export function publicView(s: HealthStatus) {
  const jobs: Record<string, { stale: boolean; agoMin: number | null }> = {};
  for (const k of Object.keys(s.jobs || {})) jobs[k] = { stale: !!s.jobs[k]!.stale, agoMin: s.jobs[k]!.agoMin };
  return {
    ok: !!s.ok,
    release: s.release,
    at: s.at,
    db: { ok: !!s.db.ok, ms: s.db.ms },
    jobs,
    staleJobs: s.staleJobs || [],
    warnings: (s.warnings || []).length,
  };
}
