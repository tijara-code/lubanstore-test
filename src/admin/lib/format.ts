/**
 * How the panel writes numbers, money and dates.
 *
 * Money always shows the currency it was taken in, to at most three decimals with trailing
 * zeros dropped ("32 OMR", "1018.721 OMR"). Dates and times show in the VIEWER's time zone
 * (v202), en-GB; day filters, KPI windows and the chart's days are MUSCAT days (shared/kpi).
 */
export function money(n: unknown, cur?: string | null): string {
  const v = Math.round(Number(n || 0) * 1000) / 1000;
  const s = v % 1 ? v.toFixed(3).replace(/\.?0+$/, "") : String(v);
  return s + " " + (cur || "OMR");
}

/** "1414.016 OMR" → ["1414.016", "OMR"]; a plain count → [count, ""] (the KPI tile's unit). */
export function splitUnit(v: string): [string, string] {
  const m = /^(.*\S)\s+([A-Z]{3})$/.exec(v);
  return m ? [m[1]!, m[2]!] : [v, ""];
}

function asDate(v: unknown): Date | null {
  if (v == null || v === "") return null;
  const d = v instanceof Date ? v : new Date(v as string | number);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** "27 Oct 2026" */
export function dt(v: unknown): string {
  const d = asDate(v);
  return d ? d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—";
}

/** "27 Oct, 18:33" */
export function dtt(v: unknown): string {
  const d = asDate(v);
  return d ? d.toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";
}

/** "18:33" */
export function hhmm(v: unknown): string {
  const d = asDate(v);
  return d ? d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : "";
}

/** "27 Oct" for a "YYYY-MM-DD" day (the chart's labels) */
export function dayLabel(day: string): string {
  const d = new Date(day + "T12:00:00Z");
  return Number.isNaN(d.getTime()) ? day : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}

export function plural(n: number, one: string, many = one + "s"): string {
  return n + " " + (n === 1 ? one : many);
}

/** The avatar's letters, from the signed-in name ("shop keeper" → "SK"). */
export function initials(user: string | null | undefined): string {
  return String(user || "")
    .replace(/[^A-Za-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w.charAt(0).toUpperCase())
    .join("");
}

/** The digits wa.me wants: international, no plus, no spaces. */
export function waDigits(phone: unknown): string {
  return String(phone || "")
    .replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x0660))
    .replace(/\D/g, "")
    .replace(/^00/, "");
}
