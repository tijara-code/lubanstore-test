/**
 * `npm run preflight` — the switch-over checks, run BY HAND against the real project, before and
 * after the switch. READ-ONLY: it connects to DATABASE_URL, runs SELECTs, and writes nothing.
 * It never prints a value from the environment or the database beyond counts and names.
 *
 *   npm run preflight            before the switch (and again just before, after the last import)
 *   npm run preflight -- --after after the switch: the new store is live, drift is a finding
 *
 * Reads .env (node --env-file) so the same values you will paste into Netlify can be checked
 * here first. Exit code 1 when any check FAILS; WARNs are for you to read.
 *
 * What it checks:
 *   env       every variable the live site needs, its shape (never its value), fake mode off,
 *             Thawani live, admin sign-in set up, SESSION_SECRET long enough, SITE_URL https
 *   database  reachable; schema "store" migrated (all tables); the original's tables present
 *   import    counts original → new (orders, Empower parcels, CRM notes, events, hours);
 *             the catalogue row; Empower auto push OFF until you turn it on; orders placed on
 *             the old site that are not in the new tables yet; orders whose status or payment
 *             differs between old and new (changed on the old site after an earlier import —
 *             db/reconcile-v1.sql lists them)
 *   pages     dist/ built with the same pixel ids the environment names (when dist/ exists)
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { EnvError, loadEnv, type Env } from "../src/server/env";
import { validHash } from "../src/server/domain/admin/auth";
import { pixelIds } from "./site-meta";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const AFTER = process.argv.includes("--after");

type Level = "PASS" | "WARN" | "FAIL";
const rows: Array<{ level: Level; area: string; what: string }> = [];
const say = (level: Level, area: string, what: string) => rows.push({ level, area, what });

const STORE_TABLES = [
  "admin_audit", "catalogue_changes", "claims", "crm", "event_hours", "events", "logs", "ops",
  "order_events", "orders", "rate_limits", "settings", "shipments", "webhook_events",
];
const V1_TABLES = ["orders", "shipments", "settings", "events", "stats_hours", "crm", "logs", "webhook_events", "admin_audit", "ops"];

/* ------------------------------------------------------------------ env */

function checkEnv(): Env | null {
  const src = process.env;
  const has = (k: string) => String(src[k] || "").trim().length > 0;
  let env: Env;
  try {
    env = loadEnv(src);
  } catch (e) {
    if (e instanceof EnvError) say("FAIL", "env", e.message);
    else if ((e as Error)?.name === "ZodError") {
      const names = ((e as { issues?: Array<{ path?: unknown[] }> }).issues || []).map((i) => (i.path || []).join(".")).join(", ");
      say("FAIL", "env", "refused value(s) in: " + names + " — see docs/ENV.md");
    } else say("FAIL", "env", "could not read the environment: " + (e as Error).message);
    return null;
  }
  if (env.servicesMode === "fake") say("FAIL", "env", "SERVICES_MODE=fake — the live site must not have it (remove the variable)");
  else say("PASS", "env", "services live");

  if (!has("DATABASE_URL")) say("FAIL", "env", "DATABASE_URL missing (Supabase → Connect → Transaction pooler URI)");
  else if (!/^postgres(ql)?:\/\//.test(String(src.DATABASE_URL))) say("FAIL", "env", "DATABASE_URL is not a postgres:// URL");
  else if (!/pooler\.supabase\.com/.test(String(src.DATABASE_URL))) say("WARN", "env", "DATABASE_URL is not the Supabase pooler host — functions need the transaction pooler (port 6543)");
  else say("PASS", "env", "DATABASE_URL set (pooler)");

  if (!env.siteUrl) say("WARN", "env", "SITE_URL not set — return links use Netlify's URL variable (fine on the production site, wrong on a preview)");
  else if (!/^https:\/\//.test(env.siteUrl)) say("FAIL", "env", "SITE_URL must start with https://");
  else say("PASS", "env", "SITE_URL https");

  if (!has("ADMIN_USER")) say("FAIL", "env", "ADMIN_USER missing");
  if (has("ADMIN_PASSWORD_HASH")) {
    if (validHash(String(src.ADMIN_PASSWORD_HASH).trim())) say("PASS", "env", "ADMIN_PASSWORD_HASH is a scrypt hash");
    else say("FAIL", "env", "ADMIN_PASSWORD_HASH is not a hash made by `npm run admin:hash`");
  } else if (has("ADMIN_PASSWORD")) say("WARN", "env", "ADMIN_PASSWORD is plain text — prefer ADMIN_PASSWORD_HASH (`npm run admin:hash`)");
  else say("FAIL", "env", "no admin password: set ADMIN_PASSWORD_HASH");
  const secret = String(src.SESSION_SECRET || "");
  if (secret.length < 32) say("FAIL", "env", "SESSION_SECRET missing or shorter than 32 characters");
  else say("PASS", "env", "SESSION_SECRET length ok");

  if (env.THAWANI_MODE !== "live") say(AFTER ? "FAIL" : "WARN", "env", "THAWANI_MODE is not live (uat/test): card payments go to Thawani's test host");
  else say("PASS", "env", "Thawani live");
  for (const k of ["THAWANI_SECRET_KEY", "THAWANI_PUBLISHABLE_KEY", "THAWANI_WEBHOOK_SECRET"]) {
    if (!has(k)) say("FAIL", "env", k + " missing (card payments / webhook will be refused)");
  }
  if (has("THAWANI_SECRET_KEY") && env.THAWANI_MODE === "live" && /test|uat/i.test(String(src.THAWANI_SECRET_KEY).slice(0, 12)))
    say("WARN", "env", "THAWANI_SECRET_KEY looks like a test key while THAWANI_MODE=live");

  const omni = ["OMNIFUL_API_TOKEN", "OMNIFUL_HUB_CODE"].filter((k) => !has(k));
  if (omni.length) say("WARN", "env", "Empower not connected: " + omni.join(", ") + " missing (orders can still be taken; pushing waits)");
  else say("PASS", "env", "Empower credentials present");
  if (has("OMNIFUL_API_TOKEN") && !has("OMNIFUL_HOOK_SECRET")) say("WARN", "env", "OMNIFUL_HOOK_SECRET missing: Empower status webhooks will be refused (the poll still runs)");
  if (env.OMNIFUL_ENV && env.OMNIFUL_ENV !== "production") say("WARN", "env", "OMNIFUL_ENV is not production");

  for (const [k, what] of [["META_CAPI_TOKEN", "Meta server events"], ["SNAP_CAPI_TOKEN", "Snap server events"], ["GA4_API_SECRET", "GA4 server purchases"]] as const) {
    if (!has(k)) say("WARN", "env", k + " missing: " + what + " off (browser pixel still fires)");
  }
  if (has("META_TEST_EVENT_CODE")) say("WARN", "env", "META_TEST_EVENT_CODE is set: ignored on production, but remove it once the preview test is done");
  for (const k of ["SMSA_API_KEY", "SMSA_ENV", "SMSA_BASE", "WA_TOKEN", "WA_PHONE_ID", "WA_APP_SECRET", "WA_VERIFY_TOKEN", "SUPABASE_URL", "SUPABASE_SERVICE_KEY", "OMNIFUL_SELLER_ID"]) {
    if (has(k)) say("WARN", "env", k + " is from the original and unused here — remove it from Netlify so it is not kept around for nothing");
  }
  return env;
}

/* ------------------------------------------------------------------ database */

type Sql = ReturnType<typeof postgres>;

async function count(sql: Sql, q: ReturnType<Sql>): Promise<number> {
  const r = await q;
  return Number((r[0] as { n?: unknown })?.n ?? 0);
}

async function checkDatabase(url: string): Promise<void> {
  const sql = postgres(url, { prepare: false, max: 1, connect_timeout: 15, onnotice: () => {}, transform: undefined });
  try {
    await sql`select 1`;
    say("PASS", "database", "reachable");
  } catch (e) {
    say("FAIL", "database", "cannot connect: " + String((e as Error).message || e).replace(/postgres(ql)?:\/\/\S+/g, "<url>"));
    await sql.end({ timeout: 1 }).catch(() => {});
    return;
  }
  try {
    const have = (await sql`select table_name from information_schema.tables where table_schema = 'store'`).map((r) => String((r as { table_name: string }).table_name));
    const missing = STORE_TABLES.filter((t) => !have.includes(t));
    if (!have.length) say("FAIL", "database", 'schema "store" does not exist — run `npm run db:migrate` first');
    else if (missing.length) say("FAIL", "database", 'schema "store" is missing tables: ' + missing.join(", ") + " — run `npm run db:migrate`");
    else say("PASS", "database", `schema "store" migrated (${have.length} tables)`);
    const mig = await count(sql, sql`select count(*)::int as n from information_schema.tables where table_schema = 'drizzle' and table_name = '__drizzle_migrations'`);
    if (!mig) say("WARN", "database", "no drizzle migration record: the schema was not made by `npm run db:migrate`");

    const v1 = (await sql`select table_name from information_schema.tables where table_schema = 'public'`).map((r) => String((r as { table_name: string }).table_name));
    const v1missing = V1_TABLES.filter((t) => !v1.includes(t));
    if (!v1.includes("orders")) {
      say(AFTER ? "WARN" : "FAIL", "import", "the original's public.orders is not in this database — is DATABASE_URL the same Supabase project the live store uses?");
      return;
    }
    if (v1missing.length) say("WARN", "import", "original tables not found (the import skips them): " + v1missing.join(", "));
    if (missing.length || !have.includes("orders")) return;

    const pubOrders = await count(sql, sql`select count(*)::int as n from public.orders`);
    const newOrders = await count(sql, sql`select count(*)::int as n from store.orders`);
    const imported = await count(sql, sql`select count(*)::int as n from store.orders o where exists (select 1 from public.orders p where p.id = o.id)`);
    const notYet = await count(sql, sql`select count(*)::int as n from public.orders p where not exists (select 1 from store.orders o where o.id = p.id)`);
    say(newOrders ? "PASS" : "FAIL", "import", `orders: original ${pubOrders}, new ${newOrders} (${imported} copied, ${newOrders - imported} placed on the new store)`);
    if (notYet) say(AFTER ? "FAIL" : "WARN", "import", `${notYet} order(s) on the old site are not in the new tables yet — run db/import-from-v1.sql again` + (AFTER ? " NOW (they were placed before the switch finished)" : " just before you switch"));
    else if (pubOrders) say("PASS", "import", "every original order is in the new tables");

    // the same status/payment mapping as db/import-from-v1.sql and db/reconcile-v1.sql
    const drift = await count(sql, sql`
      select count(*)::int as n from public.orders p join store.orders o on o.id = p.id
      where (case lower(coalesce(p.status, ''))
               when 'pending' then 'pending' when 'new' then 'new' when 'prep' then 'prep' when 'ship' then 'ship'
               when 'done' then 'done' when 'void' then 'void'
               when 'preparing' then 'prep' when 'shipped' then 'ship' when 'delivered' then 'done' when 'cancelled' then 'void'
               else 'new' end) is distinct from o.status
         or (case when lower(coalesce(p.payment_status, '')) in ('unpaid', 'paid', 'cod', 'refunded', 'cancelled') then lower(p.payment_status) else o.payment_status end) is distinct from o.payment_status
         or nullif(p.tracking, '') is distinct from o.tracking`);
    if (drift) say(AFTER ? "FAIL" : "WARN", "import", `${drift} order(s) differ (status / payment / tracking) between old and new — they changed on the old site after an earlier import. Run db/reconcile-v1.sql to list and apply the old site's newer state`);
    else say("PASS", "import", "no status/payment/tracking drift between old and new orders");

    if (v1.includes("shipments")) {
      const pubOmf = await count(sql, sql`select count(*)::int as n from public.shipments where awb like 'omf-%'`);
      const newOmf = await count(sql, sql`select count(*)::int as n from store.shipments where carrier = 'empower'`);
      say(newOmf >= pubOmf ? "PASS" : "WARN", "import", `Empower parcels: original ${pubOmf}, new ${newOmf}`);
    }
    if (v1.includes("crm")) {
      const a = await count(sql, sql`select count(*)::int as n from public.crm`);
      const b = await count(sql, sql`select count(*)::int as n from store.crm`);
      say(b >= a ? "PASS" : "WARN", "import", `customer notes: original ${a}, new ${b}`);
    }
    if (v1.includes("events")) {
      const a = await count(sql, sql`select count(*)::int as n from public.events`);
      const b = await count(sql, sql`select count(*)::int as n from store.events`);
      say(b > 0 || a === 0 ? "PASS" : "FAIL", "import", `analytics events: original ${a}, new ${b}` + (b < a && b > 0 ? " (the original's older rows beyond the retention window are not copied)" : ""));
    }
    if (v1.includes("stats_hours")) {
      const a = await count(sql, sql`select count(*)::int as n from public.stats_hours`);
      const b = await count(sql, sql`select count(*)::int as n from store.event_hours`);
      say(b > 0 || a === 0 ? "PASS" : "FAIL", "import", `KPI hours: original ${a}, new ${b}`);
    }
    const settingsRow = await count(sql, sql`select count(*)::int as n from store.settings where id = 1`);
    say(settingsRow ? "PASS" : "FAIL", "import", settingsRow ? "the published catalogue is in store.settings" : "no catalogue row in store.settings — the import did not run, or the original had none (the bundled catalogue would serve)");
    const auto = await sql`select data ->> 'on' as o from store.ops where key = 'omniful_auto'`;
    const on = String((auto[0] as { o?: string } | undefined)?.o || "") === "true";
    if (!AFTER && on) say("FAIL", "import", "Empower auto push is ON in the new store while the old one is still live — both would push. Turn it off in the new admin (Empower tab) until the switch");
    else if (AFTER && !on) say("WARN", "import", "Empower auto push is OFF (expected right after the switch): turn it on in the Empower tab once the first orders look right");
    else say("PASS", "import", "Empower auto push " + (on ? "on" : "off"));
    const stuck = await count(sql, sql`select count(*)::int as n from store.orders where status = 'pending' and pay = 'card' and created_at < now() - interval '2 hours'`);
    if (AFTER && stuck) say("WARN", "orders", `${stuck} card order(s) still 'pending' after 2 hours — is the orders-expire job running? (Netlify › Logs › Functions)`);
  } catch (e) {
    say("FAIL", "database", "a check failed: " + String((e as Error).message || e).slice(0, 200));
  } finally {
    await sql.end({ timeout: 2 }).catch(() => {});
  }
}

/* ------------------------------------------------------------------ pages */

function checkPages(): void {
  const index = path.join(REPO, "dist", "index.html");
  if (!existsSync(index)) {
    say("WARN", "pages", "dist/ not built here (Netlify builds it) — skipped the pixel-id check");
    return;
  }
  let ids: { meta: string; snap: string };
  try {
    ids = pixelIds(process.env);
  } catch (e) {
    say("FAIL", "pages", (e as Error).message);
    return;
  }
  const html = readFileSync(index, "utf8");
  say(html.includes(ids.meta) ? "PASS" : "FAIL", "pages", "Meta pixel id in the built home page matches META_PIXEL_ID" + (html.includes(ids.meta) ? "" : " — rebuild with the variable set"));
  say(html.includes(ids.snap) ? "PASS" : "FAIL", "pages", "Snap pixel id in the built home page matches SNAP_PIXEL_ID");
  if (/__(ASSET_V|BUILD_ID|META_PIXEL_ID|SNAP_PIXEL_ID)__/.test(html)) say("FAIL", "pages", "an unfilled placeholder is in dist/index.html");
  /* Netlify's secrets scanner fails the build when a variable's VALUE appears in the output.
     ADMIN_USER is the one that bites (the original hit it with "admin"): check it against the pages. */
  const user = String(process.env.ADMIN_USER || "").trim();
  if (user.length >= 3) {
    // the scanner reads the whole repository (source, tests, docs) as well as dist/
    const hit = findWord(user.toLowerCase());
    if (hit) say("FAIL", "pages", "the value of ADMIN_USER appears in " + hit + " — Netlify's secrets scanner fails the build when a variable's value is in the repository or the site; choose a user name that is not a word in either");
    else say("PASS", "pages", "ADMIN_USER appears nowhere in the repository or the pages");
  }
}

/** The first text file under the repository (not node_modules/.git/.data) that contains `word`, case-insensitively. */
function findWord(word: string): string | null {
  const skip = new Set(["node_modules", ".git", ".data", "coverage"]);
  const text = /\.(ts|tsx|mts|js|mjs|cjs|json|md|html|css|sql|toml|txt|xml|svg|yml|yaml|cmd|example)$/i;
  const walk = (dir: string): string | null => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (skip.has(e.name)) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        const r = walk(p);
        if (r) return r;
      } else if (text.test(e.name) || e.name.startsWith(".env")) {
        try {
          if (readFileSync(p, "utf8").toLowerCase().includes(word)) return path.relative(REPO, p);
        } catch {
          /* unreadable: skip */
        }
      }
    }
    return null;
  };
  return walk(REPO);
}

/* ------------------------------------------------------------------ */

async function main(): Promise<void> {
  console.log(`Luban & Musk preflight (${AFTER ? "after" : "before"} the switch)\n`);
  const env = checkEnv();
  if (env && env.DATABASE_URL && /^postgres(ql)?:\/\//.test(env.DATABASE_URL)) await checkDatabase(env.DATABASE_URL);
  checkPages();
  const w = Math.max(...rows.map((r) => r.area.length));
  for (const r of rows) console.log(`${r.level.padEnd(4)}  ${r.area.padEnd(w)}  ${r.what}`);
  const fails = rows.filter((r) => r.level === "FAIL").length;
  const warns = rows.filter((r) => r.level === "WARN").length;
  console.log(`\n${fails ? "NOT READY" : "READY"}: ${fails} fail, ${warns} warn, ${rows.length - fails - warns} pass`);
  process.exitCode = fails ? 1 : 0;
}

main().catch((e) => {
  console.error("preflight could not run: " + (e as Error).message);
  process.exitCode = 1;
});
