/**
 * Configuration, read from the environment once and typed. Every variable is listed in
 * .env.example and docs/ENV.md (a test fails if code reads one that is not documented).
 * Nothing here is ever sent to a browser except the public pixel ids and the GA4 id.
 */
import { createHash } from "node:crypto";
import { z } from "zod";

const opt = z.string().trim().optional().transform((v) => (v ? v : undefined));
/**
 * An enum read forgivingly: trimmed and lower-cased ("live " is live), empty = unset, and a
 * value that is none of the choices is UNSET too (the default applies) rather than refused —
 * a typo in one variable must never take the whole API down at start. The names of such
 * variables are collected in `ignored` (loadEnv → env.ignored; the health check reports them).
 */
const ignoredNow: string[] = [];
const oneOf = <T extends readonly [string, ...string[]]>(values: T, name: string) =>
  z.preprocess((v) => {
    if (typeof v !== "string") return v;
    const t = v.trim().toLowerCase();
    if (!t) return undefined;
    if ((values as readonly string[]).includes(t)) return t;
    ignoredNow.push(name);
    return undefined;
  }, z.enum(values).optional());

export const EnvSchema = z.object({
  /**
   * live = the real services; fake = in-process fakes (local dev, e2e, tests). Default: LIVE —
   * fake only when set explicitly, and refused in production (see `production`).
   */
  SERVICES_MODE: oneOf(["live", "fake"] as const, "SERVICES_MODE"),
  /** Netlify deploy context (production, deploy-preview, branch-deploy, dev) — a BUILD variable; functions may not see it */
  CONTEXT: opt,
  /** set by Netlify for functions at runtime: its presence means "running on Netlify" */
  SITE_ID: opt,
  NODE_ENV: opt,
  /** The site's public origin, e.g. https://lubanmusk.com (return URLs, own-host attribution) */
  SITE_URL: opt,
  URL: opt,

  /** postgres://… (Supabase transaction pooler). Absent: PGlite at DATA_DIR (local dev). */
  DATABASE_URL: opt,
  DATA_DIR: opt,

  ADMIN_USER: opt,
  /** scrypt hash made by `npm run admin:hash` (preferred) … */
  ADMIN_PASSWORD_HASH: opt,
  /** … or the plain password (development) */
  ADMIN_PASSWORD: opt,
  /** signs admin session cookies; at least 32 characters (derived from the admin password when absent) */
  SESSION_SECRET: opt,
  /** "off" skips the first-run database setup at start (see db/setup.ts) */
  LM_AUTO_SETUP: opt,

  /** uat | live. The original's value "test" (its .env.example) is accepted as uat. */
  THAWANI_MODE: z.preprocess((v) => (typeof v === "string" && v.trim().toLowerCase() === "test" ? "uat" : v), oneOf(["uat", "live"] as const, "THAWANI_MODE")),
  THAWANI_SECRET_KEY: opt,
  THAWANI_PUBLISHABLE_KEY: opt,
  THAWANI_WEBHOOK_SECRET: opt,

  OMNIFUL_API_TOKEN: opt,
  OMNIFUL_REFRESH_TOKEN: opt,
  OMNIFUL_CLIENT_ID: opt,
  OMNIFUL_CLIENT_SECRET: opt,
  OMNIFUL_HUB_CODE: opt,
  OMNIFUL_HOOK_SECRET: opt,
  OMNIFUL_ENV: oneOf(["staging", "production"] as const, "OMNIFUL_ENV"),
  OMNIFUL_BASE: opt,

  META_PIXEL_ID: opt,
  META_CAPI_TOKEN: opt,
  META_TEST_EVENT_CODE: opt,
  SNAP_PIXEL_ID: opt,
  SNAP_CAPI_TOKEN: opt,
  GA4_MEASUREMENT_ID: opt,
  GA4_API_SECRET: opt,
});

export type EnvVars = z.infer<typeof EnvSchema>;

export interface Env extends EnvVars {
  servicesMode: "live" | "fake";
  production: boolean;
  /** the public origin, no trailing slash ("" when unknown) */
  siteUrl: string;
  /** variables whose value was none of the allowed choices and so was treated as unset */
  ignored: string[];
  /** SESSION_SECRET was missing or short and was derived from the admin password (as the original did) */
  sessionSecretDerived: boolean;
  /** first-run setup at start (migrations, then the copy from the original's tables): off with LM_AUTO_SETUP=off */
  autoSetup: boolean;
}

/**
 * PRODUCTION is any sign of the deployed site: Netlify's runtime SITE_ID (functions see it;
 * they do not see CONTEXT, a build variable), NODE_ENV=production, or CONTEXT=production.
 * In production the services are live — SERVICES_MODE=fake is refused (thrown) — and the
 * Meta test code is never sent.
 */
export function isProduction(source: Record<string, string | undefined>): boolean {
  const t = (v: string | undefined) => String(v || "").trim();
  return !!t(source.SITE_ID) || t(source.NODE_ENV).toLowerCase() === "production" || t(source.CONTEXT).toLowerCase() === "production";
}

export class EnvError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EnvError";
  }
}

export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  ignoredNow.length = 0;
  const v = EnvSchema.parse(source);
  const ignored = [...new Set(ignoredNow)];
  ignoredNow.length = 0;
  const production = isProduction(source);
  const servicesMode = v.SERVICES_MODE || "live";
  if (servicesMode === "fake" && production) throw new EnvError("SERVICES_MODE=fake is refused in production (SITE_ID, NODE_ENV=production or CONTEXT=production is set)");
  /*
   * The original signed its sessions with ADMIN_PASSWORD when SESSION_SECRET was not set. A site
   * moved over with the same variables must keep signing in, so the same fallback: a secret
   * derived (one-way) from the password or its hash. The health check says to set a real one.
   */
  let sessionSecret = String(v.SESSION_SECRET || "");
  let sessionSecretDerived = false;
  const cred = String(v.ADMIN_PASSWORD_HASH || "").trim() || String(v.ADMIN_PASSWORD || "");
  if (sessionSecret.length < 32 && cred) {
    sessionSecret = createHash("sha256").update("lm-session-from-admin-password:" + cred).digest("hex");
    sessionSecretDerived = true;
  }
  return {
    ...v,
    SESSION_SECRET: sessionSecret || undefined,
    servicesMode,
    production,
    siteUrl: String(v.SITE_URL || v.URL || "").replace(/\/+$/, ""),
    ignored,
    sessionSecretDerived,
    autoSetup: String(v.LM_AUTO_SETUP || "").trim().toLowerCase() !== "off",
  };
}
