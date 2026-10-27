/**
 * The shop's calendar is Muscat's (+04, no daylight saving). Every "today",
 * "this month" and "by day" is cut there, not in UTC.
 */
export const GULF_MS = 4 * 3600e3;
export const DAY_MS = 86400e3;

/** "YYYY-MM-DD" of the Muscat day an instant falls on ("" for junk). */
export function muscatDay(t: number | string): string {
  const n = typeof t === "number" ? t : Date.parse(t);
  return Number.isFinite(n) ? new Date(n + GULF_MS).toISOString().slice(0, 10) : "";
}

/** The instant (UTC ms) the Muscat day containing `t` began. */
export function muscatMidnight(t?: number | string | null): number {
  const n = t == null ? Date.now() : typeof t === "number" ? t : Date.parse(t);
  return Math.floor((n + GULF_MS) / DAY_MS) * DAY_MS - GULF_MS;
}

/** A "YYYY-MM-DD" day as the instant it begins in Muscat; NaN for junk. */
export function dayStart(day: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(day || ""))) return NaN;
  const t = Date.parse(day + "T00:00:00Z");
  return Number.isFinite(t) ? t - GULF_MS : NaN;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, Math.max(0, Number(ms) || 0)));
}
