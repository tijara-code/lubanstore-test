/**
 * The first start against a real database (src/server/db/setup.ts): the tables are made and the
 * original's data copied, once, and two starts at the same time do not get in each other's way.
 * Needs a real PostgreSQL (LM_TEST_PG_URL — the `pg` project) and the original beside the repo
 * for its schema; skipped otherwise.
 */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { setupDatabase, schemaState } from "../../../src/server/db/setup";

const PG = process.env.LM_TEST_PG_URL || "";
const REF = [path.resolve("../luban-musk"), path.resolve("../ref/luban-musk"), "/home/claude/ref/luban-musk"].find((p) => existsSync(path.join(p, "supabase/schema.sql")));
const d = PG && REF ? describe : describe.skip;

const MIGRATIONS = [
  "2026-10-admin-audit.sql", "2026-10-indexes.sql", "2026-10-logs-order-id.sql", "2026-10-pii-retention.sql",
  "2026-10-webhook-dedupe.sql", "2026-10-fixes.sql", "2026-10-storefront.sql", "2026-10-live-map.sql",
  "0009-schema-migrations.sql", "0010-order-checks.sql", "0011-order-flag.sql", "0012-function-grants.sql",
  "0013-stats-rollup.sql", "0014-stats-history.sql", "0015-whatsapp.sql", "0016-no-anon-access.sql",
];

function withDatabase(url: string, name: string): string {
  const u = new URL(url);
  u.pathname = "/" + name;
  return u.toString();
}

d("the first start against the original's database", () => {
  const name = "lmt_firstrun_" + process.pid + "_" + Date.now().toString(36);
  let admin: ReturnType<typeof postgres>;
  let url: string;
  beforeAll(async () => {
    admin = postgres(withDatabase(PG, "postgres"), { max: 1, onnotice: () => {} });
    await admin.unsafe(`create database "${name}"`);
    url = withDatabase(PG, name);
    const c = postgres(url, { max: 1, prepare: false, onnotice: () => {} });
    const sup = path.join(REF!, "supabase");
    for (const role of ["anon", "authenticated", "service_role"]) await c.unsafe(`do $$ begin create role ${role}; exception when duplicate_object then null; end $$;`);
    await c.unsafe(readFileSync(path.join(sup, "schema.sql"), "utf8"));
    for (const f of MIGRATIONS) await c.unsafe(readFileSync(path.join(sup, "migrations", f), "utf8"));
    await c.unsafe(`insert into public.orders (id, created_at, name, phone, country_code, country, city, pay, items, cur, ship, total, omr, status, payment_status)
      select 'LM-'||g, now() - (g||' hours')::interval, 'c'||g, '+968 7665 '||(1000+g), 'OM', 'عمان', 'x', 'cod', '[{"itemId":"oud-large","price":25,"qty":1}]', 'OMR', 0, 25, 25, 'new', 'cod' from generate_series(1, 40) g`);
    await c.end();
  }, 120_000);
  afterAll(async () => {
    await admin.unsafe(`drop database if exists "${name}" with (force)`).catch(() => {});
    await admin.end();
  });

  it("migrates, copies the original's orders, and a second start finds nothing to do", async () => {
    const lines: string[] = [];
    const c = postgres(url, { max: 1, prepare: false, onnotice: () => {} });
    try {
      expect((await schemaState(c)).hasOrders).toBe(false);
      const first = await setupDatabase(c, (l) => lines.push(l));
      expect(first).toMatchObject({ migrated: true, imported: true, orders: 40, originalOrders: 40 });
      expect(lines.some((l) => /running db\/import-from-v1.sql/.test(l))).toBe(true);
      const again = await setupDatabase(c);
      expect(again).toMatchObject({ migrated: false, imported: false, orders: 40 });
      // the original's tables are untouched
      expect(Number((await c`select count(*)::int as n from public.orders`)[0]!.n)).toBe(40);
      expect((await c`select kind from store.order_events where order_id = 'LM-1'`).map((r) => r.kind)).toEqual(["imported"]);
    } finally {
      await c.end();
    }
  }, 120_000);

  it("two cold starts at once: one does the work, the other goes on with it (no half schema, no double rows)", async () => {
    const other = "lmt_firstrun2_" + process.pid + "_" + Date.now().toString(36);
    await admin.unsafe(`create database "${other}" template "${name}"`);
    const u2 = withDatabase(PG, other);
    const c0 = postgres(u2, { max: 1, prepare: false, onnotice: () => {} });
    await c0.unsafe(`drop schema store cascade; drop schema if exists drizzle cascade;`);
    await c0.end();
    const a = postgres(u2, { max: 1, prepare: false, onnotice: () => {} });
    const b = postgres(u2, { max: 1, prepare: false, onnotice: () => {} });
    try {
      const [ra, rb] = await Promise.all([setupDatabase(a), setupDatabase(b)]);
      expect(ra.orders).toBe(40);
      expect(rb.orders).toBe(40);
      expect(Number((await a`select count(*)::int as n from store.orders`)[0]!.n)).toBe(40);
      expect(Number((await a`select count(*)::int as n from store.order_events where kind = 'imported'`)[0]!.n)).toBe(40);
      expect(Number((await a`select count(*)::int as n from information_schema.tables where table_schema = 'store'`)[0]!.n)).toBe(14);
    } finally {
      await a.end();
      await b.end();
      await admin.unsafe(`drop database if exists "${other}" with (force)`).catch(() => {});
    }
  }, 120_000);
});
