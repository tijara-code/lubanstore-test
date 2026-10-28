/**
 * Errors and job failures, written to the `logs` table (and the console). Messages are
 * masked: no phone number, email or long digit run is stored.
 */
import type { Db } from "../db/client";
import { logs } from "../db/schema";

export interface LogEntry {
  message: string;
  source?: string;
  level?: "error" | "warn" | "info";
  side?: "server" | "job" | "browser";
  orderId?: string | null;
  path?: string | null;
  detail?: Record<string, unknown>;
}

export interface Logger {
  error(source: string, message: string, extra?: Omit<LogEntry, "message" | "source">): Promise<void>;
  warn(source: string, message: string, extra?: Omit<LogEntry, "message" | "source">): Promise<void>;
  write(entry: LogEntry): Promise<void>;
}

/**
 * An error as it may be logged: for a database error, the server's own code and message —
 * NEVER the failed query or its parameters (drizzle's "Failed query: … params: …" carries the
 * customer's name, phone, city, IP …). Anything else: its message, any query text cut off.
 */
export function errorText(e: unknown): string {
  const err = e as { message?: unknown; code?: unknown; cause?: { message?: unknown; code?: unknown } } | null;
  const cause = err && err.cause && typeof err.cause === "object" ? err.cause : null;
  if (cause && cause.message) return ((cause.code ? String(cause.code) + " " : "") + String(cause.message)).slice(0, 300);
  const msg = String((err && err.message) || e);
  if (/^Failed query:/.test(msg)) return "database query failed";
  return withoutQuery(msg).slice(0, 300);
}

/** For a log: a database error as errorText; anything else with its stack, any query text cut off. */
export function errorStack(e: unknown): string {
  const err = e as { stack?: unknown; cause?: { message?: unknown } } | null;
  if (err && err.cause && typeof err.cause === "object" && err.cause.message) return errorText(e);
  return withoutQuery(String((err && err.stack) || e));
}

/** Cut "Failed query: …" (and the "params: …" that follows it) out of any text. */
export function withoutQuery(s: string): string {
  return s.replace(/Failed query:[\s\S]*?(?=\n\s+at |$)/g, "Failed query (detail withheld)").replace(/\bparams: [^\n]*/g, "params withheld");
}

/** Mask phone numbers, emails and long digit runs (keeps order ids, dates and decimals); drop any failed query's text. */
export function mask(s: unknown): string {
  return withoutQuery(String(s == null ? "" : s))
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]")
    .replace(/(?<![\w-])\+?(?:\d[\s-]?){8,15}(?![\w-])/g, (m) => (/^\d{4}-\d\d-\d\d/.test(m) ? m : "[number]"))
    .slice(0, 2000);
}

function maskDeep(v: unknown, depth: number): unknown {
  if (typeof v === "string") return mask(v);
  if (!v || typeof v !== "object" || depth > 6) return v;
  if (Array.isArray(v)) return v.slice(0, 50).map((x) => maskDeep(x, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(v)) out[k] = maskDeep(x, depth + 1);
  return out;
}

export function createLogger(getDb: () => Db | null, opts: { quiet?: boolean; now?: () => number } = {}): Logger {
  const write = async (entry: LogEntry) => {
    const row = {
      at: new Date(opts.now ? opts.now() : Date.now()),
      level: entry.level || "error",
      side: entry.side || "server",
      source: entry.source || null,
      message: mask(entry.message),
      orderId: entry.orderId || null,
      path: entry.path || null,
      detail: entry.detail ? (maskDeep(entry.detail, 0) as Record<string, unknown>) : null,
    };
    if (!opts.quiet) console[row.level === "info" ? "log" : "error"](`[${row.side}:${row.source || "-"}] ${row.message}`);
    const db = getDb();
    if (!db) return;
    try {
      await db.insert(logs).values(row);
    } catch {
      /* a log that cannot be written must never fail the request */
    }
  };
  return {
    write,
    error: (source, message, extra) => write({ ...extra, source, message, level: "error" }),
    warn: (source, message, extra) => write({ ...extra, source, message, level: "warn" }),
  };
}
