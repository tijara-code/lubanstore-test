/**
 * Configuration, read from the environment once and typed. Every variable is listed in
 * .env.example and docs/ENV.md (a test fails if code reads one that is not documented).
 * Nothing here is ever sent to a browser except the public pixel ids and the GA4 id.
 */
import { z } from "zod";

const opt = z.string().trim().optional().transform((v) => (v ? v : undefined));

export const EnvSchema = z.object({
  /** live = the real services; fake = in-process fakes (local dev, e2e). Default: fake unless NODE_ENV=production. */
  SERVICES_MODE: z.enum(["live", "fake"]).optional(),
  /** Netlify deploy context (production, deploy-preview, branch-deploy, dev) */
  CONTEXT: opt,
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
  /** signs admin session cookies; at least 32 characters */
  SESSION_SECRET: opt,

  THAWANI_MODE: z.enum(["uat", "live"]).optional(),
  THAWANI_SECRET_KEY: opt,
  THAWANI_PUBLISHABLE_KEY: opt,
  THAWANI_WEBHOOK_SECRET: opt,

  OMNIFUL_API_TOKEN: opt,
  OMNIFUL_REFRESH_TOKEN: opt,
  OMNIFUL_CLIENT_ID: opt,
  OMNIFUL_CLIENT_SECRET: opt,
  OMNIFUL_HUB_CODE: opt,
  OMNIFUL_HOOK_SECRET: opt,
  OMNIFUL_ENV: z.enum(["staging", "production"]).optional(),
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
}

export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  const v = EnvSchema.parse(source);
  const production = v.CONTEXT === "production" || source.NODE_ENV === "production";
  return {
    ...v,
    servicesMode: v.SERVICES_MODE || (production ? "live" : "fake"),
    production,
    siteUrl: String(v.SITE_URL || v.URL || "").replace(/\/+$/, ""),
  };
}
