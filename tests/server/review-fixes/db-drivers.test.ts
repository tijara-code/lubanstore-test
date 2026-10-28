/**
 * (review-fixes, findings 1 and 6) The raw SQL works on BOTH drivers — PGlite here, real
 * PostgreSQL through postgres-js on the `pg` project (`npm run test:pg`): a Date in a raw
 * `sql` template, `db.execute`'s rows, and no table left to the connection's search_path.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { allow } from "../../../src/server/core/ratelimit";
import { dateParam, queryRows, rowsOf } from "../../../src/server/db/client";
import { events, orders, rateLimits } from "../../../src/server/db/schema";
import { firstOnRecord, purgeEvents, rollup } from "../../../src/server/domain/analytics/rollup";
import { runRetention } from "../../../src/server/jobs/orders";
import { createHarness, type Harness } from "../../helpers/harness";
import { orderRow } from "../orders/fixtures";

let h: Harness;
beforeAll(async () => { h = await createHarness(); });

describe("a Date in raw SQL", () => {
  it("binds as a timestamp on either driver", async () => {
    const at = new Date(h.clock.t);
    const r = await queryRows<{ t: number; later: boolean }>(h.db, sql`select (extract(epoch from ${at}::timestamptz) * 1000)::float8 as t, ${at} < now() + interval '100 years' as later`);
    expect(Number(r[0]!.t)).toBe(h.clock.t);
    expect(r[0]!.later).toBe(true);
    expect(dateParam(at)).toBe(at.toISOString());
    expect(dateParam("2026-01-01")).toBe("2026-01-01");
  });

  it("the rate limiter counts (it fails OPEN on a database error, so a broken bind would let everything through)", async () => {
    const out = [];
    for (let i = 0; i < 10; i++) out.push(await allow(h.db, "login", "192.0.2.77", h.clock.t));
    expect(out.map((a) => a.count)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(out.at(-1)!.ok).toBe(false);
    expect((await h.db.select().from(rateLimits)).length).toBeGreaterThan(0);
    // the window rolls over in SQL (the case when … <= now)
    const later = await allow(h.db, "login", "192.0.2.77", h.clock.t + 16 * 60e3);
    expect([later.ok, later.count]).toEqual([true, 1]);
  });

  it("the analytics rollup, the first-on-record read, the purge and the retention job run", async () => {
    await h.db.insert(events).values([
      { at: new Date(h.clock.t - 100 * 86400e3), name: "page_view", sid: "s-old" },
      { at: new Date(h.clock.t - 3600e3), name: "page_view", sid: "s-new" },
    ]);
    const rows = await rollup(h.db, new Date(h.clock.t - 200 * 86400e3), null);
    expect(rows.reduce((n, r) => n + r.n, 0)).toBe(2);
    expect(await firstOnRecord(h.db)).toBe(h.clock.t - 100 * 86400e3);
    expect(await purgeEvents(h.db, h.clock.t)).toEqual({ moved: 1 });
    const after = await rollup(h.db, new Date(h.clock.t - 200 * 86400e3), new Date(h.clock.t));
    expect(after.reduce((n, r) => n + r.n, 0)).toBe(2); // the old one now from the kept hours
    await h.db.insert(orders).values(orderRow(h, { id: "LM-7100001", status: "done", deliveredAt: new Date(h.clock.t - 400 * 86400e3), createdAt: new Date(h.clock.t - 410 * 86400e3) }));
    expect(await runRetention(h.deps)).toEqual({ cleared: 1, more: false });
  });

  it("db.execute's rows read the same on both drivers", async () => {
    const res = await h.db.execute(sql`select 1::int as one`);
    expect(rowsOf<{ one: number }>(res)).toEqual([{ one: 1 }]);
  });
});

/* ---------------- the source, read ---------------- */

const SRC = path.resolve(__dirname, "../../../src/server");
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f);
    return statSync(p).isDirectory() ? files(p) : p.endsWith(".ts") ? [p] : [];
  });
}
/** every raw sql`…` template in the server's code */
function templates(): Array<{ file: string; text: string }> {
  const out: Array<{ file: string; text: string }> = [];
  for (const f of files(SRC)) {
    if (f.endsWith(path.join("db", "schema.ts"))) continue;
    const s = readFileSync(f, "utf8");
    for (const m of s.matchAll(/\bsql`([^`]*)`/g)) out.push({ file: path.relative(SRC, f), text: m[1]! });
  }
  return out;
}

describe("the server's raw SQL", () => {
  it("names every table through its Drizzle object (never left to search_path — the pooler may not keep it)", () => {
    const schema = readFileSync(path.join(SRC, "db", "schema.ts"), "utf8");
    const tables = [...schema.matchAll(/store\.table\(\s*"([a-z_]+)"/g)].map((m) => m[1]!);
    expect(tables).toContain("events");
    const bad: string[] = [];
    for (const t of templates()) {
      for (const m of t.text.matchAll(/\b(?:from|join|into|update|table)\s+"?([a-z_]+)"?/gi)) {
        if (tables.includes(m[1]!.toLowerCase())) bad.push(t.file + ": " + m[0]);
      }
    }
    expect(bad).toEqual([]);
  });
});
