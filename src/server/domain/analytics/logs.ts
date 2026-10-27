/**
 * THE ERROR LOG, for the Analytics tab (port of logs.list + the panel's grouping and export):
 * what went wrong on the page and on the server, newest first, over a window.
 *
 * Grouped by side, kind and message ("the same error, 40 times, all on iOS Safari" is one line),
 * with the order ids it touched. Two sizes: the table on screen (2,000 rows is far more than
 * anyone reads) and the export, which gets the whole window (20,000) — it goes to whoever has to
 * fix the thing, and a report that stops early omits the oldest occurrences, which say when it
 * started. A browser's session id never leaves: visitors are counted, numbered "visitor N" in
 * one answer, and never named.
 */
import { and, desc, eq, gte, inArray } from "drizzle-orm";
import type { Deps } from "../../core/deps";
import { logs } from "../../db/schema";

export interface LogRow {
  id: number;
  at: string;
  level: string;
  /** server | browser (a job's failure is the server's) */
  side: "server" | "browser";
  /** the source: http, a job, error | rejection for the page */
  kind: string;
  message: string;
  orderId: string | null;
  path: string | null;
  ua: string;
  browser: string;
  country: string;
  /** the stack or the internal words */
  detail: string;
  /** "visitor N" within this answer, "" for none — never the session id */
  visitor: string;
}

export interface LogGroup {
  key: string;
  side: string;
  kind: string;
  message: string;
  n: number;
  first: string;
  last: string;
  orderIds: string[];
  browsers: string[];
  visitors: number;
}

/** a user agent in a word */
export function browserOf(ua: string): string {
  const u = String(ua || "");
  if (!u) return "";
  if (/Instagram/i.test(u)) return "Instagram app";
  if (/FBAN|FBAV|FB_IAB/i.test(u)) return "Facebook app";
  if (/Snapchat/i.test(u)) return "Snapchat app";
  if (/TikTok|musical_ly|BytedanceWebview/i.test(u)) return "TikTok app";
  if (/SamsungBrowser/i.test(u)) return "Samsung Internet";
  if (/Edg\//.test(u)) return "Edge";
  if (/CriOS|Chrome\//.test(u)) return /Android/.test(u) ? "Chrome Android" : /iPhone|iPad/.test(u) ? "Chrome iOS" : "Chrome";
  if (/Firefox|FxiOS/.test(u)) return "Firefox";
  if (/Safari/.test(u) && /iPhone|iPad|iPod/.test(u)) return "iOS Safari";
  if (/Safari/.test(u)) return "Safari";
  return "Other";
}

export async function logsList(deps: Deps, o: { days?: number | string; full?: boolean; side?: "server" | "browser" | "" } = {}) {
  const days = Math.max(1, Math.min(60, parseInt(String(o.days ?? ""), 10) || 7));
  const since = new Date(deps.now() - days * 86400e3);
  const cap = o.full ? 20000 : 2000;
  const cond = [gte(logs.at, since)];
  if (o.side === "browser") cond.push(eq(logs.side, "browser"));
  else if (o.side === "server") cond.push(inArray(logs.side, ["server", "job"]));
  const raw = await deps.db.select().from(logs).where(and(...cond)).orderBy(desc(logs.at), desc(logs.id)).limit(cap);

  const seat: Record<string, number> = {};
  let seats = 0;
  const rows: LogRow[] = raw.map((r) => {
    const d = (r.detail || {}) as Record<string, unknown>;
    const sid = typeof d.sid === "string" ? d.sid : "";
    if (sid && !seat[sid]) seat[sid] = ++seats;
    const ua = typeof d.ua === "string" ? d.ua : "";
    const rest = { ...d };
    delete rest.sid; delete rest.ua; delete rest.country;
    const detail = typeof rest.stack === "string" && Object.keys(rest).length === 1 ? rest.stack : Object.keys(rest).length ? JSON.stringify(rest) : "";
    return {
      id: r.id,
      at: r.at.toISOString(),
      level: r.level,
      side: r.side === "browser" ? "browser" : "server",
      kind: r.source || (r.side === "job" ? "job" : ""),
      message: r.message,
      orderId: r.orderId,
      path: r.path,
      ua,
      browser: browserOf(ua),
      country: typeof d.country === "string" ? d.country : "",
      detail,
      visitor: sid ? "visitor " + seat[sid] : "",
    };
  });

  const G: Record<string, LogGroup & { vs: Set<string> }> = {};
  for (const r of rows) {
    const k = r.side + "|" + r.kind + "|" + r.message;
    const g = (G[k] = G[k] || { key: k, side: r.side, kind: r.kind, message: r.message, n: 0, first: r.at, last: r.at, orderIds: [], browsers: [], visitors: 0, vs: new Set() });
    g.n++;
    if (r.at < g.first) g.first = r.at;
    if (r.at > g.last) g.last = r.at;
    if (r.orderId && g.orderIds.indexOf(r.orderId) < 0) g.orderIds.push(r.orderId);
    if (r.browser && g.browsers.indexOf(r.browser) < 0) g.browsers.push(r.browser);
    if (r.visitor) g.vs.add(r.visitor);
  }
  const groups: LogGroup[] = Object.values(G)
    .map(({ vs, ...g }) => ({ ...g, visitors: vs.size }))
    .sort((a, b) => b.n - a.n || (a.last < b.last ? 1 : -1));

  return { ok: true as const, days, cap, capped: rows.length >= cap, rows, groups };
}

const CSV_HEAD = ["at", "side", "kind", "message", "order", "page", "country", "browser", "user agent", "detail", "visitor"];

function cell(v: unknown): string {
  const s = String(v == null ? "" : v);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

/** The export: every row, oldest first, the full user agent and the stack; visitors counted, never named. */
export function logsCsv(rows: readonly LogRow[]): string {
  const lines = [CSV_HEAD.join(",")];
  for (const r of rows.slice().reverse()) {
    lines.push([r.at, r.side, r.kind, r.message, r.orderId || "", r.path || "", r.country, r.browser, r.ua, r.detail, r.visitor].map(cell).join(","));
  }
  return lines.join("\n") + "\n";
}
