/**
 * THE AUDIT TRAIL — every admin write that succeeded, one row: when, who, which action, what
 * it concerned (the order ids, the key) and a short summary of what was asked. Never the
 * whole payload (a catalogue publish is kilobytes) and never a customer's details: a
 * customer field is NAMED, never copied ("name": "(changed)"), and free text is masked like
 * a log line (port of the original lib/admin/audit.js, v329/v334).
 *
 * Written by the router after the action answered; a refused write (an error answer) is not
 * recorded, and a read never is. A failing audit write is logged and never fails the answer.
 * Kept 180 days (the `admin-audit` job).
 */
import { and, desc, gte, lt } from "drizzle-orm";
import type { Deps } from "../../core/deps";
import { mask } from "../../core/log";
import { adminAudit } from "../../db/schema";

/** fields that name or locate a person, or carry payloads: never copied into a summary */
export const SKIP: Record<string, 1> = {
  data: 1, rows: 1, items: 1, name: 1, phone: 1, email: 1, city: 1, region: 1, note: 1, address: 1,
  phoneKey: 1, phone_key: 1, gateway: 1, fbp: 1, fbc: 1, client: 1, password: 1, reason: 1, tags: 1, skus: 1,
};

/** The ids an action concerns, from its path, its body and its answer (≤ 200, ≤ 64 chars each). */
export function idsOf(params: Record<string, string | undefined>, body: unknown, answer: unknown): string[] {
  const out: string[] = [];
  const add = (v: unknown) => {
    if (typeof v === "string" && v && out.indexOf(v) < 0 && out.length < 200) out.push(v.slice(0, 64));
  };
  for (const v of Object.values(params || {})) add(v);
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const a = (answer && typeof answer === "object" ? answer : {}) as Record<string, unknown>;
  add(b.id);
  (Array.isArray(b.ids) ? b.ids : []).forEach(add);
  add(b.key);
  add(b.paymentId);
  add(a.id);
  add(a.refundId);
  (Array.isArray(a.ids) ? a.ids : []).forEach(add);
  return out;
}

/** The request in small: scalar fields (masked), lists counted, customer fields named only. */
export function summaryOf(body: unknown, answer?: unknown): Record<string, unknown> {
  const s: Record<string, unknown> = {};
  const b = (body && typeof body === "object" && !Array.isArray(body) ? body : {}) as Record<string, unknown>;
  for (const k of Object.keys(b)) {
    const v = b[k];
    if (v == null) continue;
    if (SKIP[k]) {
      s[k] = Array.isArray(v) ? v.length + " items" : typeof v === "object" ? "{…}" : "(changed)";
      continue;
    }
    if (typeof v === "string") s[k] = mask(v.slice(0, 120));
    else if (typeof v === "number" || typeof v === "boolean") s[k] = v;
    else if (k === "patch" && typeof v === "object" && !Array.isArray(v)) {
      const p: Record<string, unknown> = {};
      for (const kk of Object.keys(v as object)) {
        p[kk] = SKIP[kk] ? "(changed)" : mask(String((v as Record<string, unknown>)[kk]).slice(0, 80));
      }
      s.patch = p;
    } else s[k] = Array.isArray(v) ? v.length + " items" : "{…}";
  }
  const a = (answer && typeof answer === "object" ? answer : {}) as Record<string, unknown>;
  for (const k of ["updated", "deleted", "changed", "pushed", "version"]) {
    if (typeof a[k] === "number" || typeof a[k] === "boolean") s["→" + k] = a[k];
  }
  return s;
}

export interface AuditEntry {
  actor: string;
  action: string;
  target?: string | null;
  summary?: Record<string, unknown> | null;
}

/** Record one write. Never throws. */
export async function recordAudit(deps: Deps, e: AuditEntry): Promise<void> {
  try {
    await deps.db.insert(adminAudit).values({
      at: new Date(deps.now()),
      actor: String(e.actor || "admin").slice(0, 60),
      action: String(e.action).slice(0, 60),
      target: e.target ? String(e.target).slice(0, 1000) : null,
      summary: e.summary || null,
    });
  } catch (err) {
    await deps.log.error("admin-audit", String((err as Error)?.message || err), { detail: { action: e.action } });
  }
}

/** The trail, newest first: the last `days` days (≤ 180), at most `limit` rows. */
export async function listAudit(deps: Deps, o: { days?: number; limit?: number } = {}) {
  const days = Math.max(1, Math.min(180, Math.round(Number(o.days) || 30)));
  const limit = Math.max(1, Math.min(5000, Math.round(Number(o.limit) || 2000)));
  const rows = await deps.db
    .select()
    .from(adminAudit)
    .where(and(gte(adminAudit.at, new Date(deps.now() - days * 86400e3))))
    .orderBy(desc(adminAudit.at), desc(adminAudit.id))
    .limit(limit);
  return { ok: true as const, days, rows };
}

export const AUDIT_DAYS = 180;

export async function purgeAudit(deps: Deps, days = AUDIT_DAYS): Promise<number> {
  const gone = await deps.db.delete(adminAudit).where(lt(adminAudit.at, new Date(deps.now() - days * 86400e3))).returning({ id: adminAudit.id });
  return gone.length;
}
