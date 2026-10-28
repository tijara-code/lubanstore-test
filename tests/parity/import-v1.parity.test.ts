/**
 * db/import-from-v1.sql against the ORIGINAL schema: build the original store's tables in
 * `public` (its schema.sql and every migration, in its own order), fill them with rows of
 * every vintage, run the import, and read the new tables back. Also: the SQL phone key
 * equals src/shared/orders/phone.ts phoneKey() on a spread of numbers.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import { phoneKey } from "../../src/shared/orders/phone";
import { REF_DIR } from "./ref";

const d = REF_DIR ? describe : describe.skip;
const MIGRATIONS = [
  "2026-10-admin-audit.sql", "2026-10-indexes.sql", "2026-10-logs-order-id.sql", "2026-10-pii-retention.sql",
  "2026-10-webhook-dedupe.sql", "2026-10-fixes.sql", "2026-10-storefront.sql", "2026-10-live-map.sql",
  "0009-schema-migrations.sql", "0010-order-checks.sql", "0011-order-flag.sql", "0012-function-grants.sql",
  "0013-stats-rollup.sql", "0014-stats-history.sql", "0015-whatsapp.sql", "0016-no-anon-access.sql",
];

function newSchemaSql(): string[] {
  const sql = readFileSync(path.resolve("db/migrations/0000_init.sql"), "utf8");
  return sql.split("--> statement-breakpoint").map((s) => s.trim()).filter(Boolean);
}

d("importing the original store's data", () => {
  it("copies orders, parcels, settings, records and history into the new schema", async () => {
    const db = new PGlite();
    await db.exec("create role anon; create role authenticated; create role service_role;");
    const sup = path.join(REF_DIR!, "supabase");
    await db.exec(readFileSync(path.join(sup, "schema.sql"), "utf8"));
    for (const f of MIGRATIONS) await db.exec(readFileSync(path.join(sup, "migrations", f), "utf8"));
    for (const st of newSchemaSql()) await db.exec(st);

    // rows of every vintage in the original tables
    await db.exec(`
      insert into public.settings (id, data) values (1, '{"countries":[{"code":"OM","name":"عمان","cur":"OMR","dial":"968","prices":{}}],"sizes":[],"scents":[]}') on conflict (id) do update set data = excluded.data;
      insert into public.orders (id, created_at, name, phone, country, country_code, city, region, pay, items, cur, ship, total, omr, dedupe_id, status, payment_status, tracking)
        values ('LM-482913', '2026-08-17T09:03:20Z', 'يحيى', '+968 7665 5565', 'عمان', 'OM', 'مسقط', 'الخوير', 'cod',
                '[{"itemId":"oud-small","scent":"عود","size":"صغير","price":12,"qty":2},{"itemId":"bundle","scent":"باقة","size":"","price":"29","qty":1}]',
                'ر.ع', 0, 54, 54, 'd-1', 'done', 'cod', null),
               ('LM-482914', '2026-08-18T09:00:00Z', 'Sara', '00971 50 123 4567', 'الإمارات', 'AE', 'دبي', 'مرسى', 'card',
                '[{"itemId":"oud-large","price":250,"qty":1}]', 'AED', 30, 280, 29.316, 'd-1', 'pending', 'unpaid', null),
               ('LM-482915', '2026-08-19T09:00:00Z', 'Old', '٩٦٨٧٩١٢٣٤٥٦', 'عمان', 'OM', 'صلالة', 'x', null,
                '[]', 'OMR', 3, 3, null, null, 'new', 'cod', 'LOCAL-1');
      update public.orders set session_id = 'checkout_x', invoice_no = '2026081800001', amount_baisa = 29316, gateway = '{"client":{"ip":"203.0.113.7","fbp":"fb.1.2"}}'::jsonb where id = 'LM-482914';
      update public.orders set phone = null, name = null, phone_key = '879123456' where id = 'LM-482915';
      insert into public.shipments (awb, order_id, carrier, status, created_at, delivered_at) values ('2900001', 'LM-482913', 'SMSA', 'Delivered', '2026-08-18T00:00:00Z', '2026-08-20T00:00:00Z');
      insert into public.shipments (awb, order_id, carrier, status, reference, sawb, created_at) values ('omf-LM-482914-2', 'LM-482914', 'Omniful', 'shipped', 'OMF1', '4410001', '2026-08-18T10:00:00Z');
      insert into public.ops (key, data) values ('omniful_skus', '{"oud-large":"LM3001"}'), ('omniful_auto', '{"on":true}'), ('changelog', '[{"at":"2026-09-01T00:00:00Z","what":"OM large 25 → 26"}]'), ('smsa_poll', '{}');
      insert into public.crm (phone, note, tags) values ('76655565', 'VIP', '{gold}');
      insert into public.events (name, item, sid, country) values ('page_view', 'home', 's1', 'OM'), ('add_cart', 'oud-large', 's1', 'OM');
      insert into public.logs (side, kind, message, place) values ('client', 'error', 'boom', '/'), ('server', '5xx', 'oops', 'order');
    `);

    const sql = readFileSync(path.resolve("db/import-from-v1.sql"), "utf8");
    await db.exec(sql);
    await db.exec(sql); // a second run changes nothing

    const orders = (await db.query<any>("select * from store.orders order by id")).rows;
    expect(orders.map((o) => o.id)).toEqual(["LM-482913", "LM-482914", "LM-482915"]);
    const [a, b, c] = orders;
    expect(a).toMatchObject({ status: "done", payment_status: "cod", pay: "cod", cur: "OMR", phone_key: "96876655565", tracking: "2900001", carrier: "SMSA", dedupe_id: "d-1" });
    expect(Number(a.sub)).toBe(53);
    expect(Number(a.cod_fee)).toBe(1);
    expect(a.delivered_at).not.toBeNull();
    expect(b).toMatchObject({ status: "pending", pay: "card", cur: "AED", phone_key: "971501234567", dedupe_id: null, amount_baisa: 29316, invoice_no: "2026081800001" });
    expect(b.client).toEqual({ ip: "203.0.113.7", fbp: "fb.1.2" });
    expect(Number(b.omr_rate)).toBeCloseTo(29.316 / 280, 6);
    expect(c).toMatchObject({ pay: "cod", phone: null, phone_key: "96879123456", tracking: "LOCAL-1" });
    expect(Number(c.omr)).toBe(3);

    const ships = (await db.query<any>("select * from store.shipments")).rows;
    expect(ships).toHaveLength(1);
    expect(ships[0]).toMatchObject({ id: "omf-LM-482914-2", sent_id: "LM-482914-2", reference: "OMF1", awb: "4410001", carrier: "empower", order_id: "LM-482914" });

    const ops = Object.fromEntries((await db.query<any>("select key, data from store.ops")).rows.map((r) => [r.key, r.data]));
    expect(ops.omniful_skus).toEqual({ "oud-large": "LM3001" });
    expect(ops.omniful_auto.on).toBe(false);
    expect(ops.smsa_poll).toBeUndefined();
    expect((await db.query<any>("select * from store.settings")).rows[0].version).toBe(1);
    expect((await db.query<any>("select phone_key, note from store.crm")).rows).toEqual([{ phone_key: "96876655565", note: "VIP" }]);
    expect((await db.query<any>("select count(*)::int as n from store.events")).rows[0].n).toBe(2);
    expect((await db.query<any>("select side from store.logs order by id")).rows.map((r) => r.side)).toEqual(["browser", "server"]);
    expect((await db.query<any>("select what from store.catalogue_changes")).rows).toEqual([{ what: "OM large 25 → 26" }]);
    expect((await db.query<any>("select count(*)::int as n from store.order_events where kind = 'imported'")).rows[0].n).toBe(3);
    // the original's tables are untouched and the helpers are gone
    expect((await db.query<any>("select count(*)::int as n from public.orders")).rows[0].n).toBe(3);
    expect((await db.query<any>("select count(*)::int as n from pg_proc where proname like 'v1_%'")).rows[0].n).toBe(0);

    // ---- a second run follows what moved on the OLD site: parcel, catalogue, records, notes, events ----
    await db.exec(`
      update public.shipments set status = 'delivered', delivered_at = '2026-08-21T00:00:00Z', updated_at = now() + interval '1 minute' where awb = 'omf-LM-482914-2';
      update public.settings set data = '{"countries":[{"code":"OM","name":"عمان","cur":"OMR","dial":"968","prices":{"x":1}}],"sizes":[],"scents":[]}', updated_at = now() + interval '1 minute' where id = 1;
      update public.ops set data = '{"oud-large":"LM3002"}', updated_at = now() + interval '1 minute' where key = 'omniful_skus';
      update public.crm set note = 'VIP+', updated_at = now() + interval '1 minute' where phone = '76655565';
      insert into public.events (name, item, sid, country, at) values ('page_view', 'home', 's2', 'AE', now() + interval '1 minute');
      insert into public.stats_hours (hour, sid, country, name, item, n) values ('2026-05-01T10:00:00Z', 'h1', 'OM', 'page_view', 'home', 7);
    `);
    await db.exec(sql);
    expect((await db.query<any>("select status, delivered_at from store.shipments")).rows[0]).toMatchObject({ status: "delivered" });
    expect((await db.query<any>("select delivered_at from store.orders where id = 'LM-482914'")).rows[0].delivered_at).not.toBeNull();
    expect((await db.query<any>("select data -> 'countries' -> 0 -> 'prices' as p, version, updated_by from store.settings")).rows[0]).toMatchObject({ p: { x: 1 }, version: 2, updated_by: "import" });
    expect((await db.query<any>("select data from store.ops where key = 'omniful_skus'")).rows[0].data).toEqual({ "oud-large": "LM3002" });
    expect((await db.query<any>("select note from store.crm")).rows[0].note).toBe("VIP+");
    expect((await db.query<any>("select count(*)::int as n from store.events")).rows[0].n).toBe(3);
    expect((await db.query<any>("select count(*)::int as n from store.event_hours")).rows[0].n).toBe(1); // hours: copied while the new table is empty…
    await db.exec(`insert into public.stats_hours (hour, sid, country, name, item, n) values ('2026-05-02T10:00:00Z', 'h2', 'OM', 'page_view', 'home', 3);`);
    await db.exec(sql);
    expect((await db.query<any>("select count(*)::int as n from store.event_hours")).rows[0].n).toBe(1); // …and never again (the raw events already hold those days)
    // the NEW admin published: the old catalogue no longer wins
    await db.exec(`update store.settings set updated_by = 'keeper'; update public.settings set data = '{"countries":[],"sizes":[],"scents":[]}', updated_at = now() + interval '2 minutes' where id = 1;`);
    await db.exec(sql);
    expect((await db.query<any>("select data -> 'countries' -> 0 -> 'prices' as p from store.settings")).rows[0].p).toEqual({ x: 1 });

    // ---- what changed on the OLD site after the import: db/reconcile-v1.sql ----
    // LM-482914 was paid and shipped on the old site; LM-482913 was cancelled there, but the NEW
    // store has already touched it (a status line after the import) — that one is kept.
    await db.exec(`
      update public.orders set status = 'ship', payment_status = 'paid', payment_id = 'pay_1', paid_at = '2026-08-18T12:00:00Z', tracking = '4410001' where id = 'LM-482914';
      update public.orders set status = 'void' where id = 'LM-482913';
      insert into store.order_events (order_id, at, kind, "from", "to", by) values ('LM-482913', now(), 'status', 'done', 'done', 'keeper');
    `);
    await db.exec(sql); // the import itself changes nothing for them
    expect((await db.query<any>("select status from store.orders where id = 'LM-482914'")).rows[0].status).toBe("pending");
    const reconcile = readFileSync(path.resolve("db/reconcile-v1.sql"), "utf8");
    // the editor shows the last statement's rows; here: run it, then the report query on its own
    const run = async () => {
      await db.exec(reconcile);
      return (await db.query<any>(reconcile.slice(reconcile.lastIndexOf("select id,")))).rows;
    };
    const report = await run();
    expect(report.map((r: any) => [r.id, r.outcome.split(" ")[0], r.was, r.now_status])).toEqual([
      ["LM-482914", "applied", "pending", "ship"],
      ["LM-482913", "kept", "done", "void"],
    ]);
    const b2 = (await db.query<any>("select * from store.orders where id = 'LM-482914'")).rows[0];
    expect(b2).toMatchObject({ status: "ship", payment_status: "paid", payment_id: "pay_1", tracking: "4410001" });
    expect(b2.paid_at).not.toBeNull();
    expect((await db.query<any>("select status from store.orders where id = 'LM-482913'")).rows[0].status).toBe("done");
    expect((await db.query<any>("select \"from\", \"to\" from store.order_events where order_id = 'LM-482914' and kind = 'status'")).rows).toEqual([{ from: "pending", to: "ship" }]);
    // a second run finds nothing left to apply (the kept one is still reported)
    const again = await run();
    expect(again.map((r: any) => r.id)).toEqual(["LM-482913"]);
  }, 120_000);

  it("makes the same customer key as the storefront and the server", async () => {
    const db = new PGlite();
    await db.exec("create schema store;");
    const sql = readFileSync(path.resolve("db/import-from-v1.sql"), "utf8");
    const fn = sql.slice(sql.indexOf("create or replace function store.v1_dial"), sql.indexOf("create or replace function store.v1_cur"));
    await db.exec(fn);
    const samples: Array<[string, string]> = [
      ["+968 7665 5565", "OM"], ["0096876655565", "OM"], ["76655565", "OM"], ["٧٦٦٥٥٥٦٥", "OM"], ["۹۱۲۳۴۵۶۷", "OM"],
      ["+971 50 123 4567", "AE"], ["0501234567", "AE"], ["971501234567", "AE"], ["+966 55 123 4567", "SA"],
      ["+974 3312 3456", "QA"], ["+965 9988 7766", "KW"], ["+973 3612 3456", "BH"], ["12345", "XX"], ["", "OM"], ["9689", "OM"],
    ];
    for (const [phone, cc] of samples) {
      const r = (await db.query<any>("select store.v1_phone_key($1, $2, null) as k", [phone, cc])).rows[0].k;
      expect(r ?? "", phone + " " + cc).toBe(phoneKey(phone, cc));
    }
  });
});
