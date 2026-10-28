/**
 * The Empower tab's words and its Push all loop — pure, so the tests read the same rules the
 * tab draws with (ports of the original panel's omfLine / omfPollLine / paintOmfAuto /
 * stageOf / skuProducts and the v402 sweep loop).
 */
import type { Catalogue } from "../../../shared/catalogue/types";
import { isApiError } from "../../data/api";
import { dtt } from "../../lib/format";
import { explain } from "../../lib/words";
import type { AutoState, EmpowerStatus, PushedRow, Run, SweepAnswer } from "./api";

/** "just now", "18 min ago", "3 h ago" */
export function ago(at: string | null | undefined, now: number): string {
  const mins = Math.round((now - new Date(String(at)).getTime()) / 60000);
  return mins < 1 ? "just now" : mins < 60 ? mins + " min ago" : Math.round(mins / 60) + " h ago";
}

/** When statuses were last read and what came of it. */
export function pollLine(q: Run | null | undefined, now: number): { text: string; bad: boolean } {
  if (!q || !q.at) return { text: "Statuses sync every 30 min. Not read yet.", bad: false };
  const bits: string[] = [];
  if (q.tracked != null) bits.push(q.tracked + " checked");
  if (q.updated) bits.push(q.updated + " changed");
  if (q.moved) bits.push(q.moved + " order" + (q.moved === 1 ? "" : "s") + " moved");
  if (q.errors && q.errors.length) bits.push(q.errors.length + " not answered");
  return { text: "Statuses read " + ago(q.at, now) + (bits.length ? ". " + bits.join(" · ") + "." : ".") + " Orders move with their parcels on their own.", bad: !!(q.error || (q.errors && q.errors.length)) };
}

/** What the last push (by hand or Push all) did. */
export function sweepLine(p: Run | null | undefined, now: number): { text: string; bad: boolean } {
  if (!p || !p.at) return { text: "Nothing pushed yet.", bad: false };
  const bits: string[] = [];
  if (p.pushed != null) bits.push(p.pushed + " pushed");
  if (p.waiting) bits.push(p.waiting + " still waiting");
  if (p.failed && p.failed.length) bits.push(p.failed.length + " refused");
  return { text: "Last push ran " + ago(p.at, now) + (bits.length ? ". " + bits.join(" · ") + "." : "."), bad: !!(p.error || (p.failed && p.failed.length)) };
}

/** The auto push's note: what on means, and what its last run did. */
export function autoNote(a: AutoState | null | undefined): string {
  if (!a) return "";
  const bits: string[] = [];
  if (a.on) {
    bits.push(
      "On: complete website orders go to Empower " +
        (a.afterMin ? a.afterMin + " min after they are placed (card: once paid)" : "when placed (card when paid)") +
        ", by a run every " +
        (a.everyMin === 1 ? "minute" : a.everyMin + " min") +
        ".",
    );
  }
  const last = a.last;
  if (last && last.at) {
    const flagged = (last.flagged || []).length;
    const failed = (last.failed || []).length;
    bits.push(
      "Last run " +
        dtt(last.at) +
        ": " +
        (last.pushed || 0) +
        " pushed" +
        (flagged ? " · " + flagged + " held back (check details)" : "") +
        (failed ? " · " + failed + " refused by Omniful (retried after " + a.retryH + " h)" : "") +
        (last.error ? " · " + last.error : "") +
        ".",
    );
  }
  return bits.join(" ");
}

/** The connection's word: no API token / needs a hub code / staging / live. */
export function connWord(s: Pick<EmpowerStatus, "configured" | "missing" | "env"> | null | undefined): { text: string; tone: string; ready: boolean } {
  if (!s || !s.configured) return { text: "no API token", tone: "red", ready: false };
  if ((s.missing || []).length) return { text: "needs a hub code", tone: "amber", ready: false };
  return { text: s.env === "staging" ? "staging" : "live", tone: s.env === "staging" ? "amber" : "leaf", ready: true };
}
export function notReadyWhy(s: Pick<EmpowerStatus, "configured"> | null | undefined): string {
  return !s || !s.configured ? "Omniful not connected. Add its API token on the server." : "Add the Omniful hub code on the server first.";
}

/* ---------------- a parcel's stage (the server's rules, domain/empower/rules.ts) ---------------- */

export type Stage = "created" | "picked" | "transit" | "attempt" | "delivered" | "failed" | "returned";
const RULES: Array<[RegExp, Stage]> = [
  [/undeliver|not deliver|fail(ed)? (to )?deliver|deliver(y)? (attempt )?fail|unable to deliver/, "failed"],
  [/return|\brto\b/, "returned"],
  [/deliver(ed)?$|^delivered/, "delivered"],
  [/out for delivery|with courier|dispatch/, "transit"],
  [/refus|cancel|undeliver/, "failed"],
  [/no response|no answer|awaiting consignee/, "attempt"],
  [/picked ?up|collected|in transit|received at|departed|arrived|shipped/, "picked"],
  [/info received|created|manifest|booked/, "created"],
];
export function stageOf(status: unknown): Stage {
  const s = String(status || "").trim().toLowerCase().replace(/_/g, " ");
  if (!s) return "created";
  for (const [re, st] of RULES) if (re.test(s)) return st;
  return "created";
}
/** the pill's tint for a stage */
export const STAGE_TONE: Record<Stage, string> = { created: "muted", picked: "ship", transit: "amber", attempt: "amber", delivered: "done", failed: "red", returned: "red" };
/** "picked_up" → "Picked Up" (Omniful's words, readable) */
export const statusWords = (s: string | null | undefined) => (s ? String(s).replace(/_/g, " ").replace(/\b[a-z]/g, (c) => c.toUpperCase()) : "Sent");
/** a parcel that is over: delivered, cancelled (taken off) or returned */
export const finished = (r: Pick<PushedRow, "status" | "deliveredAt">) => !!r.deliveredAt || /cancel|return|\brto\b/i.test(String(r.status || ""));

export type StageFilter = "" | "open" | "delivered" | "problem" | "error";
export function filterPushed(rows: PushedRow[], stage: StageFilter, q: string): PushedRow[] {
  const s = q.trim().toLowerCase();
  return rows.filter((r) => {
    if (stage === "open" && r.deliveredAt) return false;
    if (stage === "delivered" && !r.deliveredAt) return false;
    if (stage === "error" && !r.lastError) return false;
    if (stage === "problem" && !/refus|return|fail|rto/i.test(String(r.status || ""))) return false;
    if (!s) return true;
    return [r.orderId, r.sentId, r.reference, r.awb, r.courierName, r.status].some((v) => String(v || "").toLowerCase().indexOf(s) > -1);
  });
}

/* ---------------- the SKU list ---------------- */

/** Every product sold anywhere — each scent in each size, each add-on, the set last — with its code. */
export function skuProducts(cfg: Catalogue | null | undefined): Array<{ code: string; name: string; empty?: string }> {
  const uniq = (kind: "scents" | "sizes" | "extras") => {
    let all: Array<{ id: string; name?: string; name_en?: string; weight?: string; weight_en?: string }> = [...(((cfg && cfg[kind]) as never) || [])];
    for (const c of (cfg && cfg.countries) || []) if (Array.isArray(c[kind])) all = all.concat(c[kind] as never);
    const seen: Record<string, true> = {};
    return all.filter((i) => i && i.id && !seen[i.id] && (seen[i.id] = true));
  };
  const nm = (i: { id: string; name?: string; name_en?: string }) => String(i.name_en || i.name || i.id);
  const list: Array<{ code: string; name: string; empty?: string }> = [];
  for (const sc of uniq("scents")) {
    for (const sz of uniq("sizes")) {
      const w = sz.weight_en || sz.weight || "";
      list.push({ code: sc.id + "-" + sz.id, name: nm(sc) + " · " + nm(sz) + (w ? " " + w : "") });
    }
  }
  for (const x of uniq("extras")) list.push({ code: x.id, name: nm(x) });
  const offer = (cfg && cfg.offer) || {};
  list.push({ code: "bundle", name: String(offer.name_en || offer.name || "Bundle") + " (bundle)", empty: "Empty = sent as its 3 boxes" });
  return list;
}

/* ---------------- Push all (v402): one press, every order ---------------- */

export interface PushAllResult {
  pushed: number;
  failed: Array<{ id: string; error: string; detail: string }>;
  /** why it stopped early, in words ("" when it went through the list) */
  stop: string;
}

/**
 * Sends the ids (≤ 200 a call); each answer names the ids it did not reach (`left`), which go
 * again at once, until none are left. Nothing done twice in a row: stop rather than spin.
 */
export async function pushAll(ids: string[], send: (ids: string[]) => Promise<SweepAnswer>, progress?: (done: number, total: number) => void): Promise<PushAllResult> {
  let queue = ids.slice();
  const total = queue.length;
  let pushed = 0;
  let failed: PushAllResult["failed"] = [];
  let idle = 0;
  while (queue.length) {
    const part = queue.slice(0, 200);
    progress?.(Math.min(total, total - queue.length + 1), total);
    let j: SweepAnswer;
    try {
      j = await send(part);
    } catch (e) {
      return { pushed, failed, stop: isApiError(e) ? explain(e) : "Could not push" };
    }
    if (j.skipped) return { pushed, failed, stop: j.skipped === "not_configured" ? "Omniful not connected" : j.skipped === "no_market_routed" ? "no market is routed to Empower" : j.skipped };
    pushed += j.pushed || 0;
    failed = failed.concat(j.failed || []);
    const left = Array.isArray(j.left) ? j.left : [];
    const done = part.length - left.filter((x) => part.indexOf(x) > -1).length;
    queue = left.concat(queue.slice(part.length).filter((x) => left.indexOf(x) < 0));
    idle = done ? 0 : idle + 1;
    if (idle >= 2) return { pushed, failed, stop: "Omniful is slow to answer. Try again in a minute." };
  }
  return { pushed, failed, stop: "" };
}
