/**
 * TRACKING HEALTH — did the last send to each platform land, and what did the last Purchase
 * carry? One `ops` record per platform (px:meta, px:snap, px:ga4):
 *   { day, sent, failed, lastOkAt, lastFailAt, lastError, lastEvent, purchase: { at, ok, fields } }
 * A failure is always written; a success at most once every five minutes per instance (a sign
 * of life, not a tally) — except a Purchase, always written with the NAMES of its match fields
 * (never their values). Counts are per Muscat day and reset when the day turns. A database
 * that cannot be asked loses nothing but the note.
 */
import { muscatDay } from "../../../shared/time";
import type { Deps } from "../../core/deps";
import { getOp, updateOp } from "../../core/ops";

export type PxPlatform = "meta" | "snap" | "ga4";
export const PX_PLATFORMS: readonly PxPlatform[] = ["meta", "snap", "ga4"];
export const OK_EVERY_MS = 5 * 60e3;

export interface PxHealth {
  day: string;
  sent: number;
  failed: number;
  lastOkAt?: string;
  lastFailAt?: string;
  lastError?: string;
  lastEvent?: string;
  purchase?: { at: string; ok: boolean; fields: string[] } | null;
}

/** per database (one instance's memory): when a success was last written, per platform */
const lastOkWrite = new WeakMap<object, Record<string, number>>();

/** the user_data keys the first event carried (names only) */
export function fieldsOf(payload: unknown): string[] {
  try {
    const p = payload as { data?: Array<Record<string, unknown>> };
    const first = p && Array.isArray(p.data) ? p.data[0] : null;
    const u = (first && (first.user_data || first.user)) as Record<string, unknown> | null;
    if (!u) return [];
    return Object.keys(u).filter((k) => {
      const v = u[k];
      return v != null && v !== "" && !(Array.isArray(v) && !v.length);
    }).sort();
  } catch {
    return [];
  }
}

export function eventOf(payload: unknown): string {
  try {
    const p = payload as { data?: Array<Record<string, unknown>>; events?: Array<Record<string, unknown>> };
    const first = p && Array.isArray(p.data) ? p.data[0] : null;
    if (first) return String(first.event_name || first.event_type || first.event || "");
    if (p && Array.isArray(p.events) && p.events[0]) return String(p.events[0].name || "");
  } catch { /* nothing */ }
  return "";
}

/** Note one send. Never throws; a success inside five minutes of the last written one is not written. */
export async function noteSend(deps: Deps, platform: PxPlatform, ok: boolean, error: string | null | undefined, payload: unknown): Promise<void> {
  try {
    const ev = eventOf(payload);
    const now = deps.now();
    const purchase = /purchase/i.test(ev);
    const key = deps.db as unknown as object;
    const seen = lastOkWrite.get(key) || {};
    lastOkWrite.set(key, seen);
    if (ok && !purchase && seen[platform] && now - seen[platform]! < OK_EVERY_MS) return;
    if (ok) seen[platform] = now;
    const today = muscatDay(now);
    const at = new Date(now).toISOString();
    await updateOp<PxHealth>(deps.db, "px:" + platform, { day: today, sent: 0, failed: 0, purchase: null }, (cur) => {
      let d: PxHealth = { ...cur };
      if (d.day !== today) d = { day: today, sent: 0, failed: 0, purchase: cur.purchase || null };
      if (ok) { d.sent = (d.sent || 0) + 1; d.lastOkAt = at; }
      else { d.failed = (d.failed || 0) + 1; d.lastFailAt = at; d.lastError = String(error || "").slice(0, 200); }
      if (ev) d.lastEvent = ev;
      if (purchase) d.purchase = { at, ok: !!ok, fields: fieldsOf(payload) };
      return d;
    }, new Date(now));
  } catch {
    /* the note is a courtesy */
  }
}

export interface PlatformHealth extends Partial<PxHealth> {
  /** when the record was last written */
  at?: string;
  /** failures counted today (Muscat); 0 for a record from another day */
  failedToday: number;
}

/**
 * The Tracking health card and the admin's health: per platform its record (null when nothing
 * was ever sent), today's failures, and a warning when three or more failed today and the last
 * within the hour (`pixel_failures:<platform>`).
 */
export async function trackingHealth(deps: Deps): Promise<{ meta: PlatformHealth | null; snap: PlatformHealth | null; ga4: PlatformHealth | null; warnings: string[] }> {
  const now = deps.now();
  const today = muscatDay(now);
  const out: Record<string, PlatformHealth | null> = {};
  const warnings: string[] = [];
  for (const p of PX_PLATFORMS) {
    let r: Awaited<ReturnType<typeof getOp<PxHealth>>> = null;
    try { r = await getOp<PxHealth>(deps.db, "px:" + p); } catch { r = null; }
    if (!r) { out[p] = null; continue; }
    const d = r.data || ({} as PxHealth);
    const failedToday = d.day === today ? d.failed || 0 : 0;
    out[p] = { at: r.updatedAt.toISOString(), ...d, failedToday };
    if (failedToday >= 3 && d.lastFailAt && now - Date.parse(d.lastFailAt) < 3600e3) warnings.push("pixel_failures:" + p);
  }
  return { meta: out.meta ?? null, snap: out.snap ?? null, ga4: out.ga4 ?? null, warnings };
}
