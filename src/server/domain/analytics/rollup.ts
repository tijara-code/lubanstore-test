/**
 * THE EVENTS, ADDED UP IN THE DATABASE (the original 0013/0014: stats_rollup, stats_hours,
 * purge_events, stats_first).
 *
 * The Analytics tab reads one row per (session hash, hour, country, name, item) with a count —
 * from `events` and from `event_hours` together, so "All" reaches back to the first visit
 * whatever the purge has removed since. Only the adds and session_start keep their `item` (the
 * only ones the tab reads it from); a session is a short one-way hash (only "the same session
 * or not" is ever asked of it), the same on both sides, so a session split by the purge is
 * still one session.
 */
import { sql } from "drizzle-orm";
import { ITEM_KEPT } from "../../../shared/pixels/catalogue";
import { rowsOf, type DbOrTx } from "../../db/client";
import { eventHours, events, orders } from "../../db/schema";

// Tables are named through their Drizzle objects ("store"."events"), never left to the
// connection's search_path (which the Supabase transaction pooler may not keep).

export interface RolledRow {
  /** 16 hex of md5(sid); "" for an event with no session */
  sid: string;
  /** hours since 1970 (UTC) */
  hh: number;
  country: string;
  name: string;
  item: string;
  n: number;
}

/** rows of a raw query, whichever driver answered (db/client.ts) */
export { rowsOf };

const kept = sql.join(ITEM_KEPT.map((n) => sql`${n}`), sql`, `);

/** Every event of [since, until) — events and the kept hours — added up per session, hour, country, name and item. */
export async function rollup(db: DbOrTx, since: Date, until: Date | null): Promise<RolledRow[]> {
  const res = await db.execute(sql`
    with g as (
      select case when e.sid is null then '' else left(md5(e.sid), 16) end as sid,
             date_trunc('hour', e.at) as h, coalesce(e.country, '') as country, e.name,
             case when e.name in (${kept}) then coalesce(e.item, '') else '' end as item,
             count(*)::int as n
        from ${events} e
       where e.at >= ${since} and (${until}::timestamptz is null or e.at < ${until}::timestamptz)
       group by 1, 2, 3, 4, 5
      union all
      select s.sid, s.hour as h, s.country, s.name, s.item, s.n
        from ${eventHours} s
       where s.hour >= date_trunc('hour', ${since}::timestamptz) and (${until}::timestamptz is null or s.hour < ${until}::timestamptz)
    )
    select sid, (extract(epoch from h) / 3600)::int as hh, country, name, item, sum(n)::int as n
      from g group by sid, h, country, name, item
      order by hh desc, sid, country, name, item`);
  return rowsOf<Record<string, unknown>>(res).map((r) => ({
    sid: String(r.sid ?? ""),
    hh: Number(r.hh),
    country: String(r.country ?? ""),
    name: String(r.name),
    item: String(r.item ?? ""),
    n: Number(r.n) || 0,
  }));
}

/** The first moment on record: the earliest event, kept hour, or order (any state). NaN when there is none. */
export async function firstOnRecord(db: DbOrTx): Promise<number> {
  const res = await db.execute(sql`
    select (extract(epoch from least((select min(at) from ${events}), (select min(hour) from ${eventHours}), (select min(created_at) from ${orders}))) * 1000)::float8 as t`);
  const t = Number(rowsOf<{ t: unknown }>(res)[0]?.t);
  return Number.isFinite(t) && t > 0 ? t : NaN;
}

/**
 * THE PURGE (job events-rollup): events older than `days` (90) — or beyond the newest `cap`
 * (500,000) rows, because /api/ev is an open door and a full database is an outage — are added
 * into event_hours and deleted, in the same statement, so a row is never lost between the two.
 */
export async function purgeEvents(db: DbOrTx, now: number, opts: { days?: number; cap?: number } = {}): Promise<{ moved: number }> {
  const days = Math.max(1, Number(opts.days) || 90);
  const cap = Math.max(1, Math.floor(Number(opts.cap) || 500000));
  const cutoff = new Date(now - days * 86400e3);
  const res = await db.execute(sql`
    with keep as (select id from ${events} order by id desc offset ${cap} limit 1),
    gone as (
      delete from ${events}
       where at < ${cutoff} or id <= coalesce((select id from keep), 0)
       returning sid, at, country, name, item
    ),
    ins as (
      insert into ${eventHours} as eh (hour, sid, country, name, item, n)
      select date_trunc('hour', at),
             case when sid is null then '' else left(md5(sid), 16) end,
             coalesce(country, ''), name,
             case when name in (${kept}) then coalesce(item, '') else '' end,
             count(*)::int
        from gone
       group by 1, 2, 3, 4, 5
      on conflict (hour, sid, country, name, item) do update set n = eh.n + excluded.n
      returning 1
    )
    select (select count(*) from gone)::int as moved`);
  return { moved: Number(rowsOf<{ moved: unknown }>(res)[0]?.moved) || 0 };
}
