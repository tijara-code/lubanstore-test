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

/** Mask phone numbers, emails and long digit runs (keeps order ids, dates and decimals). */
export function mask(s: unknown): string {
  return String(s == null ? "" : s)
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
