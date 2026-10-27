/**
 * Money rules — one copy of each, shared by the storefront, the server and the admin.
 *
 * Totals are kept to three decimals (the rial's baisa, the dinar's fils). A gateway
 * charge is in whole BAISA: 1 OMR = 1000 baisa, always an integer.
 */

/** Three decimals: the shop's resolution for every total. */
export function r3(n: unknown): number {
  return Math.round(Number(n) * 1000) / 1000;
}

/** A market's decimals, clamped to 0–3 (`dec` on the catalogue's country row). */
export function decimalsClamp(dec: unknown): number {
  return Math.max(0, Math.min(3, parseInt(String(dec), 10) || 0));
}

export function roundTo(n: unknown, dec: unknown): number {
  const f = Math.pow(10, decimalsClamp(dec));
  return Math.round(Number(n) * f) / f;
}

/** OMR → baisa, an integer. Rounded at 3 dp first so 32.899999 cannot become 32899. */
export function toBaisa(omr: unknown): number {
  return Math.round(Math.round(Number(omr) * 1000));
}

export function baisaToOmr(baisa: unknown): number {
  return Math.round(Number(baisa)) / 1000;
}

const THREE_DP: Record<string, true> = { OMR: true, BHD: true, KWD: true };

/** The currencies quoted to three decimals. */
export function decimalsOf(cur: unknown): 0 | 3 {
  return THREE_DP[String(cur || "").toUpperCase()] ? 3 : 0;
}

/** Arabic-Indic and Persian digits → ASCII ("١٢٣" → "123"). */
export function asciiDigits(s: unknown): string {
  return String(s == null ? "" : s)
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
}

/** A figure typed in the panel: Arabic digits allowed, never negative, never absurd. NaN if not a number. */
export function typedAmount(v: unknown, max = 1_000_000): number {
  const n = Number(asciiDigits(String(v == null ? "" : v).trim()));
  if (!Number.isFinite(n) || n < 0 || n > max) return NaN;
  return n;
}
